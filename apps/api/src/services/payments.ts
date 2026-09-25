import { classifyPayment, minorFromString, type DetectedPayment, type PaymentClass } from "@horos/core";
import type { Ctx } from "../context.js";
import { newId } from "../context.js";
import type { InvoiceRow } from "../db/rows.js";
import { policyEvidence } from "../agent/snapshot.js";
import { runDecision } from "./agent.js";
import { enqueueChainJob } from "./chainJobs.js";
import { amountDue, getInvoice } from "./invoices.js";
import { refundableExcess } from "./refunds.js";
import { loadPolicy } from "./stats.js";

interface Anomaly {
  paymentId: string;
  kind: PaymentClass;
  amount: bigint;
  from: string | null;
}

/**
 * Record detected payments for one invoice. Idempotent: UNIQUE(tx_hash, log_index) means a payment
 * seen twice is inserted once, and invoice totals only move when the insert happens.
 * Anomalies (partial / overpaid / duplicate) then go to the agent as RECONCILE decisions.
 */
export async function ingestPayments(ctx: Ctx, invoiceId: string, detected: DetectedPayment[], blockNumber: bigint | null): Promise<number> {
  const anomalies: Anomaly[] = [];
  let inserted = 0;

  await ctx.db.tx(async (q) => {
    const locked = (await q.query<InvoiceRow>("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId]))[0];
    if (!locked) throw new Error(`invoice ${invoiceId} not found`);
    let inv: InvoiceRow = locked;
    const now = ctx.now();

    for (const p of detected) {
      const id = newId("pay");
      const ins = await q.query<{ id: string }>(
        `INSERT INTO payments (id, invoice_id, tx_hash, log_index, from_address, amount_minor, classification, block_number)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7) ON CONFLICT (tx_hash, log_index) DO NOTHING RETURNING id`,
        [id, invoiceId, p.txHash, p.logIndex, p.from, p.amount.toString(), blockNumber?.toString() ?? null],
      );
      if (!ins[0]) continue;
      inserted++;

      const prior = minorFromString(inv.paid_minor);
      const due = amountDue(inv, now);
      const cancelled = inv.status === "CANCELLED";
      const kind: PaymentClass = cancelled ? "DUPLICATE" : classifyPayment(due, prior, p.amount).kind;
      const newPaid = prior + p.amount;

      let status = inv.status;
      if (inv.status !== "CANCELLED" && inv.status !== "DISPUTED" && inv.status !== "DRAFT") {
        if (kind === "PARTIAL") status = inv.status === "OVERDUE" ? "OVERDUE" : "PARTIALLY_PAID";
        else if (kind === "EXACT") status = "PAID";
        else status = "OVERPAID";
      }
      const settlesNow = !cancelled && prior < due && newPaid >= due;

      await q.query("UPDATE payments SET classification = $2 WHERE id = $1", [id, kind]);
      const rows = await q.query<InvoiceRow>(
        `UPDATE invoices SET paid_minor = $2, status = $3, paid_at = CASE WHEN $4::boolean AND paid_at IS NULL THEN $5::timestamptz ELSE paid_at END,
           updated_at = now() WHERE id = $1 RETURNING *`,
        [invoiceId, newPaid.toString(), status, settlesNow, now],
      );
      inv = rows[0]!;

      if (settlesNow && inv.ack_method === "EIP712" && inv.invoice_hash) {
        await q.query("UPDATE record_entries SET paid_at = $2 WHERE invoice_hash = $1", [inv.invoice_hash, inv.paid_at]);
        await enqueueChainJob(q, "RECORD_SETTLED", `settle:${inv.invoice_hash}`, {
          invoiceHash: inv.invoice_hash,
          paidAt: Math.floor(new Date(inv.paid_at!).getTime() / 1000),
        });
      }
      if (kind !== "EXACT") anomalies.push({ paymentId: id, kind, amount: p.amount, from: p.from });
    }
  });

  for (const a of anomalies) await reconcileAnomaly(ctx, invoiceId, a);
  return inserted;
}

async function reconcileAnomaly(ctx: Ctx, invoiceId: string, a: Anomaly) {
  const inv = await getInvoice(ctx.db, invoiceId);
  const due = inv.status === "CANCELLED" ? 0n : amountDue(inv, ctx.now());
  const excess = await refundableExcess(ctx.db, inv, due);
  const paid = minorFromString(inv.paid_minor);
  const outstanding = paid >= due ? 0n : due - paid;
  const policy = await loadPolicy(ctx.db, inv.freelancer_id);

  await runDecision(ctx, {
    freelancerId: inv.freelancer_id,
    subjectType: "invoice",
    subjectId: inv.id,
    triggerKey: `reconcile:${a.paymentId}`,
    snapshot: {
      decisionType: "RECONCILE",
      subject: { type: "invoice", id: inv.id },
      evidence: {
        "payment:classification": a.kind,
        "payment:amount_minor": a.amount.toString(),
        "payment:attributed_sender": a.from,
        "invoice:amount_due_minor": due.toString(),
        "invoice:total_paid_minor": paid.toString(),
        "invoice:status": inv.status,
        "reconcile:excess_minor": excess.toString(),
        "reconcile:outstanding_minor": outstanding.toString(),
        ...policyEvidence(policy),
      },
      untrusted: [],
    },
    policyCtx: { refundableExcessMinor: excess },
  });
}
