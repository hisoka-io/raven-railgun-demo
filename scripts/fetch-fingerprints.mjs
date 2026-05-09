#!/usr/bin/env node
// Hits the live operator and captures the SHA-256 of each instance's
// `/v1/instance/<id>/params` body. The result is written to
// `src/lib/crs-fingerprints.json` and shipped in the bundle so the
// browser can short-circuit boot via IndexedDB by hash before paying
// the 35 MiB CRS download.
//
// Run during `pnpm build` and on demand. Failure is non-fatal at
// build-time: the bundle ships an empty manifest and the boot path
// falls back to "fetch /params and trust the server" without the
// IDB-first benefit. CI logs the failure loud.

import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../src/lib/crs-fingerprints.json");

const BASE = process.env.RAVEN_FINGERPRINT_URL ?? "https://raven.hisoka.io";
const TOKEN = process.env.RAVEN_FINGERPRINT_TOKEN ?? process.env.VITE_RAVEN_BEARER ?? "";
const INSTANCES = [
  "commit-tree-0",
  "commit-tree-1",
  "commit-tree-2",
  "commit-tree-3",
  "ppoi-status-ofac",
  "ppoi-paths-ofac",
];

async function fetchHash(instance) {
  const url = `${BASE}/v1/instance/${instance}/params`;
  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    instance,
    sha256: hex,
    bytes: buf.length,
    capturedAt: new Date().toISOString(),
  };
}

async function main() {
  const out = {
    capturedAt: new Date().toISOString(),
    source: BASE,
    instances: {},
  };
  for (const instance of INSTANCES) {
    try {
      const fp = await fetchHash(instance);
      out.instances[instance] = fp;
      console.log(`  ${instance}: ${fp.sha256.slice(0, 16)}... (${fp.bytes} B)`);
    } catch (err) {
      console.error(`  ${instance}: FAILED - ${err.message}`);
      out.instances[instance] = { instance, error: err.message };
    }
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`wrote ${OUT}`);
}

main().catch((err) => {
  console.error("fetch-fingerprints failed:", err);
  // Write empty manifest so the build doesn't break
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        source: BASE,
        instances: {},
        error: err.message,
      },
      null,
      2
    )
  );
  process.exit(0);
});
