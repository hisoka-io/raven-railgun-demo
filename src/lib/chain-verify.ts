import { createPublicClient, http, parseAbi, type Address } from "viem";
import { mainnet } from "viem/chains";
import { CONFIG } from "./config";

const client = createPublicClient({
  chain: mainnet,
  transport: http(CONFIG.ethRpcUrl),
});

const ABI = parseAbi([
  "function rootHistory(uint256 tree, bytes32 root) view returns (bool)",
  "function merkleRoot() view returns (bytes32)",
  "function treeNumber() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
]);

export async function rootInHistory(treeNumber: number, root: string): Promise<boolean> {
  const r = root.startsWith("0x") ? (root as `0x${string}`) : (`0x${root}` as `0x${string}`);
  return client.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "rootHistory",
    args: [BigInt(treeNumber), r],
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
