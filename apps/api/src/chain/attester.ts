import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  fallback,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig } from "@horos/core";
import { decisionAnchorAbi, paymentRecordAbi } from "./abis.js";

export interface AckArgs {
  invoiceHash: Hex;
  clientIdHash: Hex;
  freelancerIdHash: Hex;
  dueDate: bigint;
  amountBand: number;
}

/** Onchain writer. Implementations must treat "already recorded" as success (idempotent retries). */
export interface Attester {
  readonly enabled: boolean;
  recordAcknowledged(a: AckArgs): Promise<Hex | "ALREADY_DONE">;
  recordSettled(invoiceHash: Hex, paidAt: bigint): Promise<Hex | "ALREADY_DONE">;
  recordDispute(invoiceHash: Hex, responseHash: Hex): Promise<Hex | "ALREADY_DONE">;
  resolveDispute(invoiceHash: Hex): Promise<Hex | "ALREADY_DONE">;
  anchor(chainHead: Hex, count: bigint): Promise<Hex | "ALREADY_DONE">;
}

/** Arc testnet has been reported to fail eth_estimateGas for some writes; fall back to explicit limits. */
const GAS_FALLBACK: Record<string, bigint> = {
  recordAcknowledged: 250_000n,
  recordSettled: 120_000n,
  recordDispute: 120_000n,
  resolveDispute: 80_000n,
  anchor: 150_000n,
};

const IDEMPOTENT_ERRORS = new Set(["AlreadyRecorded", "AlreadySettled", "AlreadyDisputed", "NotDisputed", "CountNotIncreasing"]);

export class ViemAttester implements Attester {
  readonly enabled = true;
  private readonly account;
  private readonly wallet;

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly publicClient: PublicClient,
    privateKey: Hex,
    private readonly paymentRecord: Address,
    private readonly decisionAnchor: Address,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.wallet = createWalletClient({
      account: this.account,
      chain: cfg.chain,
      transport: fallback(cfg.rpcUrls.map((u) => http(u, { timeout: 15_000 })), { rank: false }),
    });
  }

  private async write(
    address: Address,
    abi: typeof paymentRecordAbi | typeof decisionAnchorAbi,
    functionName: string,
    args: readonly unknown[],
  ): Promise<Hex | "ALREADY_DONE"> {
    const base = { address, abi, functionName, args, account: this.account } as never;
    let gas: bigint;
    try {
      // Simulating first surfaces idempotent reverts (already recorded) without spending gas.
      await this.publicClient.simulateContract(base);
      gas = await this.publicClient.estimateContractGas(base);
      gas = (gas * 12n) / 10n;
    } catch (e) {
      const name = revertName(e);
      if (name && IDEMPOTENT_ERRORS.has(name)) return "ALREADY_DONE";
      if (name) throw e; // a real revert (e.g. NotAttester) — don't blindly send
      gas = GAS_FALLBACK[functionName] ?? 300_000n;
    }
    const hash = await this.wallet.writeContract({ ...(base as object), gas, chain: this.cfg.chain } as never);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted in tx ${hash}`);
    return hash;
  }

  recordAcknowledged(a: AckArgs) {
    return this.write(this.paymentRecord, paymentRecordAbi, "recordAcknowledged", [
      a.invoiceHash,
      a.clientIdHash,
      a.freelancerIdHash,
      a.dueDate,
      a.amountBand,
    ]);
  }
  recordSettled(invoiceHash: Hex, paidAt: bigint) {
    return this.write(this.paymentRecord, paymentRecordAbi, "recordSettled", [invoiceHash, paidAt]);
  }
  recordDispute(invoiceHash: Hex, responseHash: Hex) {
    return this.write(this.paymentRecord, paymentRecordAbi, "recordDispute", [invoiceHash, responseHash]);
  }
  resolveDispute(invoiceHash: Hex) {
    return this.write(this.paymentRecord, paymentRecordAbi, "resolveDispute", [invoiceHash]);
  }
  anchor(chainHead: Hex, count: bigint) {
    return this.write(this.decisionAnchor, decisionAnchorAbi, "anchor", [chainHead, count]);
  }
}

function revertName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "Reverted";
  }
  return undefined;
}

/** Local attester: mirrors contract rules in memory, returns fake tx hashes. */
export class MockAttester implements Attester {
  readonly enabled = false;
  private acked = new Set<string>();
  private settled = new Set<string>();
  private disputed = new Set<string>();
  private lastCount = 0n;
  private n = 0;
  readonly calls: { fn: string; args: unknown[] }[] = [];

  private tx(fn: string, args: unknown[]): Hex {
    this.calls.push({ fn, args });
    return `0x${"ab".repeat(16)}${(++this.n).toString(16).padStart(32, "0")}`;
  }

  async recordAcknowledged(a: AckArgs) {
    if (this.acked.has(a.invoiceHash)) return "ALREADY_DONE" as const;
    this.acked.add(a.invoiceHash);
    return this.tx("recordAcknowledged", [a]);
  }
  async recordSettled(h: Hex, paidAt: bigint) {
    if (!this.acked.has(h)) throw new Error("UnknownInvoice");
    if (this.settled.has(h)) return "ALREADY_DONE" as const;
    this.settled.add(h);
    return this.tx("recordSettled", [h, paidAt]);
  }
  async recordDispute(h: Hex, r: Hex) {
    if (!this.acked.has(h)) throw new Error("UnknownInvoice");
    if (this.disputed.has(h)) return "ALREADY_DONE" as const;
    this.disputed.add(h);
    return this.tx("recordDispute", [h, r]);
  }
  async resolveDispute(h: Hex) {
    if (!this.disputed.has(h)) return "ALREADY_DONE" as const;
    this.disputed.delete(h);
    return this.tx("resolveDispute", [h]);
  }
  async anchor(head: Hex, count: bigint) {
    if (count <= this.lastCount) return "ALREADY_DONE" as const;
    this.lastCount = count;
    return this.tx("anchor", [head, count]);
  }
}
