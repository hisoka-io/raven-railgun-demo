// The port a request enters on decides its run; nothing the page sends can move it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startObserverProxy, startupBanner } from "./proxy.mjs";
import { entranceSummary, parseObserverLog } from "../../src/lib/observer-log.ts";

const NOTE = "1c76a708cdcd50142b3ba7509700072ade0abe778f8c298a36dd6545f4405b35";
const READ = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "ppoi_pois_per_list",
  params: { listKeys: ["k"], blindedCommitmentDatas: [{ blindedCommitment: `0x${NOTE}`, type: "Shield" }] },
});

async function withProxy(extra, fn) {
  const upstream = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end(`${req.method} ${req.url}`));
  });
  await new Promise((ok) => upstream.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "observer-entrances-"));
  const proxy = await startObserverProxy({
    port: 0,
    raven: base,
    aggregator: base,
    logPath: join(dir, "log.json"),
    quiet: true,
    ...extra,
  });
  try {
    await fn(proxy, dir);
  } finally {
    await proxy.close();
    upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function settle(proxy, n) {
  const deadline = Date.now() + 5000;
  while (proxy.events.length < n && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(proxy.events.length, n);
}

const post = (url, body) => fetch(url, { method: "POST", body }).then(async (r) => ({ status: r.status, text: await r.text() }));

test("the stock entrance records stock and the other two record raven, whatever the page posts", async () => {
  await withProxy({}, async (proxy) => {
    const runSwitch = await post(`${proxy.url}/observer/run`, '{"run":"raven"}');
    assert.equal(runSwitch.status, 410);
    const stock = await post(`${proxy.stockUrl}/aggregator`, READ);
    assert.deepEqual(stock, { status: 200, text: "POST /" });
    assert.equal((await post(`${proxy.url}/observer/run`, '{"run":"stock"}')).status, 410);
    await fetch(`${proxy.url}/raven/v1/health/ready`).then((r) => r.text());
    await post(`${proxy.aggregatorUrl}/aggregator`, READ);
    await settle(proxy, 3);
    const byEntrance = proxy.events.map((e) => [e.upstream, e.route, e.run]).sort();
    assert.deepEqual(byEntrance, [
      ["aggregator", "/", "raven"],
      ["aggregator", "/", "stock"],
      ["raven", "/v1/health/ready", "raven"],
    ]);
    const stockEvent = proxy.events.find((e) => e.run === "stock");
    assert.equal(stockEvent.rpcMethod, "ppoi_pois_per_list");
    assert.equal(proxy.logDocument().meta.run, undefined);
  });
});

test("the stock entrance forwards, records and searches exactly as the aggregator leg does", async () => {
  await withProxy({ learn: true }, async (proxy) => {
    await post(`${proxy.stockUrl}/aggregator`, READ);
    await settle(proxy, 1);
    const [e] = proxy.events;
    assert.equal(e.run, "stock");
    assert.deepEqual(e.requestMatches.map((m) => m.commitment), [NOTE]);
    assert.equal(proxy.logDocument().meta.commitmentOrigins[NOTE], "stock-run read");
  });
});

test("a wrong prefix on the stock port gets the 421 hint; the page routes are not served there", async () => {
  await withProxy({}, async (proxy) => {
    const raven = await fetch(`${proxy.stockUrl}/raven/v1/status`);
    assert.equal(raven.status, 421);
    assert.equal(await raven.text(), `the raven leg listens on ${proxy.url}/raven`);
    assert.equal((await fetch(`${proxy.stockUrl}/observer/log`)).status, 404);
    assert.equal((await post(`${proxy.stockUrl}/observer/run`, '{"run":"raven"}')).status, 404);
    const misrouted = await post(`${proxy.url}/aggregator`, "{}");
    assert.equal(misrouted.status, 421);
    assert.match(misrouted.text, new RegExp(`${proxy.stockUrl}/aggregator \\(Raven off\\)`));
    assert.equal(proxy.events.length, 0);
  });
});

test("the banner, the snapshot and the log file name every entrance and its run", async () => {
  await withProxy({}, async (proxy, dir) => {
    assert.notEqual(new URL(proxy.stockUrl).origin, new URL(proxy.aggregatorUrl).origin);
    const banner = startupBanner(proxy);
    assert.match(banner, new RegExp(`stock {6}${proxy.stockUrl}/aggregator .*\\(Raven off\\)`));
    assert.match(banner, new RegExp(`aggregator ${proxy.aggregatorUrl}/aggregator .*\\(Raven on\\)`));
    const expected = [
      { run: "raven", url: `${proxy.url}/raven` },
      { run: "raven", url: `${proxy.aggregatorUrl}/aggregator` },
      { run: "stock", url: `${proxy.stockUrl}/aggregator` },
    ];
    const snapshot = await (await fetch(`${proxy.url}/observer/log`)).json();
    assert.deepEqual(snapshot.meta.entrances, expected);
    proxy.flushLog();
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "log.json"), "utf8")).meta.entrances, expected);
    const port = (u) => new URL(u).port;
    assert.equal(
      entranceSummary(expected),
      `The port decides the pane. Raven on enters on 127.0.0.1:${port(proxy.url)}/raven and ` +
        `127.0.0.1:${port(proxy.aggregatorUrl)}/aggregator; Raven off on 127.0.0.1:${port(proxy.stockUrl)}/aggregator.`,
    );
  });
});

/** Three consecutive free loopback ports, so the default stock port (aggregator + 1) can be checked. */
async function freeRun() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const base = 20000 + Math.floor(Math.random() * 30000);
    const held = [];
    try {
      for (let i = 0; i < 3; i += 1) {
        const s = createServer();
        await new Promise((ok, fail) => {
          s.once("error", fail);
          s.listen(base + i, "127.0.0.1", ok);
        });
        held.push(s);
      }
      return base;
    } catch {
      // Taken; try another base.
    } finally {
      await Promise.all(held.map((s) => new Promise((ok) => s.close(ok))));
    }
  }
  throw new Error("no three consecutive free ports");
}

test("the stock port defaults to the aggregator port + 1", async () => {
  const base = await freeRun();
  await withProxy({ port: base }, async (proxy) => {
    assert.equal(new URL(proxy.aggregatorUrl).port, String(base + 1));
    assert.equal(new URL(proxy.stockUrl).port, String(base + 2));
  });
});

test("the CLI takes the stock port from OBSERVER_STOCK_PORT, prints it, and ignores --run", async () => {
  const base = await freeRun();
  const dir = mkdtempSync(join(tmpdir(), "observer-cli-"));
  const child = spawn(
    process.execPath,
    [new URL("./proxy.mjs", import.meta.url).pathname, "--port", String(base), "--run", "raven", "--log", join(dir, "log.json")],
    {
      env: { ...process.env, OBSERVER_AGGREGATOR_PORT: String(base + 1), OBSERVER_STOCK_PORT: String(base + 2) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  let err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  try {
    const deadline = Date.now() + 10_000;
    while (!/\n {2}log /.test(out) && child.exitCode === null && Date.now() < deadline) {
      await new Promise((ok) => setTimeout(ok, 25));
    }
    assert.match(out, new RegExp(`stock {6}http://127\\.0\\.0\\.1:${base + 2}/aggregator`), out + err);
    assert.match(err, /--run is ignored/);
    const res = await post(`http://127.0.0.1:${base + 2}/raven/x`, "");
    assert.equal(res.status, 421);
  } finally {
    child.kill("SIGTERM");
    await new Promise((ok) => (child.exitCode !== null ? ok() : child.once("exit", ok)));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("older logs replay unchanged: a meta run label, no entrances, unlabeled events", () => {
  const sample = parseObserverLog(
    JSON.parse(readFileSync(new URL("../../public/samples/observer-synthetic-session.json", import.meta.url), "utf8")),
  );
  assert.equal(sample.meta.run, "raven");
  assert.equal(entranceSummary(sample.meta.entrances), undefined);
  assert.deepEqual([...new Set(sample.events.map((e) => e.run))].sort(), ["raven", "stock"]);
  const old = parseObserverLog({
    format: "raven-observer-log",
    version: 1,
    meta: { source: "live", startedAt: "2026-09-01T00:00:00Z", upstreams: {}, commitments: [], run: "unlabeled" },
    events: [{ id: 1, run: "unlabeled", tMs: 1, requestMatches: [] }],
  });
  assert.equal(old.events[0].run, "unlabeled");
  // The panes still split on the recorded run, so a saved log lands where it was recorded.
  const page = readFileSync(new URL("../../src/pages/Observer.tsx", import.meta.url), "utf8");
  assert.match(page, /events\.filter\(\(e\) => e\.run === "stock"\)/);
  assert.match(page, /events\.filter\(\(e\) => e\.run === "raven"\)/);
  assert.doesNotMatch(page, /control\("run"/);
});
