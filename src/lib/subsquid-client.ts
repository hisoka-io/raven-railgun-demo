import { GraphQLClient, gql } from "graphql-request";
import { CONFIG } from "./config";

const client = new GraphQLClient(CONFIG.subsquidUrl);

const SUBSQUID_TTL_MS = 60_000;
const SUBSQUID_KEY_PREFIX = "raven:subsquid:";

function cacheGet<T>(key: string): T | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SUBSQUID_KEY_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; value: T };
    if (Date.now() - parsed.ts > SUBSQUID_TTL_MS) {
      sessionStorage.removeItem(SUBSQUID_KEY_PREFIX + key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function cacheSet<T>(key: string, value: T): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      SUBSQUID_KEY_PREFIX + key,
      JSON.stringify({ ts: Date.now(), value })
    );
  } catch {
  }
}

export interface ChainCommitment {
  hash: string;
  blockNumber: number;
  treeNumber: number;
  treePosition: number;
  commitmentType: string;
}

export interface ShieldEvent {
  id: string;
  hash: string;
  blockNumber: number;
  treeNumber: number;
  treePosition: number;
  transactionHash: string;
}

const COMMITMENT_AT_QUERY = gql`
  query CommitmentAt($tree: Int!, $position: Int!) {
    commitments(
      where: { treeNumber_eq: $tree, treePosition_eq: $position }
      limit: 1
    ) {
      hash
      blockNumber
      treeNumber
      treePosition
      commitmentType
    }
  }
`;

export async function fetchCommitmentAt(
  treeNumber: number,
  treePosition: number
): Promise<ChainCommitment | null> {
  const key = `commit:${treeNumber}:${treePosition}`;
  const cached = cacheGet<ChainCommitment | null>(key);
  if (cached !== null) return cached;
  const data = await client.request<{ commitments: ChainCommitment[] }>(
    COMMITMENT_AT_QUERY,
    { tree: treeNumber, position: treePosition }
  );
  const value = data.commitments?.[0] ?? null;
  cacheSet(key, value);
  return value;
}

const RECENT_COMMITS_QUERY = gql`
  query RecentCommitments($tree: Int!, $limit: Int!) {
    commitments(
      where: { treeNumber_eq: $tree }
      orderBy: blockNumber_DESC
      limit: $limit
    ) {
      hash
      blockNumber
      treeNumber
      treePosition
      commitmentType
    }
  }
`;

export async function fetchRecentCommitments(
  treeNumber: number,
  limit = 8
): Promise<ChainCommitment[]> {
  const key = `recent-commits:${treeNumber}:${limit}`;
  const cached = cacheGet<ChainCommitment[]>(key);
  if (cached !== null) return cached;
  const data = await client.request<{ commitments: ChainCommitment[] }>(
    RECENT_COMMITS_QUERY,
    { tree: treeNumber, limit }
  );
  const value = data.commitments ?? [];
  cacheSet(key, value);
  return value;
}

const RECENT_SHIELDS_QUERY = gql`
  query RecentShields($limit: Int!) {
    shieldCommitments(orderBy: blockNumber_DESC, limit: $limit) {
      id
      hash
      blockNumber
      treeNumber
      treePosition
      transactionHash
    }
  }
`;

export async function fetchRecentShields(
  limit = 200
): Promise<ShieldEvent[]> {
  const key = `recent-shields:${limit}`;
  const cached = cacheGet<ShieldEvent[]>(key);
  if (cached !== null) return cached;
  const data = await client.request<{ shieldCommitments: ShieldEvent[] }>(
    RECENT_SHIELDS_QUERY,
    { limit }
  );
  const value = data.shieldCommitments ?? [];
  cacheSet(key, value);
  return value;
}

export type ShieldsByEoaOutcome =
  | { ok: true; matched: ShieldEvent[]; scannedShields: number; scannedBlockRange: { from: number; to: number } }
  | { ok: false; error: string };

export async function fetchShieldsByEoa(
  ethRpcUrl: string,
  eoaAddress: string,
  windowSize = 200
): Promise<ShieldsByEoaOutcome> {
  const lower = eoaAddress.toLowerCase();
  let shields: ShieldEvent[];
  try {
    shields = await fetchRecentShields(windowSize);
  } catch (e) {
    return { ok: false, error: `Subsquid query failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (shields.length === 0) {
    return { ok: true, matched: [], scannedShields: 0, scannedBlockRange: { from: 0, to: 0 } };
  }
  const blockHi = shields[0].blockNumber;
  const blockLo = shields[shields.length - 1].blockNumber;

  const uniqueTxs = Array.from(new Set(shields.map((s) => s.transactionHash)));
  let txFromMap: Map<string, string>;
  try {
    txFromMap = await batchResolveTxFrom(ethRpcUrl, uniqueTxs);
  } catch (e) {
    return { ok: false, error: `Ethereum RPC failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const matched = shields.filter((s) => {
    const from = txFromMap.get(s.transactionHash);
    return from !== undefined && from.toLowerCase() === lower;
  });

  return {
    ok: true,
    matched,
    scannedShields: shields.length,
    scannedBlockRange: { from: Number(blockLo), to: Number(blockHi) },
  };
}

interface JsonRpcResponse {
  id: number;
  result?: { from?: string; hash?: string } | null;
  error?: { message?: string };
}

async function batchResolveTxFrom(
  ethRpcUrl: string,
  txHashes: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (txHashes.length === 0) return out;
  const CHUNK = 25;
  for (let i = 0; i < txHashes.length; i += CHUNK) {
    const chunk = txHashes.slice(i, i + CHUNK);
    const body = chunk.map((hash, j) => ({
      jsonrpc: "2.0",
      id: i + j,
      method: "eth_getTransactionByHash",
      params: [hash],
    }));
    const res = await fetch(ethRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${ethRpcUrl}`);
    }
    const json = (await res.json()) as JsonRpcResponse[];
    for (let j = 0; j < json.length; j += 1) {
      const item = json[j];
      const hash = chunk[item.id - i];
      if (item.error) {
        throw new Error(item.error.message ?? "rpc error");
      }
      const from = item.result?.from;
      if (typeof from === "string") {
        out.set(hash, from);
      }
    }
  }
  return out;
}
