import { poseidon as poseidonInner, default as initInner } from "@railgun-community/poseidon-hash-wasm/pkg-esm/poseidon_hash_wasm.js";
import wasmUrl from "@railgun-community/poseidon-hash-wasm/pkg-esm/poseidon_hash_wasm_bg.wasm?url";

let initPromise: Promise<unknown> | null = null;
async function ensureInit() {
  if (!initPromise) initPromise = initInner(wasmUrl);
  await initPromise;
}

function poseidonHex(inputs: string[]): string {
  return poseidonInner(inputs);
}

function hexNoPrefix(s: string): string {
  return s.startsWith("0x") ? s.slice(2) : s;
}

function pad32(s: string): string {
  const clean = hexNoPrefix(s).toLowerCase();
  if (clean.length === 64) return clean;
  if (clean.length < 64) return clean.padStart(64, "0");
  throw new Error(`hash too long: ${clean.length} chars`);
}

export async function foldMerklePath(
  leaf: string,
  siblings: string[],
  leafIndex: number
): Promise<string> {
  await ensureInit();
  if (siblings.length !== 16) {
    throw new Error(`expected 16 siblings, got ${siblings.length}`);
  }
  let cursor = pad32(leaf);
  for (let level = 0; level < 16; level += 1) {
    const sibling = pad32(siblings[level]);
    const goesLeft = ((leafIndex >> level) & 1) === 0;
    const inputs = goesLeft ? [cursor, sibling] : [sibling, cursor];
    const next = poseidonHex(inputs);
    cursor = pad32(next);
  }
  return `0x${cursor}`;
}
