// The site ships no source maps and no credential, and reads no route the node no longer serves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const sources = () =>
  [...walk(join(root, "src")), join(root, "vite.config.ts"), join(root, ".env.local.example")].map((file) => ({
    file,
    text: readFileSync(file, "utf8"),
  }));

test("the production build emits no source maps", async () => {
  const { loadConfigFromFile } = await import("vite");
  const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, join(root, "vite.config.ts"));
  assert.equal(loaded?.config.build?.sourcemap, false);
});

test("nothing reads a Raven bearer token or sends an Authorization header", () => {
  for (const { file, text } of sources()) {
    assert.doesNotMatch(text, /VITE_RAVEN_BEARER|Authorization/, file);
  }
});

test("nothing reads the node's /v1/events stream", () => {
  for (const { file, text } of sources()) {
    assert.doesNotMatch(text, /\/v1\/events/, file);
  }
});
