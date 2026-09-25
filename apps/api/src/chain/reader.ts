import { createPublicClient, fallback, http, type Address, type PublicClient } from "viem";
import type { NetworkConfig, ObservedTransfer } from "@horos/core";
import { erc20Abi } from "./abis.js";

export interface IncomingTransfer extends ObservedTransfer {
  to: Address;
  blockNumber: bigint;
}

/** Read-only chain access used by the watcher. Balances are ERC-20 (6-decimal) units. */
export interface ChainReader {
  latestBlock(): Promise<bigint>;
  tokenBalance(token: Address, owner: Address, blockNumber: bigint): Promise<bigint>;
  incomingTransfers(token: Address, to: Address[], fromBlock: bigint, toBlock: bigint): Promise<IncomingTransfer[]>;
}

export function makePublicClient(cfg: NetworkConfig): PublicClient {
  return createPublicClient({
    chain: cfg.chain,
    // Multiple RPCs with failover; rank=false keeps the configured order.
    transport: fallback(
      cfg.rpcUrls.map((u) => http(u, { timeout: 10_000, retryCount: 1 })),
      { rank: false },
    ),
  }) as PublicClient;
}

export class RpcChainReader implements ChainReader {
  constructor(private readonly client: PublicClient) {}

  latestBlock(): Promise<bigint> {
    return this.client.getBlockNumber({ cacheTime: 0 });
  }

  tokenBalance(token: Address, owner: Address, blockNumber: bigint): Promise<bigint> {
    // balanceOf on the USDC ERC-20 interface returns 6-decimal units. Never use eth_getBalance (18 decimals) here.
    return this.client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner], blockNumber });
  }

  async incomingTransfers(token: Address, to: Address[], fromBlock: bigint, toBlock: bigint): Promise<IncomingTransfer[]> {
    if (to.length === 0 || fromBlock > toBlock) return [];
    const logs = await this.client.getLogs({
      address: token,
      event: erc20Abi[1],
      args: { to },
      fromBlock,
      toBlock,
    });
    return logs.map((l) => ({
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      from: l.args.from!,
      to: l.args.to!,
      amount: l.args.value!,
      blockNumber: l.blockNumber,
    }));
  }
}

/**
 * In-memory chain for local dev and tests. `pay` simulates a client payment; `native: true`
 * simulates a native transfer that moves the balance without an ERC-20 Transfer log.
 */
export class MockChain implements ChainReader {
  block = 1n;
  /** Balance deltas by block, so reads at a past block see that block's state (like a real node). */
  private deltas: { owner: string; block: bigint; delta: bigint }[] = [];
  private logs: IncomingTransfer[] = [];
  private txCounter = 0;

  async latestBlock() {
    return this.block;
  }

  async tokenBalance(_token: Address, owner: Address, blockNumber: bigint) {
    return this.balanceAt(owner, blockNumber);
  }

  private balanceAt(owner: string, blockNumber: bigint): bigint {
    const o = owner.toLowerCase();
    return this.deltas.filter((d) => d.owner === o && d.block <= blockNumber).reduce((s, d) => s + d.delta, 0n);
  }

  async incomingTransfers(_token: Address, to: Address[], fromBlock: bigint, toBlock: bigint) {
    const set = new Set(to.map((a) => a.toLowerCase()));
    return this.logs.filter((l) => set.has(l.to.toLowerCase()) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
  }

  pay(to: Address, amount: bigint, opts: { from?: Address; native?: boolean } = {}): { txHash: `0x${string}` } {
    this.block++;
    const txHash = `0x${(++this.txCounter).toString(16).padStart(64, "0")}` as const;
    this.deltas.push({ owner: to.toLowerCase(), block: this.block, delta: amount });
    if (!opts.native) {
      this.logs.push({
        txHash,
        logIndex: 0,
        from: opts.from ?? "0x000000000000000000000000000000000000dEaD",
        to,
        amount,
        blockNumber: this.block,
      });
    }
    return { txHash };
  }

  /** Called by the mock Circle gateway when it "sends" funds out of a wallet. */
  debit(from: Address, amount: bigint) {
    const cur = this.balanceAt(from, this.block);
    if (cur < amount) throw new Error(`MockChain: insufficient balance in ${from}`);
    this.block++;
    this.deltas.push({ owner: from.toLowerCase(), block: this.block, delta: -amount });
  }
}
