// What the observer says the Raven node sees must match the wire: a /batch names its block, its
// padded query count, each query's shard id in the clear, and the client id and session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeBatchEnvelope, startObserverProxy } from "./proxy.mjs";
import { explain } from "../../src/lib/observer-log.ts";

/** The SDK's /batch envelope: [u16 BE schema][u64 LE count], then equal-length queries led by
 *  their u32 LE shard id. */
function batchBody(shardIds, queryBytes = 64) {
  const out = Buffer.alloc(10 + shardIds.length * queryBytes, 0xa5);
  out.writeUInt16BE(8, 0);
  out.writeBigUInt64LE(BigInt(shardIds.length), 2);
  shardIds.forEach((id, i) => out.writeUInt32LE(id, 10 + i * queryBytes));
  return out;
}

test("the batch envelope yields the query count and every shard id", () => {
  assert.deepEqual(decodeBatchEnvelope(batchBody([3, 17, 0, 31])), { queries: 4, shardIds: [3, 17, 0, 31] });
  assert.deepEqual(decodeBatchEnvelope(Buffer.concat([batchBody([5, 6]), Buffer.alloc(1)])), { queries: 2 });
  assert.equal(decodeBatchEnvelope(Buffer.alloc(8)), undefined);
  const zero = batchBody([1]);
  zero.writeBigUInt64LE(0n, 2);
  assert.equal(decodeBatchEnvelope(zero), undefined);
});

test("a batch explanation names the block, the padded count and the shard ids", () => {
  const base = { upstream: "raven", routeTemplate: "/v1/instance/{id}/batch", block: "ppoi-paths-ofac-5" };
  const decoded = explain({ ...base, batchQueries: 4, shardIds: [3, 17, 0, 31] }).learns;
  for (const part of ["ppoi-paths-ofac-5", "query count (4)", "padded with cover queries", "shard id, in the clear (3, 17, 0, 31)", "client id", "session handle"]) {
    assert.ok(decoded.includes(part), `missing "${part}" in: ${decoded}`);
  }
  const bare = explain(base).learns;
  assert.match(bare, /query count, padded/);
  assert.match(bare, /shard id, in the clear;/);
});

test("a single query explanation names its shard id and what links it", () => {
  const learns = explain({ upstream: "raven", routeTemplate: "/v1/instance/{id}/query", block: "ppoi-paths-ofac-1" }).learns;
  for (const part of ["ppoi-paths-ofac-1", "shard id in the clear", "session handle", "client id"]) {
    assert.ok(learns.includes(part), `missing "${part}" in: ${learns}`);
  }
});

test("no page names a host that does not serve Raven", () => {
  for (const page of ["src/pages/Architecture.tsx", "src/pages/Overview.tsx", "src/pages/Observer.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../${page}`, import.meta.url), "utf8"), /raven\.hisoka\.io/, page);
  }
});

test("the proxy records the count and shard ids of a batch it forwards", async () => {
  const upstream = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end(Buffer.alloc(4)));
  });
  await new Promise((ok) => upstream.listen(0, "127.0.0.1", ok));
  const dir = mkdtempSync(join(tmpdir(), "observer-claims-"));
  const proxy = await startObserverProxy({
    port: 0,
    raven: `http://127.0.0.1:${upstream.address().port}`,
    logPath: join(dir, "log.json"),
  });
  try {
    await fetch(`${proxy.url}/raven/v1/instance/ppoi-paths-ofac-2/batch`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-raven-client-id": "c1" },
      body: batchBody([9, 1]),
    }).then((r) => r.arrayBuffer());
    const deadline = Date.now() + 5000;
    while (proxy.events.length === 0 && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 20));
    const [event] = proxy.events;
    assert.equal(event.block, "ppoi-paths-ofac-2");
    assert.equal(event.batchQueries, 2);
    assert.deepEqual(event.shardIds, [9, 1]);
  } finally {
    await proxy.close();
    upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no page says the Raven node learns nothing or sees only ciphertext", () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const pages = ["src/lib/observer-log.ts", "src/pages/Observer.tsx", "src/pages/Overview.tsx", "src/pages/Architecture.tsx"];
  for (const page of pages) {
    const text = read(page);
    assert.doesNotMatch(text, /learns nothing|sees nothing|nothing about the wallet|only ever sees|not visible to the server|name only a block|who or what was asked/i, page);
  }
  const explainer = read("src/pages/Observer.tsx");
  assert.match(explainer, /shard id travels in the clear/);
  assert.match(explainer, /padded with cover queries to 1, 2, 4, 8, 16 or 32/);
});

test("Raven and the aggregator are proxied on distinct origins, each leg on its own port", async () => {
  const upstream = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end(`${req.method} ${req.url}`));
  });
  await new Promise((ok) => upstream.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "observer-origins-"));
  const proxy = await startObserverProxy({ port: 0, raven: base, aggregator: base, logPath: join(dir, "log.json") });
  try {
    // The SDK compares origins; a pin source on the Raven endpoint's origin is refused.
    assert.notEqual(new URL(proxy.url).origin, new URL(proxy.aggregatorUrl).origin);
    const raven = await fetch(`${proxy.url}/raven/v1/health/ready`);
    assert.equal(await raven.text(), "GET /v1/health/ready");
    const agg = await fetch(`${proxy.aggregatorUrl}/aggregator`, { method: "POST", body: "{}" });
    assert.equal(await agg.text(), "POST /");
    const misrouted = await fetch(`${proxy.url}/aggregator`, { method: "POST", body: "{}" });
    assert.equal(misrouted.status, 421);
    assert.equal(await misrouted.text(), `the aggregator leg listens on ${proxy.aggregatorUrl}/aggregator`);
    assert.equal((await fetch(`${proxy.aggregatorUrl}/raven/v1/status`)).status, 421);
    assert.equal((await fetch(`${proxy.aggregatorUrl}/observer/log`)).status, 404);
    assert.equal((await fetch(`${proxy.url}/observer/log`)).status, 200);
    const deadline = Date.now() + 5000;
    while (proxy.events.length < 2 && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 20));
    assert.deepEqual(proxy.events.map((e) => e.upstream).sort(), ["aggregator", "raven"]);
  } finally {
    await proxy.close();
    upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
