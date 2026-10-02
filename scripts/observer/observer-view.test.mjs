// The observer's Key view: what it folds, what it merges, and what it may never hide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startObserverProxy } from "./proxy.mjs";
import {
  clockTime,
  formatDuration,
  isKeyRequest,
  isReadLeak,
  keyView,
  needsAttention,
  paneSummary,
} from "../../src/lib/observer-log.ts";

let nextId = 1;
function ev(fields) {
  return {
    id: nextId++,
    run: "raven",
    t: "2026-10-02T05:42:37.638Z",
    tMs: 1790919757638,
    upstream: "raven",
    destination: "http://node",
    method: "GET",
    route: "/",
    routeTemplate: "/",
    status: 200,
    durationMs: 100,
    requestBytes: 10,
    responseBytes: 20,
    requestMatches: [],
    responseMatches: [],
    ...fields,
  };
}
const raven = (method, routeTemplate, extra = {}) => ev({ method, routeTemplate, route: routeTemplate, ...extra });
const agg = (rpcMethod, extra = {}) =>
  ev({ upstream: "aggregator", method: "POST", rpcMethod, routeTemplate: "/", ...extra });
const MATCH = [{ commitment: "ab".repeat(32), encodings: ["hex"] }];

test("Key view keeps the encrypted path queries and every write; folds routine traffic", () => {
  const key = [
    raven("POST", "/v1/instance/{id}/batch"),
    raven("POST", "/v1/instance/{id}/query"),
    agg("ppoi_submit_transact_proof", { requestMatches: MATCH }),
    agg("ppoi_submit_legacy_transact_proofs"),
  ];
  const folded = [
    raven("POST", "/v1/instance/{id}/session"),
    raven("GET", "/v1/poi/{listKey}/bc-prefixes"),
    raven("GET", "/v1/health/ready"),
    raven("GET", "/v1/instance/{id}/params"),
    raven("GET", "/v1/status"),
    agg("ppoi_poi_events"),
    agg("ppoi_node_status"),
    agg("ppoi_validated_txid"),
    agg("ppoi_validate_txid_merkleroot"),
  ];
  for (const e of key) assert.equal(isKeyRequest(e), true, e.rpcMethod ?? e.routeTemplate);
  for (const e of folded) assert.equal(isKeyRequest(e), false, e.rpcMethod ?? e.routeTemplate);
});

test("a leak, a matched request, an error or a non-2xx is key whatever its route", () => {
  const cases = [
    agg("ppoi_pois_per_list"),
    agg("ppoi_merkle_proofs"),
    agg("ppoi_poi_events", { requestMatches: MATCH }),
    raven("GET", "/v1/health/ready", { requestMatches: MATCH }),
    raven("GET", "/v1/health/ready", { status: undefined, durationMs: undefined, error: "ECONNREFUSED" }),
    raven("GET", "/v1/instance/{id}/params", { status: 503 }),
    agg("ppoi_validated_txid", { status: 404 }),
    raven("GET", "/v1/health/ready", { status: 302 }),
  ];
  for (const e of cases) {
    assert.equal(needsAttention(e), true, JSON.stringify(e));
    assert.equal(isKeyRequest(e), true, JSON.stringify(e));
  }
  assert.equal(isReadLeak(cases[0]), true);
});

test("runs of the same routine request merge into one row; attention rows never merge", () => {
  const p = () => raven("GET", "/v1/poi/{listKey}/bc-prefixes");
  const pin = () => agg("ppoi_poi_events");
  const events = [
    raven("GET", "/v1/health/ready"),
    p(), p(), pin(), p(), p(),
    raven("POST", "/v1/instance/{id}/session"),
    raven("POST", "/v1/instance/{id}/batch"),
    raven("POST", "/v1/instance/{id}/batch"),
    agg("ppoi_submit_transact_proof", { requestMatches: MATCH }),
    agg("ppoi_submit_transact_proof", { requestMatches: MATCH }),
    agg("ppoi_pois_per_list"),
    agg("ppoi_pois_per_list"),
    p(),
  ];
  const kv = keyView(events);
  assert.deepEqual(
    kv.rows.map((r) => [r[0].rpcMethod ?? r[0].routeTemplate, r.length]),
    [
      ["/v1/instance/{id}/batch", 2],
      ["ppoi_submit_transact_proof", 1],
      ["ppoi_submit_transact_proof", 1],
      ["ppoi_pois_per_list", 1],
      ["ppoi_pois_per_list", 1],
    ],
  );
  assert.equal(kv.shown, 6);
  assert.equal(kv.folded, 8);
  assert.deepEqual(kv.foldedKinds.sort(), ["encryption keys", "health", "index downloads", "root pins"]);
  // Each request appears exactly once, in order.
  assert.deepEqual(kv.rows.flat().map((e) => e.id), events.filter(isKeyRequest).map((e) => e.id));
});

test("a repeat more than a minute after the last is a new row", () => {
  const at = (tMs) => raven("POST", "/v1/instance/{id}/batch", { tMs });
  const kv = keyView([at(0), at(30_000), at(90_000), at(200_000), agg("ppoi_poi_events", { tMs: 210_000 }), at(220_000)]);
  assert.deepEqual(kv.rows.map((r) => r.length), [3, 2]);
});

test("no view hides a leak, a proof write, an error or a non-2xx", () => {
  const events = [
    agg("ppoi_pois_per_list"),
    agg("ppoi_poi_events", { requestMatches: MATCH }),
    agg("ppoi_submit_transact_proof", { requestMatches: MATCH }),
    raven("GET", "/v1/health/ready", { error: "timeout", status: undefined }),
    agg("ppoi_node_status", { status: 500 }),
    raven("GET", "/v1/health/ready"),
  ];
  const shown = new Set(keyView(events).rows.flat().map((e) => e.id));
  for (const e of events.filter(needsAttention)) assert.ok(shown.has(e.id), JSON.stringify(e));
  assert.equal(shown.size, 5);
});

test("the pane verdict and counters count every request, folded ones included", () => {
  const events = [
    raven("GET", "/v1/health/ready", { requestBytes: 1, responseBytes: 2 }),
    raven("GET", "/v1/instance/{id}/params", { requestBytes: 3, responseBytes: 4 }),
    agg("ppoi_poi_events", { requestBytes: 5, responseBytes: 6, watchedAtScan: 0 }),
    raven("POST", "/v1/instance/{id}/batch", { requestBytes: 7, responseBytes: 8 }),
    agg("ppoi_submit_transact_proof", { requestMatches: MATCH, requestBytes: 9, responseBytes: 10 }),
  ];
  const sum = paneSummary(events, 1);
  assert.equal(keyView(events).shown, 2);
  assert.deepEqual(
    { ...sum },
    {
      total: 5,
      toAggregator: 2,
      toRaven: 3,
      readLeaks: 0,
      writes: 1,
      namedNotes: 0,
      shortChecked: 1,
      verdict: "clean",
      sentBytes: 25,
      receivedBytes: 30,
    },
  );
  assert.equal(paneSummary(events, 0).verdict, "unchecked");
  assert.equal(paneSummary([...events, agg("ppoi_pois_per_list")], 1).verdict, "leak");
  // The page feeds the summary the pane's own list and filters only inside the list.
  const page = readFileSync(new URL("../../src/pages/Observer.tsx", import.meta.url), "utf8");
  assert.match(page, /paneSummary\(events, watched\)/);
  assert.doesNotMatch(page, /\(e\.tMs - t0\)/);
});

test("rows show a wall clock and the request's own duration", () => {
  const d = new Date(2026, 9, 2, 7, 5, 9).getTime();
  assert.equal(clockTime(d), "07:05:09");
  assert.equal(formatDuration(402.4), "402 ms");
  assert.equal(formatDuration(1349), "1.3 s");
  assert.equal(formatDuration(90_000), "1.5 min");
  assert.equal(formatDuration(undefined), "—");
  assert.equal(formatDuration(-642), "—");
});

test("a reset answers with the file it saved and how many requests it held", async () => {
  const upstream = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  await new Promise((ok) => upstream.listen(0, "127.0.0.1", ok));
  const dir = mkdtempSync(join(tmpdir(), "observer-reset-"));
  const proxy = await startObserverProxy({
    port: 0,
    raven: `http://127.0.0.1:${upstream.address().port}`,
    logPath: join(dir, "log.json"),
    quiet: true,
  });
  try {
    await fetch(`${proxy.url}/raven/v1/health/ready`).then((r) => r.text());
    await fetch(`${proxy.url}/raven/v1/health/ready`).then((r) => r.text());
    const deadline = Date.now() + 5000;
    while (proxy.events.length < 2 && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 20));
    const res = await fetch(`${proxy.url}/observer/reset`, { method: "POST", body: "{}" });
    const body = await res.json();
    assert.deepEqual(body.saved, { logFile: "log.json", events: 2 });
    assert.equal(body.logFile, "log.r1.json");
    assert.equal(JSON.parse(readFileSync(join(dir, "log.json"), "utf8")).events.length, 2);
    const commitments = await (await fetch(`${proxy.url}/observer/commitments`, { method: "POST", body: '{"commitments":[]}' })).json();
    assert.equal(commitments.saved, undefined);
  } finally {
    await proxy.close();
    upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
