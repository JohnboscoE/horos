import type { PaymentClass } from "./reconcile.js";

/**
 * Invoice state machine (SPEC §5.3).
 *
 *   DRAFT → SENT → ACKNOWLEDGED → PARTIALLY_PAID → PAID
 *                       │                │
 *                       └──── OVERDUE ◄──┘   (after due date, if not PAID)
 *   PAID/PARTIALLY_PAID → OVERPAID → REFUND_PENDING → REFUNDED
 *   Any state → DISPUTED | CANCELLED
 *
 * Unacknowledged (SENT) invoices can still be paid; they're just excluded from the shared record.
 */

export const INVOICE_STATUSES = [
  "DRAFT",
  "SENT",
  "ACKNOWLEDGED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "OVERPAID",
  "REFUND_PENDING",
  "REFUNDED",
  "DISPUTED",
  "CANCELLED",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACKNOWLEDGED", "PARTIALLY_PAID", "PAID", "OVERPAID", "OVERDUE"],
  ACKNOWLEDGED: ["PARTIALLY_PAID", "PAID", "OVERPAID", "OVERDUE"],
  PARTIALLY_PAID: ["PARTIALLY_PAID", "PAID", "OVERPAID", "OVERDUE"],
  OVERDUE: ["ACKNOWLEDGED", "PARTIALLY_PAID", "PAID", "OVERPAID", "OVERDUE"],
  PAID: ["OVERPAID"],
  OVERPAID: ["OVERPAID", "REFUND_PENDING"],
  REFUND_PENDING: ["REFUNDED", "OVERPAID"],
  REFUNDED: ["OVERPAID"], // a further duplicate after a refund
  DISPUTED: ["ACKNOWLEDGED", "PARTIALLY_PAID", "PAID", "OVERPAID", "OVERDUE", "CANCELLED"],
  CANCELLED: [],
};

const TERMINAL_FOR_ANY: InvoiceStatus[] = ["DISPUTED", "CANCELLED"];

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === "CANCELLED") return false;
  if (TERMINAL_FOR_ANY.includes(to) && from !== to) return true;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) throw new Error(`Illegal invoice transition ${from} → ${to}`);
}

/** Status after a payment is classified. */
export function statusAfterPayment(kind: PaymentClass): InvoiceStatus {
  switch (kind) {
    case "PARTIAL":
      return "PARTIALLY_PAID";
    case "EXACT":
      return "PAID";
    case "OVERPAID":
    case "DUPLICATE":
      return "OVERPAID";
  }
}

/** Statuses in which the invoice still expects money from the client. */
export function isOpen(status: InvoiceStatus): boolean {
  return status === "SENT" || status === "ACKNOWLEDGED" || status === "PARTIALLY_PAID" || status === "OVERDUE";
}
