import { createHash } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { getAddress, type Address, type Hex } from "viem";
import { parseAmount } from "@horos/core";
import type { CircleGateway, TransferStatus } from "./gateway.js";

/**
 * Circle expects UUID idempotency keys. Derive them deterministically from our own keys so a retry
 * after a restart maps to the same Circle request.
 */
export function uuidFromKey(key: string): string {
  const h = createHash("sha256").update(`horos:${key}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x40; // version 4
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Circle reports fees as decimal strings in the native token (USDC on Arc). Truncate to 6 decimals. */
function feeToMinor(fee: string | undefined): bigint | undefined {
  if (!fee) return undefined;
  const [w, f = ""] = fee.split(".");
  try {
    return parseAmount(`${w}${f ? `.${f.slice(0, 6)}` : ""}`);
  } catch {
    return undefined;
  }
}

export class RealCircleGateway implements CircleGateway {
  readonly kind = "circle" as const;
  private readonly client;

  constructor(
    apiKey: string,
    entitySecret: string,
    private readonly walletSetId: string,
    /** VERIFY: the SDK enum (8.4.1) has no Arc entry; passed through as a string. */
    private readonly blockchain: string,
  ) {
    this.client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  }

  async createWallet(refId: string, name: string): Promise<{ walletId: string; address: Address }> {
    const res = await this.client.createWallets({
      walletSetId: this.walletSetId,
      blockchains: [this.blockchain as never],
      count: 1,
      accountType: "EOA",
      metadata: [{ name, refId }],
      idempotencyKey: uuidFromKey(`wallet:${refId}`),
    });
    const w = res.data?.wallets?.[0];
    if (!w?.id || !w.address) throw new Error("Circle createWallets returned no wallet");
    return { walletId: w.id, address: getAddress(w.address) };
  }

  async transfer(args: { walletId: string; to: Address; token: Address; amountMinor: bigint; idempotencyKey: string }) {
    const whole = args.amountMinor / 1_000_000n;
    const frac = (args.amountMinor % 1_000_000n).toString().padStart(6, "0");
    const res = await this.client.createTransaction({
      walletId: args.walletId,
      tokenAddress: args.token,
      destinationAddress: args.to,
      amount: [`${whole}.${frac}`],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: uuidFromKey(args.idempotencyKey),
      refId: args.idempotencyKey.slice(0, 100),
    } as never);
    const id = (res.data as { id?: string } | undefined)?.id;
    if (!id) throw new Error("Circle createTransaction returned no id");
    return { circleTxId: id };
  }

  async getTransfer(circleTxId: string): Promise<TransferStatus> {
    const res = await this.client.getTransaction({ id: circleTxId });
    const tx = res.data?.transaction as
      | { state?: string; txHash?: string; networkFee?: string; errorReason?: string }
      | undefined;
    if (!tx?.state) return { state: "PENDING" };
    switch (tx.state) {
      case "COMPLETE":
      case "CONFIRMED":
        // CONFIRMED is onchain with at least one confirmation; Arc has deterministic finality.
        return { state: "COMPLETE", txHash: tx.txHash as Hex | undefined, feeMinor: feeToMinor(tx.networkFee) };
      case "FAILED":
      case "CANCELLED":
      case "DENIED":
        return { state: "FAILED", error: tx.errorReason ?? tx.state };
      default:
        return { state: "PENDING", txHash: tx.txHash as Hex | undefined };
    }
  }
}
