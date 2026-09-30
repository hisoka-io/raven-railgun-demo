// Synthetic observer session: the same POI work done twice through the recording proxy, once
// by the stock wallet transport against an aggregator, once by the Raven SDK against a Raven
// node. Both upstreams are local mocks; the clients are the real ones. Runs under vite-node
// from the SDK directory (see run-synthetic.mjs), because it imports the SDK's TypeScript and
// its test fixtures (real WASM, Rust-emitted PIR responses).

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { needleFor, scanForCommitments, startObserverProxy } from "./proxy.mjs";

const SDK = process.env.RAVEN_SDK_DIR;
if (!SDK) throw new Error("RAVEN_SDK_DIR must point at the Raven Railgun SDK directory");
const WALLET_DIR = process.env.RAILGUN_WALLET_DIR;
const OUT = resolve(process.env.OBSERVER_SYNTHETIC_OUT ?? "observer-logs/synthetic-session.json");
const PORT = Number(process.env.OBSERVER_PORT ?? 0);

const sdk = await import(join(SDK, "src/index.ts"));
const { loadFixture, makeClientPirContext } = await import(join(SDK, "tests/helpers/fixture.ts"));
const { startMockServer } = await import(join(SDK, "tests/helpers/mock_server.ts"));
const { mountPrefixChannel } = await import(
  join(SDK, "tests/helpers/prefix_channel.ts")
);
const { encodeBatchResponseNodes } = await import(join(SDK, "tests/helpers/auth_path_stub.ts"));
const { encodeInstanceParams } = await import(join(SDK, "tests/helpers/live_wire.ts"));

const CHAIN = { type: 0, id: 1 };
const TXID_VERSION = "V2_PoseidonMerkle";
const BLOCKS = 6;
const instanceLabel = (block) => `ppoi-paths-ofac-${block}`;

const fixture = loadFixture();
const LIST_KEY = fixture.meta.list_key_hex;
// The wallet's notes, full-entropy like real Poseidon outputs and below the BN254 modulus: all
// five are on the list; the first two are the ones it spends.
const noteAt = (seed) => {
  const h = createHash("sha256").update(`observer synthetic note ${seed}`).digest();
  h[0] &= 0x1f;
  return h.toString("hex");
};
const NOTES = [0, 1, 2, 3, 4].map(noteAt);
const SPENT = NOTES.slice(0, 2);
// Outputs of the spend: new notes the proof submission publishes. Not watched.
const OUTPUTS = [noteAt(0x40), noteAt(0x41)];
const hex32 = (tag) => `0x${tag.toString(16).padStart(2, "0").repeat(32)}`;

function startMockAggregator() {
  const answer = (method, params) => {
    switch (method) {
      case "ppoi_pois_per_list":
        return Object.fromEntries(
          params.blindedCommitmentDatas.map((d) => [
            d.blindedCommitment,
            Object.fromEntries(params.listKeys.map((k) => [k, "Valid"])),
          ]),
        );
      case "ppoi_merkle_proofs":
        return params.blindedCommitments.map((bc, i) => ({
          leaf: bc,
          elements: Array.from({ length: 16 }, (_u, j) => hex32(0x10 + j)),
          indices: `0x${i.toString(16)}`,
          root: hex32(0xee),
        }));
      case "ppoi_validate_txid_merkleroot":
        return true;
      case "ppoi_validated_txid":
        return { validatedTxidIndex: 4242, validatedMerkleroot: hex32(0xaa) };
      case "ppoi_submit_transact_proof":
        return null;
      default:
        return undefined;
    }
  };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = answer(body.method, body.params ?? {});
      const reply =
        result === undefined
          ? { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }
          : { jsonrpc: "2.0", id: body.id, result };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () =>
      ok({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      }),
    ),
  );
}

async function startMockRaven() {
  const server = await startMockServer();
  mountPrefixChannel(server, LIST_KEY, { commitments: [...NOTES] });
  const params = Buffer.from(
    encodeInstanceParams({
      crsBincode: fixture.crsBincode,
      shardConfigBincode: fixture.shardConfigBincode,
      inspireParamsBincode: new Uint8Array(
        readFileSync(join(SDK, "tests/fixtures/inspire_params.bin")),
      ),
      entrySize: fixture.meta.entry_size,
      variant: "inspire",
      epoch: 1n,
    }),
  );
  server.route(
    (req) => /^\/v1\/instance\/[^/]+\/params$/.test(req.url ?? ""),
    (_req, _body, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(params);
      return true;
    },
  );
  // The fixture's rows are status-shaped, so no fold completes; the wire is the subject here.
  server.route(
    (req) => /^\/v1\/instance\/[^/]+\/batch$/.test(req.url ?? ""),
    (_req, body, res) => {
      const count = Number(Buffer.from(body).readBigUInt64LE(2));
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "x-raven-freshness": "lag_blocks=1 applied_height=100 epoch=1 confidence=0.99",
      });
      const reply = fixture.responsesByIdx.get(0);
      res.end(Buffer.from(encodeBatchResponseNodes(Array.from({ length: count }, () => reply))));
      return true;
    },
  );
  return server;
}

// The stock wallet's own transport when a package dir is given; otherwise the same JSON-RPC
// framing it sends (POST <url>, {jsonrpc, method, params, id: Date.now()}).
function stockClient(url) {
  if (WALLET_DIR) {
    const require = createRequire(join(WALLET_DIR, "package.json"));
    const { POINodeRequest } = require("./dist/services/poi/poi-node-request.js");
    return { kind: "pinned @railgun-community/wallet POINodeRequest", api: new POINodeRequest([url]) };
  }
  const call = async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  };
  const common = (chain, txidVersion) => ({
    chainType: String(chain.type),
    chainID: String(chain.id),
    txidVersion,
  });
  return {
    kind: "stock JSON-RPC framing replica",
    api: {
      getLatestValidatedRailgunTxid: (v, c) => call("ppoi_validated_txid", common(c, v)),
      validateRailgunTxidMerkleroot: (v, c, tree, index, merkleroot) =>
        call("ppoi_validate_txid_merkleroot", { ...common(c, v), tree, index, merkleroot }),
      getPOIsPerList: (v, c, listKeys, blindedCommitmentDatas) =>
        call("ppoi_pois_per_list", { ...common(c, v), listKeys, blindedCommitmentDatas }),
      getPOIMerkleProofs: (v, c, listKey, blindedCommitments) =>
        call("ppoi_merkle_proofs", { ...common(c, v), listKey, blindedCommitments }),
      submitPOI: (v, c, listKey, transactProofData) =>
        call("ppoi_submit_transact_proof", { ...common(c, v), listKey, transactProofData }),
    },
  };
}

const PROOF = {
  snarkProof: { pi_a: [hex32(1), hex32(2)], pi_b: [[hex32(3), hex32(4)], [hex32(5), hex32(6)]], pi_c: [hex32(7), hex32(8)] },
  poiMerkleroots: [hex32(0xee)],
  txidMerkleroot: hex32(0xaa),
  txidMerklerootIndex: 4242,
  blindedCommitmentsOut: OUTPUTS.map((c) => `0x${c}`),
  railgunTxidIfHasUnshield: "0x00",
};

async function step(label, fn) {
  if (stepDelayMs > 0) await new Promise((ok) => setTimeout(ok, stepDelayMs));
  try {
    await fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    console.log(`  note  ${label}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

const aggregator = await startMockAggregator();
const raven = await startMockRaven();
const proxy = await startObserverProxy({
  port: PORT,
  raven: raven.url,
  aggregator: aggregator.url,
  commitments: NOTES,
  commitmentsOrigin: "wallet notes",
  logPath: OUT,
  source: "synthetic",
  quiet: true,
  note:
    "Synthetic session: real stock wallet transport and real Raven SDK with its WASM, " +
    "against local mock upstreams serving the SDK's fixture data. Sizes of params and " +
    "session keys are the fixture's, not production's. The fixture's rows are status-shaped, " +
    "so the Raven path fetch stops at decode and no fold completes: the root-pin reads that " +
    "follow a completed fold are absent here. A self-signed spend sends no roots check, so " +
    "neither run has one.",
});
const stock = stockClient(`${proxy.aggregatorUrl}/aggregator`);
console.log(`proxy ${proxy.url}; stock client: ${stock.kind}`);
// Lets an observer page connect first when the session is run to rehearse the live view.
const startDelayMs = Number(process.env.OBSERVER_SYNTHETIC_START_DELAY_MS ?? 0);
const stepDelayMs = Number(process.env.OBSERVER_SYNTHETIC_STEP_DELAY_MS ?? 0);
if (startDelayMs > 0) await new Promise((ok) => setTimeout(ok, startDelayMs));

console.log("run 1: stock POI node (Raven off)");
proxy.setRun("stock");
await step("txid sync", () => stock.api.getLatestValidatedRailgunTxid(TXID_VERSION, CHAIN));
await step("txid root check", () =>
  stock.api.validateRailgunTxidMerkleroot(TXID_VERSION, CHAIN, 0, 4242, hex32(0xaa)),
);
await step("balance refresh: status of every note", () =>
  stock.api.getPOIsPerList(
    TXID_VERSION,
    CHAIN,
    [LIST_KEY],
    NOTES.map((c, i) => ({ blindedCommitment: `0x${c}`, type: i === 0 ? "Shield" : "Transact" })),
  ),
);
await step("proof of innocence: paths for the spent notes", () =>
  stock.api.getPOIMerkleProofs(TXID_VERSION, CHAIN, LIST_KEY, SPENT.map((c) => `0x${c}`)),
);
await step("proof submission", () => stock.api.submitPOI(TXID_VERSION, CHAIN, LIST_KEY, PROOF));

console.log("run 2: Raven (Raven on)");
proxy.setRun("raven");
const ctx = makeClientPirContext(fixture);
const client = new sdk.RavenPOINodeInterface({
  endpoint: `${proxy.url}/raven`,
  chainId: CHAIN.id,
  chainType: CHAIN.type,
  txidVersion: TXID_VERSION,
  upstreamFallbackEndpoint: `${proxy.aggregatorUrl}/aggregator`,
  clientPirContexts: new Map([[`t2Path:${CHAIN.id}:${LIST_KEY}`, ctx]]),
  clientPirInstanceLabels: new Map(
    Array.from({ length: BLOCKS }, (_u, b) => [`t2Path:${CHAIN.id}:${LIST_KEY}:${b}`, instanceLabel(b)]),
  ),
  poiListIndexStore: false,
});
await step("bootstrap: public PIR parameters for block 0", async () => {
  const res = await fetch(`${proxy.url}/raven/v1/instance/${instanceLabel(0)}/params`);
  await res.arrayBuffer();
});
await step("txid sync (stays on the aggregator)", () =>
  stock.api.getLatestValidatedRailgunTxid(TXID_VERSION, CHAIN),
);
await step("txid root check (stays on the aggregator)", () =>
  stock.api.validateRailgunTxidMerkleroot(TXID_VERSION, CHAIN, 0, 4242, hex32(0xaa)),
);
await step("balance refresh: status of every note, answered on the device", async () => {
  const got = await client.getPOIsPerList(
    TXID_VERSION,
    CHAIN,
    [LIST_KEY],
    NOTES.map((c, i) => ({ blindedCommitment: c, type: i === 0 ? "Shield" : "Transact" })),
  );
  const valid = Object.values(got).filter((m) => m[LIST_KEY] === "Valid").length;
  if (valid !== NOTES.length) throw new Error(`expected ${NOTES.length} Valid, got ${valid}`);
});
await step("proof of innocence: paths for the spent notes by PIR", () =>
  client.getPOIMerkleProofs(TXID_VERSION, CHAIN, LIST_KEY, SPENT),
);
await step("proof submission", () =>
  client.submitPOI(
    TXID_VERSION,
    CHAIN,
    LIST_KEY,
    PROOF.snarkProof,
    PROOF.poiMerkleroots,
    PROOF.txidMerkleroot,
    PROOF.txidMerklerootIndex,
    PROOF.blindedCommitmentsOut,
    PROOF.railgunTxidIfHasUnshield,
  ),
);
ctx.session.free();

await proxy.close();
await raven.close();
await aggregator.close();

const events = proxy.events;
const byRun = (run) => events.filter((e) => e.run === run);
const leaks = (list) => list.filter((e) => e.requestMatches.length > 0);
const stockReads = byRun("stock").filter((e) =>
  ["ppoi_pois_per_list", "ppoi_merkle_proofs"].includes(e.rpcMethod),
);
const ravenRun = byRun("raven");
const ravenRoutes = [...new Set(ravenRun.filter((e) => e.upstream === "raven").map((e) => e.routeTemplate))];
const batch = ravenRun.find((e) => e.routeTemplate.endsWith("/batch"));

// Negative control: the same scanner must flag a commitment planted in a real PIR body.
const planted = Buffer.alloc(4096, 0x5a);
Buffer.from(NOTES[0], "hex").copy(planted, 1000);
const controlFlagged =
  scanForCommitments(
    NOTES.map(needleFor),
    planted,
  ).length === 1;

const checks = [
  ["stock run: every status and path read names the notes", stockReads.length >= 2 && stockReads.every((e) => e.requestMatches.length > 0)],
  ["raven run: no request carries a watched commitment", ravenRun.length > 0 && leaks(ravenRun).length === 0],
  ["raven run: Raven saw only list download, params, session and encrypted batch", ravenRoutes.every((r) => ["/v1/poi/{listKey}/bc-prefixes", "/v1/instance/{id}/params", "/v1/instance/{id}/session", "/v1/instance/{id}/batch"].includes(r))],
  ["raven run: an encrypted batch was sent, KB-scale, to one block's path instance", Boolean(batch) && batch.requestBytes > 1024 && typeof batch.block === "string"],
  ["raven run: the aggregator got no status or path read", ravenRun.every((e) => !["ppoi_pois_per_list", "ppoi_merkle_proofs"].includes(e.rpcMethod))],
  ["scanner control: a planted commitment in binary is flagged", controlFlagged],
];

console.log(`\n${events.length} events recorded -> ${OUT}`);
for (const e of events) {
  console.log(
    `  [${e.run.padEnd(5)}] ${e.upstream.padEnd(10)} ${e.method.padEnd(4)} ${(e.rpcMethod ?? e.route).slice(0, 60).padEnd(60)} ` +
      `${String(e.status ?? "ERR").padEnd(4)} up=${e.requestBytes} down=${e.responseBytes} ` +
      `${e.requestMatches.length ? `NAMES ${e.requestMatches.length} NOTE(S)` : ""}`,
  );
}
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
