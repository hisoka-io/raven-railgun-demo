export interface Citation {
  label: string;
  upstreamUrl: string;
  auditRef: string;
  verbatim?: string;
}

export type ArtifactKind = "zkey" | "wasm" | "vkey" | "dat";

export interface VariantShape {
  nullifiers: number;
  commitments: number;
}

export const CITATIONS_VERIFIED_AT = "2026-06-03";

interface UpstreamRepo {
  org: string;
  name: string;
  sha: string;
}

const REPOS = {
  wallet: { org: "Railgun-Community", name: "wallet", sha: "99c9a344c105eb44e6d4f0d1657d1a65254c52cb" },
  subsquidIntegration: { org: "Railgun-Community", name: "subsquid-integration", sha: "49922b3aa644a7fcafcc55e7264c020065302f0a" },
  subsquidClient: { org: "railgun-reloaded", name: "subsquid-client", sha: "79283de509701d21781c86e815ae94a813cc1a4e" },
  engine: { org: "Railgun-Community", name: "engine", sha: "2550cd653d706a3897a9d905fe906f58a4e87a22" },
  ipfsArtifactFetcher: { org: "railgun-reloaded", name: "ipfs-artifact-fetcher", sha: "8b8bf6c3db7f26a366d3e96b3324f06de65174ad" },
  circuitsV2: { org: "Railgun-Privacy", name: "circuits-v2", sha: "0aa2d13763a9fcfbb7b7ea9c02e004e71f1394bb" },
  sharedModels: { org: "Railgun-Community", name: "shared-models", sha: "dc3af7873305938f9f0771a24ad91f807f1b88e0" },
} satisfies Record<string, UpstreamRepo>;

type RepoKey = keyof typeof REPOS;

export function permalink(repo: RepoKey, path: string, lines?: string): string {
  const r = REPOS[repo];
  const anchor = lines ? `#${lines}` : "";
  return `https://github.com/${r.org}/${r.name}/blob/${r.sha}/${path}${anchor}`;
}

export const UNSHIELD_QUERY = `query GetRailgunTransactionsByUnshieldToAddress($address: Bytes) {
  transactions(
    orderBy: id_ASC
    limit: 10000
    where: { unshieldToAddress_eq: $address }
  ) {
    id
    nullifiers
    commitments
    transactionHash
    boundParamsHash
    blockNumber
    utxoTreeIn
    utxoTreeOut
    utxoBatchStartPositionOut
    hasUnshield
    unshieldToken { tokenType tokenSubID tokenAddress }
    unshieldToAddress
    unshieldValue
    blockTimestamp
    verificationHash
  }
}`;

export const EXAMPLE_UNSHIELD_RECIPIENT = "0x138fb523560d9b12d9f545f65d27fa87658f15b7";
export const EXAMPLE_EMPTY_RECIPIENT = "0x000000000000000000000000000000000000dead";

export const ARTIFACTS_CID = "QmUsmnK4PFc7zDp2cmC4wBZxYLjNyRgWfs5GNcJJ2uLcpU";

const ARTIFACT_ORDER: ArtifactKind[] = ["zkey", "wasm", "vkey", "dat"];

export function artifactKinds(): ArtifactKind[] {
  return [...ARTIFACT_ORDER];
}

export function variantString(shape: VariantShape): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(shape.nullifiers)}x${pad(shape.commitments)}`;
}

function artifactPath(kind: ArtifactKind, variant: string): string {
  switch (kind) {
    case "zkey":
      return `circuits/${variant}/zkey.br`;
    case "wasm":
      return `prover/snarkjs/${variant}.wasm.br`;
    case "vkey":
      return `circuits/${variant}/vkey.json`;
    case "dat":
      return `prover/native/${variant}.dat.br`;
  }
}

export function artifactUrl(gateway: string, kind: ArtifactKind, shape: VariantShape): string {
  const base = gateway.replace(/\/+$/, "");
  return `${base}/ipfs/${ARTIFACTS_CID}/${artifactPath(kind, variantString(shape))}`;
}

export const VARIANT_SHAPES: VariantShape[] = [
  { nullifiers: 1, commitments: 1 },
  { nullifiers: 1, commitments: 2 },
  { nullifiers: 2, commitments: 2 },
  { nullifiers: 3, commitments: 2 },
  { nullifiers: 1, commitments: 3 },
  { nullifiers: 2, commitments: 3 },
];

export const RAILGUN_VARIANT_TOTAL = 91;
export const WALLET_VARIANT_SUBSET = 54;

export const L2_CITATIONS: Citation[] = [
  {
    label: "Query schema: GetRailgunTransactionsByUnshieldToAddress binds the EOA as an unshieldToAddress_eq filter",
    upstreamUrl: permalink("wallet", "src/services/railgun/railgun-txids/graphql/railgun-txids-query.graphql", "L51-L78"),
    auditRef: "Agent 09, finding F2",
  },
  {
    label: "Call site: sdk.GetRailgunTransactionsByUnshieldToAddress({ address }) (the ZachXBT lookup pattern)",
    upstreamUrl: permalink("wallet", "src/services/railgun/railgun-txids/railgun-txid-sync-graph-v2.ts", "L109-L132"),
    auditRef: "Agent 07, finding F-07-03",
  },
  {
    label: "Indexer stores transaction.from, re-introducing a sender field on-chain shielded events omit",
    upstreamUrl: permalink("subsquidIntegration", "src/processor.ts", "L77-L88"),
    auditRef: "Agent 09, finding F1",
  },
  {
    label: "Single apex rail-squid.squids.live serves 5 chains with no fallback or rotation",
    upstreamUrl: permalink("subsquidClient", "src/networks.ts", "L2-L7"),
    auditRef: "Agent 09, finding F1",
  },
  {
    label: "Engine always runs quick-sync (indexer) then slow-sync (RPC) per scan cycle, leaking on both paths",
    upstreamUrl: permalink("engine", "src/railgun-engine.ts", "L603-L637"),
    auditRef: "Agent 06 and Agent 09",
  },
];

export const L3_CITATIONS: Citation[] = [
  {
    label: "Hardcoded gateway constant: IPFS_GATEWAY = 'https://ipfs-lb.com'",
    upstreamUrl: permalink("wallet", "src/services/artifacts/artifact-util.ts", "L7"),
    auditRef: "Agent 07, finding F-07-01",
  },
  {
    label: "Same constant duplicated in the reloaded ipfs-artifact-fetcher",
    upstreamUrl: permalink("ipfsArtifactFetcher", "src/definitions.ts", "L5"),
    auditRef: "Agent 04, finding F1",
  },
  {
    label: "Raw axios.get(url) against the hardcoded gateway (no verified-fetch, no integrity check)",
    upstreamUrl: permalink("wallet", "src/services/artifacts/artifact-downloader.ts", "L73"),
    auditRef: "Agent 04, finding F1",
  },
  {
    label: "Reloaded fetcher skips hash validation, quoting the Helia node as the integrity anchor",
    upstreamUrl: permalink("ipfsArtifactFetcher", "src/artifact-downloader.ts", "L297"),
    auditRef: "Agent 04 finding F4, Agent 16 finding F-16-4",
    verbatim: "Artifact integrity is ensured by the Helia node, so explicit hash validation is unnecessary.",
  },
  {
    label: "Vkey is fetched but artifact-hash.ts returns true unconditionally for the VKEY, so a swapped vkey is accepted",
    upstreamUrl: permalink("wallet", "src/services/artifacts/artifact-hash.ts", "L52-L54"),
    auditRef: "Agent 07 finding F-07-08, Agent 16 finding F-16-5",
  },
];

export const VARIANT_MATRIX_CITATION: Citation = {
  label: "Variant matrix: 91 RAILGUN circuits, nullifiers + commitments <= 14",
  upstreamUrl: permalink("circuitsV2", "lib/circuitConfigs.js", "L1-L13"),
  auditRef: "Agent 02 and Agent 20",
};

export const WALLET_SUBSET_CITATION: Citation = {
  label: "Wallet-selectable subset: 54 of the 91 variants",
  upstreamUrl: permalink("sharedModels", "src/json/artifacts.json"),
  auditRef: "Agent 02, Agent 04, Agent 10",
};
