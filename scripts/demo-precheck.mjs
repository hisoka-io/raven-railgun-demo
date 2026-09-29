#!/usr/bin/env node
// Demo pre-check: is the Raven node's PPOI list current? /v1/health/ready answers 200 while a
// feed is syncing or upstream refuses it, so the readiness status alone is not enough.
//
//   node scripts/demo-precheck.mjs <node base URL> [--max-lag <rows>]
//
// Exit 0 only when every mirror feed is caught_up and holds within --max-lag rows of
// upstream_rows (default 64: past that lag the wallet refuses proofs in the list's last block).

import { pathToFileURL } from "node:url";

export const DEFAULT_MAX_LAG = 64;

/** One line per feed and a verdict, from the readiness HTTP status and body text. */
export function checkReadiness(httpStatus, bodyText, maxLag = DEFAULT_MAX_LAG) {
  const problems = [];
  const lines = [];
  if (httpStatus !== 200) problems.push(`readiness answered HTTP ${httpStatus}`);
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    problems.push("readiness body is not JSON");
    return { ok: false, lines, problems };
  }
  const feeds = Array.isArray(body?.mirror_feeds) ? body.mirror_feeds : [];
  if (feeds.length === 0) problems.push("readiness lists no mirror feed");
  for (const feed of feeds) {
    const list = String(feed?.list_key ?? "?").slice(0, 8);
    const held = feed?.rows_held;
    const upstream = feed?.upstream_rows;
    lines.push(`list ${list}: ${feed?.state}, rows_held ${held}, upstream_rows ${upstream}`);
    if (feed?.state !== "caught_up") {
      const why = feed?.last_failure ? ` (${feed.last_failure})` : "";
      problems.push(`list ${list} is ${feed?.state}${why}`);
    }
    if (!Number.isSafeInteger(held) || !Number.isSafeInteger(upstream)) {
      problems.push(`list ${list} reports no upstream row count to compare with`);
    } else if (Math.abs(upstream - held) > maxLag) {
      problems.push(`list ${list} holds ${held} rows, ${upstream - held} from upstream's ${upstream} (limit ${maxLag})`);
    }
  }
  return { ok: problems.length === 0, lines, problems };
}

function parseArgs(argv) {
  let url;
  let maxLag = DEFAULT_MAX_LAG;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--max-lag") {
      maxLag = Number(argv[(i += 1)]);
      if (!Number.isSafeInteger(maxLag) || maxLag < 0) throw new Error("--max-lag takes a row count");
    } else if (url === undefined) {
      url = argv[i];
    } else {
      throw new Error(`unexpected argument ${argv[i]}`);
    }
  }
  if (url === undefined) throw new Error("usage: demo-precheck.mjs <node base URL> [--max-lag <rows>]");
  return { url: url.replace(/\/+$/, ""), maxLag };
}

export async function main(argv) {
  const { url, maxLag } = parseArgs(argv);
  let status;
  let text;
  try {
    const res = await fetch(`${url}/v1/health/ready`, { signal: AbortSignal.timeout(10_000) });
    status = res.status;
    text = await res.text();
  } catch (err) {
    console.log(`FAIL  ${url}/v1/health/ready: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const verdict = checkReadiness(status, text, maxLag);
  for (const line of verdict.lines) console.log(`      ${line}`);
  for (const problem of verdict.problems) console.log(`FAIL  ${problem}`);
  if (verdict.ok) console.log(`PASS  ${url}: every mirror feed caught up, within ${maxLag} rows of upstream`);
  return verdict.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.log(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    },
  );
}
