import { createPublicClient, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { CONFIG } from "./config";

export const chainClient = createPublicClient({
  chain: mainnet,
  transport: http(CONFIG.ethRpcUrl),
});

const ABI = [
  {
    inputs: [
      { name: "tree", type: "uint256" },
      { name: "root", type: "bytes32" },
    ],
    name: "rootHistory",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "merkleRoot",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "treeNumber",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextLeafIndex",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export async function readMerkleRoot(): Promise<`0x${string}`> {
  return chainClient.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "merkleRoot",
  });
}

export async function readTreeNumber(): Promise<number> {
  const value = await chainClient.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "treeNumber",
  });
  return Number(value);
}

export async function readNextLeafIndex(): Promise<number> {
  const value = await chainClient.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "nextLeafIndex",
  });
  return Number(value);
}

export async function verifyRootHistory(
  tree: number,
  rootHex: string
): Promise<boolean> {
  const root = (rootHex.startsWith("0x") ? rootHex : `0x${rootHex}`) as `0x${string}`;
  return chainClient.readContract({
    address: CONFIG.railgunProxy as Address,
    abi: ABI,
    functionName: "rootHistory",
    args: [BigInt(tree), root],
  });
}
