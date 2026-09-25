import { createWalletClient, custom, defineChain, parseAbi, type Address, type WalletClient } from "viem";

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
  }
}

export function arcChain(chainId: number, explorer: string) {
  return defineChain({
    id: chainId,
    name: chainId === 5_042_002 ? "Arc Testnet" : "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [chainId === 5_042_002 ? "https://rpc.testnet.arc.network" : "https://rpc.mainnet.arc.io"] } },
    blockExplorers: { default: { name: "Explorer", url: explorer } },
  });
}

export async function connect(chainId: number, explorer: string): Promise<{ wallet: WalletClient; account: Address }> {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or Rabby, or acknowledge by email.");
  const chain = arcChain(chainId, explorer);
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("No account selected");
  try {
    await wallet.switchChain({ id: chainId });
  } catch {
    await wallet.addChain({ chain });
  }
  return { wallet, account };
}

const erc20 = parseAbi(["function transfer(address to, uint256 value) returns (bool)"]);

/** ERC-20 transfer in 6-decimal minor units. Explicit gas: estimateGas has been unreliable on Arc testnet. */
export async function payToken(wallet: WalletClient, account: Address, token: Address, to: Address, amountMinor: bigint, chainId: number, explorer: string) {
  return wallet.writeContract({
    account,
    chain: arcChain(chainId, explorer),
    address: token,
    abi: erc20,
    functionName: "transfer",
    args: [to, amountMinor],
    gas: 120_000n,
  });
}
