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
  totalCommits: 212_396,
  dailyFillRate: 250,
} as const;

export const WALLET_FOOTPRINT = {
  imtNodesPerTree: 131_071,
  imtBytesPerTree: 131_071 * 32,
  rawCommitmentBytesV2: 352,
  rawCommitmentBytesShield: 384,
  ldbExpansionFactor: 2.3,
  perDeviceRawBytes: 100 * 1024 * 1024,
  perDeviceOnDiskBytes: 275 * 1024 * 1024,
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
