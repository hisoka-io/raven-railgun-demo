import { createPublicClient, fallback, http, parseAbi, type Address } from "viem";
import { mainnet } from "viem/chains";
import { CONFIG } from "./config";

const RPC_URLS = (CONFIG.ethRpcUrl || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

if (RPC_URLS.length === 0) {
  RPC_URLS.push("https://ethereum.publicnode.com");
}

const transports = RPC_URLS.map((url) =>
  http(url, {
    timeout: 8_000,
    retryCount: 2,
    retryDelay: 250,
  })
);

const client = createPublicClient({
  chain: mainnet,
  transport: transports.length === 1 ? transports[0] : fallback(transports, { rank: false }),
});

const ABI = parseAbi([
  "function rootHistory(uint256 tree, bytes32 root) view returns (bool)",
  "function merkleRoot() view returns (bytes32)",
  "function treeNumber() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
]);

const ROOT_RE = /^(0x)?[0-9a-fA-F]{64}$/;

export function isValidRoot(root: string): boolean {
  return typeof root === "string" && ROOT_RE.test(root);
}

export class InvalidRootError extends Error {}

function normalizeRoot(root: string): `0x${string}` {
  if (!isValidRoot(root)) throw new InvalidRootError(`invalid root: expected 32-byte hex, got ${root?.slice(0, 8)}...`);
  return (root.startsWith("0x") ? root : `0x${root}`) as `0x${string}`;
}

export async function rootInHistory(treeNumber: number, root: string): Promise<boolean> {
  if (!Number.isInteger(treeNumber) || treeNumber < 0) {
    throw new Error(`invalid treeNumber: ${treeNumber}`);
  }
  return client.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "rootHistory",
    args: [BigInt(treeNumber), normalizeRoot(root)],
  });
}

export async function liveTreeNumber(): Promise<number> {
  const v = await client.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "treeNumber",
  });
  return Number(v);
}

export async function liveNextLeafIndex(): Promise<number> {
  const v = await client.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "nextLeafIndex",
  });
  return Number(v);
}

export async function liveMerkleRoot(): Promise<string> {
  const v = await client.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "merkleRoot",
  });
  return v as string;
}
