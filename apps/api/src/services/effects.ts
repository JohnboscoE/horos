import type { AgentProposal } from "@horos/core";
import type { Ctx } from "../context.js";
import type { Queryable } from "../db/db.js";
import type { DecisionRow, InvoiceRow } from "../db/rows.js";
import { appendLog } from "./decisionLog.js";
import { finalizeTerms } from "./invoices.js";
import { createRefundIntent } from "./refunds.js";

const DAY_MS = 86_400_000;

/**
 * Apply an AUTO_APPLIED or APPROVED decision. Idempotent: every effect is keyed by the decision id,
 * and the status flip to EXECUTED happens in the same transaction as the effect.
 * Refunds are only *created* here (AWAITING_PAYER); money moves later in the executor, after the
 * payer confirms an address.
 */
export async function applyDecision(ctx: Ctx, decisionId: string): Promise<DecisionRow> {
  try {
    return await ctx.db.tx(async (q) => {
      const d = (await q.query<DecisionRow>("SELECT * FROM agent_decisions WHERE id = $1 FOR UPDATE", [decisionId]))[0];
      if (!d) throw new Error(`decision ${decisionId} not found`);
      if (d.final_status === "EXECUTED") return d;
      if (d.final_status !== "AUTO_APPLIED" && d.final_status !== "APPROVED") {
        throw new Error(`decision ${decisionId} is ${d.final_status}, not executable`);
      }
      const summary = await applyEffect(ctx, q, d, d.proposal_json);
      const rows = await q.query<DecisionRow>(
        "UPDATE agent_decisions SET final_status = 'EXECUTED', updated_at = now() WHERE id = $1 RETURNING *",
        [decisionId],
      );
      await appendLog(ctx, q, { kind: "DECISION_EXECUTED", decisionId, data: summary, at: ctx.now().toISOString() });
      return rows[0]!;
    });
  } catch (e) {
    const msg = (e as Error).message;
    await ctx.db.tx(async (q) => {
      const rows = await q.query("UPDATE agent_decisions SET final_status = 'FAILED', updated_at = now() WHERE id = $1 AND final_status IN ('AUTO_APPLIED','APPROVED') RETURNING id", [decisionId]);
      if (rows[0]) await appendLog(ctx, q, { kind: "DECISION_FAILED", decisionId, data: { error: msg }, at: ctx.now().toISOString() });
    });
    throw e;
  }
}

async function loadInvoice(q: Queryable, id: string): Promise<InvoiceRow> {
  const inv = (await q.query<InvoiceRow>("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [id]))[0];
  if (!inv) throw new Error(`invoice ${id} not found`);
  return inv;
}

async function message(q: Queryable, invoiceId: string, decisionId: string, audience: "CLIENT" | "FREELANCER", kind: string, body: string, params: object = {}) {
  await q.query(
    `INSERT INTO client_messages (id, invoice_id, decision_id, audience, kind, body, params)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (decision_id, invoice_id) DO NOTHING`,
    [`msg_${decisionId}_${invoiceId}`, invoiceId, decisionId, audience, kind, body, JSON.stringify(params)],
  );
}

async function applyEffect(ctx: Ctx, q: Queryable, d: DecisionRow, p: AgentProposal): Promise<Record<string, unknown>> {
  switch (p.decision_type) {
    case "SET_TERMS": {
      const inv = await loadInvoice(q, d.subject_id);
      const done = await finalizeTerms(ctx, q, inv, p.params, d.id);
      return { effect: "TERMS_SET", invoiceId: inv.id, ...p.params, invoiceHash: done.invoice_hash, dueDate: done.due_date };
    }

    case "EARLY_PAY_OFFER": {
      if (p.action === "NO_OFFER") return { effect: "NONE" };
      for (const o of p.params.offers) {
        const inv = await loadInvoice(q, o.invoice_id);
        if (inv.freelancer_id !== d.freelancer_id) throw new Error("offer targets another freelancer's invoice");
        const expires = new Date(ctx.now().getTime() + o.valid_for_days * DAY_MS).toISOString();
        const terms = { ...inv.terms_json!, early_pay_offer: { discount_bps: o.discount_bps, expires_at: expires, decision_id: d.id } };
        await q.query("UPDATE invoices SET terms_json = $2, updated_at = now() WHERE id = $1", [inv.id, JSON.stringify(terms)]);
        await message(q, inv.id, d.id, "CLIENT", "EARLY_PAY_OFFER",
          `Pay within ${o.valid_for_days} day${o.valid_for_days === 1 ? "" : "s"} and take ${o.discount_bps / 100}% off this invoice.`,
          { discount_bps: o.discount_bps, expires_at: expires });
      }
      return { effect: "OFFERS_SENT", offers: p.params.offers };
    }

    case "COLLECTION_STEP": {
      const inv = await loadInvoice(q, d.subject_id);
      const toFreelancer = p.action === "ESCALATE" || p.action === "FLAG_PAUSE_WORK";
      if (p.action === "DISCOUNT_OFFER" && p.params.discount_bps !== undefined) {
        const expires = new Date(ctx.now().getTime() + 3 * DAY_MS).toISOString();
        const terms = { ...inv.terms_json!, early_pay_offer: { discount_bps: p.params.discount_bps, expires_at: expires, decision_id: d.id } };
        await q.query("UPDATE invoices SET terms_json = $2, updated_at = now() WHERE id = $1", [inv.id, JSON.stringify(terms)]);
      }
      if (p.action === "FLAG_PAUSE_WORK") {
        await q.query(
          `INSERT INTO client_flags (freelancer_id, client_id, pause_work, decision_id) VALUES ($1,$2,TRUE,$3)
           ON CONFLICT (freelancer_id, client_id) DO UPDATE SET pause_work = TRUE, decision_id = $3, updated_at = now()`,
          [inv.freelancer_id, inv.client_id, d.id],
        );
      }
      await message(q, inv.id, d.id, toFreelancer ? "FREELANCER" : "CLIENT", p.action, p.params.message, {
        discount_bps: p.params.discount_bps,
        late_fee_bps: p.params.late_fee_bps,
      });
      return { effect: p.action, invoiceId: inv.id };
    }

    case "RECONCILE": {
      const inv = await loadInvoice(q, d.subject_id);
      if (p.action === "PROPOSE_REFUND") {
        const intent = await createRefundIntent(ctx, q, inv, BigInt(p.params.refund_amount_minor!), d.id);
        return { effect: "REFUND_INTENT_CREATED", refundId: intent.id, amountMinor: p.params.refund_amount_minor, awaiting: "payer address confirmation" };
      }
      if (p.action === "REQUEST_BALANCE") {
        await message(q, inv.id, d.id, "CLIENT", "REQUEST_BALANCE", p.params.note);
        return { effect: "BALANCE_REQUESTED" };
      }
      return { effect: "NONE" };
    }
  }
}
