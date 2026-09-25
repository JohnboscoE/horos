import { keccak256, toBytes, getAddress, type Address, type Hex } from "viem";
import type { MockChain } from "../chain/reader.js";

export type TransferState = "PENDING" | "COMPLETE" | "FAILED";

export interface TransferStatus {
  state: TransferState;
  txHash?: Hex;
  /** Network fee paid by the sending wallet, in 6-decimal minor units (Arc gas is USDC). */
  feeMinor?: bigint;
  error?: string;
}

/**
 * Everything Horos needs from Circle Developer-Controlled Wallets. The agent never touches this;
 * only the executor does, always with an idempotency key.
 */
export interface CircleGateway {
  readonly kind: "circle" | "mock";
  createWallet(refId: string, name: string): Promise<{ walletId: string; address: Address }>;
  transfer(args: {
    walletId: string;
    to: Address;
    token: Address;
    amountMinor: bigint;
    idempotencyKey: string;
  }): Promise<{ circleTxId: string }>;
  getTransfer(circleTxId: string): Promise<TransferStatus>;
}

/** In-memory Circle stand-in. Deterministic addresses; transfers complete immediately against MockChain. */
export class MockCircleGateway implements CircleGateway {
  readonly kind = "mock" as const;
  private wallets = new Map<string, Address>();
  private byKey = new Map<string, string>();
  private txs = new Map<string, TransferStatus>();
  /** Simulated gas per transfer, in minor units. */
  feeMinor = 1_000n; // 0.001 USDC

  constructor(private readonly chain?: MockChain) {}

  async createWallet(refId: string) {
    const address = getAddress(`0x${keccak256(toBytes(`mock-wallet:${refId}`)).slice(26)}`);
    const walletId = `mockw_${refId}`;
    this.wallets.set(walletId, address);
    return { walletId, address };
  }

  async transfer(args: { walletId: string; to: Address; token: Address; amountMinor: bigint; idempotencyKey: string }) {
    const existing = this.byKey.get(args.idempotencyKey);
    if (existing) return { circleTxId: existing }; // same key → same transfer, never a second one
    const from = this.wallets.get(args.walletId);
    if (!from) throw new Error(`MockCircle: unknown wallet ${args.walletId}`);
    const circleTxId = `mocktx_${this.byKey.size + 1}`;
    this.byKey.set(args.idempotencyKey, circleTxId);
    try {
      this.chain?.debit(from, args.amountMinor + this.feeMinor);
      this.txs.set(circleTxId, {
        state: "COMPLETE",
        txHash: keccak256(toBytes(circleTxId)),
        feeMinor: this.feeMinor,
      });
    } catch (e) {
      this.txs.set(circleTxId, { state: "FAILED", error: (e as Error).message });
    }
    return { circleTxId };
  }

  async getTransfer(circleTxId: string) {
    return this.txs.get(circleTxId) ?? { state: "FAILED" as const, error: "unknown transfer" };
  }
}
