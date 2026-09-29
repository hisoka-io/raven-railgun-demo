export const CONFIG = {
  subsquidUrl:
    import.meta.env.VITE_SUBSQUID_URL ??
    "https://rail-squid.squids.live/squid-railgun-ethereum-v2/graphql",
  ppoiPublicUrl:
    import.meta.env.VITE_PPOI_PUBLIC_URL ??
    "https://poi.us.proxy.railwayapi.xyz",
  defaultListKey:
    "efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88",
  railgunProxy: "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
  ethRpcUrl: import.meta.env.VITE_ETH_RPC_URL ?? "https://ethereum.publicnode.com",
  ipfsGateway: import.meta.env.VITE_IPFS_GATEWAY ?? "https://ipfs-lb.com",
  ipEchoUrl: import.meta.env.VITE_IP_ECHO_URL ?? "https://ipinfo.io/json",
  noxSeedUrl: import.meta.env.VITE_NOX_SEED_URL ?? "https://api.hisoka.io/seed/topology",
};

export const KNOWN_LEAF = {
  instance: "commit-tree-0",
  treeNumber: 0,
  position: 0,
  leafHex:
    "04300939ad6f444712784a719c6d0bbe1b49a0b4d16983a6324bbbac136a83c7",
  blockNumber: 14_751_290,
};
