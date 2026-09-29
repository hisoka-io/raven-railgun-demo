import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkReadiness, main } from "./demo-precheck.mjs";

// A body a caught-up local node served on the mainnet capture.
const feed = (over = {}) => ({
  list_key: "efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88",
  state: "caught_up",
  rows_held: 363278,
  upstream_rows: 363278,
  next_index: 363278,
  consecutive_failures: 0,
  last_failure: null,
  seconds_since_answer: 4,
  ...over,
});
const ready = (feeds) => JSON.stringify({ status: "ready", instances: 7, mirror_feeds: feeds });

test("a caught-up feed at upstream's row count passes", () => {
  assert.equal(checkReadiness(200, ready([feed()])).ok, true);
});

test("HTTP 200 with a feed upstream refuses fails", () => {
  const verdict = checkReadiness(
    200,
    ready([feed({ state: "upstream_refusing", consecutive_failures: 3, last_failure: "http 503" })]),
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join("\n"), /upstream_refusing \(http 503\)/);
});

test("a syncing feed fails", () => {
  assert.equal(checkReadiness(200, ready([feed({ state: "syncing", rows_held: 96157 })])).ok, false);
});

test("64 rows behind passes, 65 fails", () => {
  assert.equal(checkReadiness(200, ready([feed({ rows_held: 363278 - 64 })])).ok, true);
  const verdict = checkReadiness(200, ready([feed({ rows_held: 363278 - 65 })]));
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join("\n"), /65 from upstream's 363278/);
});

test("no upstream row count, no feed, a failing status or a non-JSON body fails", () => {
  assert.equal(checkReadiness(200, ready([feed({ upstream_rows: null })])).ok, false);
  assert.equal(checkReadiness(200, ready([])).ok, false);
  assert.equal(checkReadiness(200, JSON.stringify({ status: "ready", instances: 7 })).ok, false);
  assert.equal(checkReadiness(503, ready([feed({ state: "never_fed", rows_held: 0 })])).ok, false);
  assert.equal(checkReadiness(200, "<html>ok</html>").ok, false);
});

test("one bad feed among good ones fails", () => {
  const verdict = checkReadiness(200, ready([feed(), feed({ list_key: "55049dc4", state: "stopped" })]));
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.problems, ["list 55049dc4 is stopped"]);
});

test("the command reads /v1/health/ready and exits on the verdict", async () => {
  let body = ready([feed()]);
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/v1/health/ready" ? 200 : 404, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    assert.equal(await main([url]), 0);
    body = ready([feed({ state: "upstream_refusing" })]);
    assert.equal(await main([url]), 1);
    body = ready([feed({ rows_held: 363278 - 10 })]);
    assert.equal(await main([url, "--max-lag", "5"]), 1);
  } finally {
    server.close();
  }
});
