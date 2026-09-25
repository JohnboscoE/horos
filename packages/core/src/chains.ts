import { defineChain, type Address, type Chain } from "viem";

export type NetworkName = "testnet" | "mainnet";

export interface NetworkConfig {
  network: NetworkName;
  chain: Chain;
  rpcUrls: string[];
  explorerUrl: string;
  usdc: Address;
  /** null until verified against docs.arc.network (spec §14 open question 2). */
  eurc: Address | null;
  /** Circle Wallets API blockchain identifier. VERIFY (spec §14 open question 3). */
  circleBlockchain: string;
  /** Values that have not been verified against official docs yet. Boot refuses mainnet while non-empty. */
  unverified: string[];
}

// Values from SPEC §8. Testnet values are the ones in active use; mainnet is gated.
export const arcTestnet = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"], webSocket: ["wss://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5_042, // VERIFY
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } }, // VERIFY
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } }, // VERIFY
});

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    network: "testnet",
    chain: arcTestnet,
    rpcUrls: [
      "https://rpc.testnet.arc.network",
      "https://rpc.drpc.testnet.arc.network",
      "https://rpc.quicknode.testnet.arc.network",
      "https://rpc.blockdaemon.testnet.arc.network",
    ],
    explorerUrl: "https://testnet.arcscan.app",
    usdc: "0x3600000000000000000000000000000000000000",
    eurc: null,
    circleBlockchain: "ARC-TESTNET",
    unverified: ["eurc", "circleBlockchain"],
  },
  mainnet: {
    network: "mainnet",
    chain: arcMainnet,
    rpcUrls: ["https://rpc.mainnet.arc.io"],
    explorerUrl: "https://explorer.arc.io",
    usdc: "0x0000000000000000000000000000000000000000",
    eurc: null,
    circleBlockchain: "ARC",
    unverified: ["chainId", "rpcUrls", "explorerUrl", "usdc", "eurc", "circleBlockchain"],
  },
};

export function explorerTxUrl(cfg: NetworkConfig, txHash: string): string {
  return `${cfg.explorerUrl}/tx/${txHash}`;
}

export function explorerAddressUrl(cfg: NetworkConfig, address: string): string {
  return `${cfg.explorerUrl}/address/${address}`;
}
