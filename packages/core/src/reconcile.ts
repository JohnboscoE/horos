/**
 * Payment reconciliation. Pure functions; the watcher persists results.
 *
 * Payments are detected by balance change on the per-invoice deposit address, because a native
 * transfer on Arc moves USDC without emitting an ERC-20 Transfer log. Logs are used only to
 * attribute a change to a tx/sender.
 */

export type PaymentClass = "PARTIAL" | "EXACT" | "OVERPAID" | "DUPLICATE";

export interface Classification {
  kind: PaymentClass;
  totalPaid: bigint;
  outstanding: bigint;
  /** Received above what's owed. The only money that may ever be refunded. */
  excess: bigint;
}

export function classifyPayment(invoiceAmount: bigint, priorPaid: bigint, incoming: bigint): Classification {
  if (invoiceAmount <= 0n) throw new Error("invoice amount must be positive");
  if (priorPaid < 0n || incoming <= 0n) throw new Error("invalid payment amounts");
  const totalPaid = priorPaid + incoming;
  const outstanding = totalPaid >= invoiceAmount ? 0n : invoiceAmount - totalPaid;
  const excess = totalPaid > invoiceAmount ? totalPaid - invoiceAmount : 0n;

  let kind: PaymentClass;
  if (priorPaid >= invoiceAmount) kind = "DUPLICATE"; // already fully paid; all of `incoming` is excess
  else if (totalPaid < invoiceAmount) kind = "PARTIAL";
  else if (totalPaid === invoiceAmount) kind = "EXACT";
  else kind = "OVERPAID";

  return { kind, totalPaid, outstanding, excess };
}

export interface ObservedTransfer {
  txHash: string;
  logIndex: number;
  from: string;
  amount: bigint;
}

export interface DetectedPayment {
  txHash: string;
  /** -1 for balance changes not explained by any Transfer log (e.g. native transfers). Never NULL:
   *  Postgres UNIQUE treats NULLs as distinct, which would break idempotency. */
  logIndex: number;
  from: string | null;
  amount: bigint;
  attributed: boolean;
}

export interface BalanceChangeInput {
  address: string;
  blockNumber: bigint;
  previousBalance: bigint;
  currentBalance: bigint;
  /** Incoming ERC-20 Transfer logs to this address in (previousBlock, blockNumber]. */
  incomingTransfers: ObservedTransfer[];
  /** Outgoing amounts we initiated (refunds, sweeps) confirmed in the same range. */
  knownOutgoing: bigint;
}

export interface BalanceChangeResult {
  payments: DetectedPayment[];
  /** Balance moved in a way we can't explain (money left that we didn't send). Needs a human. */
  anomaly: string | null;
}

/**
 * Explain a balance change on a deposit address as a set of payments.
 * incomingTotal = (current - previous) + knownOutgoing. Anything beyond the logged transfers is
 * recorded as one unattributed payment keyed by (address, block), so reprocessing is idempotent.
 */
export function attributeBalanceChange(input: BalanceChangeInput): BalanceChangeResult {
  const incomingTotal = input.currentBalance - input.previousBalance + input.knownOutgoing;
  const logged = input.incomingTransfers.reduce((s, t) => s + t.amount, 0n);

  const payments: DetectedPayment[] = input.incomingTransfers
    .filter((t) => t.amount > 0n)
    .map((t) => ({ txHash: t.txHash, logIndex: t.logIndex, from: t.from, amount: t.amount, attributed: true }));

  if (incomingTotal < 0n) {
    return { payments: [], anomaly: `balance fell by ${-incomingTotal} more than known outgoing transfers` };
  }
  if (incomingTotal < logged) {
    return {
      payments,
      anomaly: `logged incoming ${logged} exceeds balance-derived incoming ${incomingTotal}; possible RPC lag`,
    };
  }
  const unexplained = incomingTotal - logged;
  if (unexplained > 0n) {
    payments.push({
      txHash: `balance:${input.address.toLowerCase()}:${input.blockNumber}`,
      logIndex: -1,
      from: null,
      amount: unexplained,
      attributed: false,
    });
  }
  return { payments, anomaly: null };
}
