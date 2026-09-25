import { minorFromString } from "@horos/core";
import { getAddress, isAddress, type Address } from "viem";
import type { Ctx } from "../context.js";
import { newId, newToken } from "../context.js";
import type { Queryable } from "../db/db.js";
import type { InvoiceRow, RefundRow } from "../db/rows.js";
import { HttpError } from "../errors.js";
import { appendLog } from "./decisionLog.js";

/**
 * Refunds (SPEC §3.9, §6):
 *  1. RECONCILE decision creates an intent (AWAITING_PAYER). Nothing moves yet.
 *  2. The payer confirms a refund address on the pay page (READY). We never auto-refund to the sender,
 *     which may be an exchange's shared hot wallet.
 *  3. The executor submits via Circle with an idempotency key derived from the intent (SUBMITTED),
 *     then polls to COMPLETED. The intent is persisted before submission, so a restart resumes it.
 */

/** Money received above what's owed, minus refunds already live or done. Only this can be refunded. */
export async function refundableExcess(q: Queryable, inv: InvoiceRow, amountDueMinor: bigint): Promise<bigint> {
  const [r] = await q.query<{ s: string | null }>(
    "SELECT COALESCE(SUM(amount_minor), 0)::text AS s FROM refund_intents WHERE invoice_id = $1 AND status NOT IN ('FAILED','CANCELLED')",
    [inv.id],
  );
  const excess = minorFromString(inv.paid_minor) - amountDueMinor - minorFromString(r?.s ?? "0");
  return excess > 0n ? excess : 0n;
}

export async function createRefundIntent(ctx: Ctx, q: Queryable, inv: InvoiceRow, amount: bigint, decisionId: string): Promise<RefundRow> {
  const existing = (await q.query<RefundRow>("SELECT * FROM refund_intents WHERE idempotency_key = $1", [`refund:${decisionId}`]))[0];
  if (existing) return existing;
  // Re-check under the invoice row lock (the caller holds it): refunds can never exceed the excess.
  const { amountDue } = await import("./invoices.js");
  const due = inv.status === "CANCELLED" ? 0n : amountDue(inv, ctx.now());
  const available = await refundableExcess(q, inv, due);
  if (amount <= 0n || amount > available) {
    throw new Error(`refund ${amount} exceeds refundable excess ${available}`);
  }
  // Suggest the sender of the most recent payment, but never use it without confirmation.
  const [last] = await q.query<{ from_address: string | null }>(
    "SELECT from_address FROM payments WHERE invoice_id = $1 ORDER BY detected_at DESC LIMIT 1",
    [inv.id],
  );
  const rows = await q.query<RefundRow>(
    `INSERT INTO refund_intents (id, invoice_id, decision_id, amount_minor, suggested_address, confirm_token, status, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,'AWAITING_PAYER',$7) RETURNING *`,
    [newId("rfd"), inv.id, decisionId, amount.toString(), last?.from_address ?? null, newToken(), `refund:${decisionId}`],
  );
  await q.query("UPDATE invoices SET status = 'REFUND_PENDING', updated_at = now() WHERE id = $1 AND status = 'OVERPAID'", [inv.id]);
  return rows[0]!;
}

export async function confirmRefundAddress(ctx: Ctx, confirmToken: string, address: string): Promise<RefundRow> {
  if (!isAddress(address)) throw new HttpError(400, "Not a valid address");
  const to = getAddress(address);
  return ctx.db.tx(async (q) => {
    const rows = await q.query<RefundRow>(
      `UPDATE refund_intents SET to_address = $2, status = 'READY', confirmed_by_payer_at = now(), updated_at = now()
       WHERE confirm_token = $1 AND status = 'AWAITING_PAYER' RETURNING *`,
      [confirmToken, to],
    );
    if (!rows[0]) throw new HttpError(409, "This refund is not awaiting confirmation");
    await appendLog(ctx, q, {
      kind: "DECISION_APPROVED",
      decisionId: rows[0].decision_id ?? rows[0].id,
      data: { refundId: rows[0].id, payerConfirmedAddress: to },
      at: ctx.now().toISOString(),
    });
    return rows[0];
  });
}

/** Executor loop body. Safe to run concurrently with itself and after restarts. */
export async function processRefunds(ctx: Ctx): Promise<void> {
  if (ctx.cfg.killSwitch) return;
  const token = ctx.cfg.network.usdc;

  const ready = await ctx.db.query<RefundRow & { deposit_wallet_id: string; currency: string }>(
    `SELECT r.*, i.deposit_wallet_id, i.currency FROM refund_intents r JOIN invoices i ON i.id = r.invoice_id
     WHERE r.status = 'READY' ORDER BY r.created_at LIMIT 10`,
  );
  for (const r of ready) {
    const tokenAddr = r.currency === "EURC" ? ctx.cfg.network.eurc : token;
    if (!tokenAddr) continue;
    try {
      // Same idempotency key on every retry → Circle returns the same transfer, never a second one.
      const { circleTxId } = await ctx.circle.transfer({
        walletId: r.deposit_wallet_id,
        to: r.to_address as Address,
        token: tokenAddr,
        amountMinor: minorFromString(r.amount_minor),
        idempotencyKey: r.idempotency_key,
      });
      await ctx.db.query(
        "UPDATE refund_intents SET status = 'SUBMITTED', circle_tx_id = $2, attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'READY'",
        [r.id, circleTxId],
      );
    } catch (e) {
      await ctx.db.query("UPDATE refund_intents SET last_error = $2, attempts = attempts + 1, updated_at = now() WHERE id = $1", [
        r.id,
        (e as Error).message.slice(0, 500),
      ]);
    }
  }

  const submitted = await ctx.db.query<RefundRow>("SELECT * FROM refund_intents WHERE status = 'SUBMITTED' LIMIT 20");
  for (const r of submitted) {
    const st = await ctx.circle.getTransfer(r.circle_tx_id!);
    if (st.state === "PENDING") continue;
    await ctx.db.tx(async (q) => {
      if (st.state === "COMPLETE") {
        const upd = await q.query<RefundRow>(
          `UPDATE refund_intents SET status = 'COMPLETED', tx_hash = $2, fee_minor = $3, updated_at = now()
           WHERE id = $1 AND status = 'SUBMITTED' RETURNING *`,
          [r.id, st.txHash ?? null, (st.feeMinor ?? 0n).toString()],
        );
        if (!upd[0]) return;
        // Track our own outflow (amount + gas) so the watcher's expected balance stays exact.
        await q.query(
          `UPDATE invoices SET outgoing_minor = outgoing_minor + $2,
             status = CASE WHEN status = 'REFUND_PENDING' THEN 'REFUNDED' ELSE status END, updated_at = now()
           WHERE id = $1`,
          [r.invoice_id, (minorFromString(r.amount_minor) + (st.feeMinor ?? 0n)).toString()],
        );
        await appendLog(ctx, q, {
          kind: "DECISION_EXECUTED",
          decisionId: r.decision_id ?? r.id,
          data: { refundId: r.id, txHash: st.txHash ?? null, amountMinor: r.amount_minor, feeMinor: (st.feeMinor ?? 0n).toString() },
          at: ctx.now().toISOString(),
        });
      } else {
        const upd = await q.query("UPDATE refund_intents SET status = 'FAILED', last_error = $2, updated_at = now() WHERE id = $1 AND status = 'SUBMITTED' RETURNING id", [
          r.id,
          st.error ?? "failed",
        ]);
        if (upd[0]) {
          await q.query("UPDATE invoices SET status = 'OVERPAID', updated_at = now() WHERE id = $1 AND status = 'REFUND_PENDING'", [r.invoice_id]);
          await appendLog(ctx, q, { kind: "DECISION_FAILED", decisionId: r.decision_id ?? r.id, data: { refundId: r.id, error: st.error ?? "failed" }, at: ctx.now().toISOString() });
        }
      }
    });
  }
}
