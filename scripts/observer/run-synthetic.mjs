#!/usr/bin/env node
// Runs synthetic-session.mjs with the SDK's own vite-node, from the SDK directory, so the SDK's
// TypeScript sources and test fixtures resolve against its installed dependencies.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdk = process.env.RAVEN_SDK_DIR ? resolve(process.env.RAVEN_SDK_DIR) : undefined;
if (!sdk || !existsSync(join(sdk, "src/index.ts"))) {
  console.error("set RAVEN_SDK_DIR to the Raven Railgun SDK (adapters/railgun/sdk), dependencies installed");
  process.exit(2);
}
const pnpmDir = join(sdk, "node_modules/.pnpm");
const viteNodeDir = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).find((d) => d.startsWith("vite-node@"))
  : undefined;
const viteNode = viteNodeDir
  ? join(pnpmDir, viteNodeDir, "node_modules/vite-node/vite-node.mjs")
  : join(sdk, "node_modules/vite-node/vite-node.mjs");
if (!existsSync(viteNode)) {
  console.error(`vite-node not found under ${sdk}/node_modules; install the SDK's dependencies`);
  process.exit(2);
}
const out = resolve(process.env.OBSERVER_SYNTHETIC_OUT ?? process.argv[2] ?? "observer-logs/synthetic-session.json");
const env = { ...process.env, RAVEN_SDK_DIR: sdk, OBSERVER_SYNTHETIC_OUT: out };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.execPath, [viteNode, join(here, "synthetic-session.mjs")], {
  cwd: sdk,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
