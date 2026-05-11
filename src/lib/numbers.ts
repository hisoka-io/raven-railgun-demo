export const PIR_BENCH = {
  totalRoundTripMs: 71.9,
  serverRespondMs: 69.3,
  clientGenMs: 2.42,
  extractMs: 0.124,
  upBytes: 98_840,
  downBytes: 32_879,
  qpsSerial: 13.89,
  qpsK4: 22.17,
  k4WallMs: 175.5,
  paramsBodyBytes: 35_050_602,
  paramsBodyHuman: "33.4 MiB",
  wasmInitMsCold: 12_000,
  warmPathMsMedian: 528,
} as const;

export const CHAIN = {
  proxyAddress: "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
  chainId: 1,
  treeDepth: 16,
  treeMaxItems: 65_536,
  staticTrees: 3,
  liveTreeIndex: 3,
} as const;

// On-device wallet storage, computed from the actual LevelDB layout
// in clones/railgun-research/repo-cache/engine/src/{merkletree,note}.
//
//   per-leaf row     : ~1.24 KiB (key 324 B + Commitment JSON ~920 B)
//   per-filled tree  : ~162 MiB (leaves 77.7 + IMT 56.6 + nullifiers ~24 + overhead)
//   current mainnet  : ~520 MiB (tree 0/1/2 filled + tree 3 ~20.5 K leaves)
//   four-tree saturation : ~633 MiB (4 × 65 536 leaves)
//
// PIR-enabled wallet keeps only `(tree, position)` indexes for OWNED
// notes (msgpack ~730 B each), so a typical wallet stores a few KB and
// PIR-fetches the auth path on demand. Commit-tree cost collapses from
// O(N) toward O(owned notes).
export const WALLET_FOOTPRINT = {
  imtNodesPerTree: 131_071,
  imtBytesPerTree: 131_071 * 32,
  perLeafBytes: 1_244,
  perFilledTreeBytes: 162 * 1024 * 1024,
  currentMainnetLeaves: 217_096,
  currentMainnetBytes: 520 * 1024 * 1024,
  fullSaturationBytes: 633 * 1024 * 1024,
  perOwnedNoteBytes: 730,
  dirtyAncestorsPerInsert: 16,
} as const;

export const PIR_TABLES = {
  ppoiStatusBytes: 65_536 * 32,
  ppoiPathBytes: 131_072 * 32,
  commitTreePathBytes: 131_072 * 32,
} as const;

export const SDK = {
  wasmRawBytes: 167 * 1024,
  wasmGzipBytes: 70 * 1024,
} as const;
