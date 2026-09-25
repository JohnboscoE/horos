import { formatAmount, minorFromString } from "@horos/core";
import type { Ctx } from "../context.js";
import { newId } from "../context.js";
import type { InvoiceRow } from "../db/rows.js";
import { policyEvidence, statsEvidence } from "../agent/snapshot.js";
import { runDecision } from "./agent.js";
import { enqueueChainJob } from "./chainJobs.js";
import { logHead } from "./decisionLog.js";
import { freelancerForecast } from "./forecast.js";
import { amountDue } from "./invoices.js";
import { loadPolicy, networkStats, privateStats } from "./stats.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Hours between collection steps on one invoice. Short during the event so lateness shows up. */
export const COLLECTION_CADENCE_HOURS = Number(process.env.COLLECTION_CADENCE_HOURS ?? 24);

/** Mark open invoices past due as OVERDUE and ask the agent for the next collection step. */
export async function runCollections(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  await ctx.db.query(
    `UPDATE invoices SET status = 'OVERDUE', updated_at = now()
     WHERE status IN ('SENT','ACKNOWLEDGED','PARTIALLY_PAID') AND due_date < $1 AND network = $2`,
    [now, ctx.cfg.network.network],
  );
  const overdue = await ctx.db.query<InvoiceRow>("SELECT * FROM invoices WHERE status = 'OVERDUE' AND network = $1", [ctx.cfg.network.network]);

  let n = 0;
  for (const inv of overdue) {
    const msOver = now.getTime() - new Date(inv.due_date!).getTime();
    const bucket = Math.floor(msOver / (COLLECTION_CADENCE_HOURS * HOUR_MS));
    const trigger = `collect:${inv.id}:${bucket}`;
    const done = await ctx.db.query("SELECT 1 FROM agent_decisions WHERE trigger_key = $1", [trigger]);
    if (done[0]) continue;

    const policy = await loadPolicy(ctx.db, inv.freelancer_id);
    const net = await networkStats(ctx.db, inv.client_id, now);
    const priv = await privateStats(ctx.db, inv.freelancer_id, inv.client_id, now, inv.id);
    const fc = await freelancerForecast(ctx.db, inv.freelancer_id, now);
    const prev = await ctx.db.query<{ id: string; proposal_json: { action: string }; created_at: Date }>(
      `SELECT id, proposal_json, created_at FROM agent_decisions
       WHERE subject_id = $1 AND decision_type = 'COLLECTION_STEP' AND final_status IN ('EXECUTED','AUTO_APPLIED','APPROVED','PENDING_APPROVAL')
       ORDER BY created_at`,
      [inv.id],
    );
    const responses = await ctx.db.query<{ response_text: string | null }>(
      "SELECT response_text FROM record_entries WHERE invoice_id = $1 AND response_text IS NOT NULL",
      [inv.id],
    );
    const paid = minorFromString(inv.paid_minor);
    const due = amountDue(inv, now);

    const evidence: Record<string, string | number | boolean | null> = {
      "invoice:days_overdue": Math.floor(msOver / DAY_MS),
      "invoice:amount_minor": inv.amount_minor,
      "invoice:outstanding_minor": (due > paid ? due - paid : 0n).toString(),
      "invoice:acknowledged": inv.ack_at !== null,
      "history:previous_steps": prev.map((p) => p.proposal_json.action).join(",") || "none",
      ...(net.displayable ? statsEvidence("network", net) : { "stat:network_score_available": false }),
      ...statsEvidence("private", priv),
      ...policyEvidence(policy),
      "forecast:shortfall_total_minor": fc.totalShortfallMinor.toString(),
    };
    for (const p of prev) evidence[`prev_decision:${p.id}`] = `${p.proposal_json.action} on ${new Date(p.created_at).toISOString().slice(0, 10)}`;

    try {
      await runDecision(ctx, {
        freelancerId: inv.freelancer_id,
        subjectType: "invoice",
        subjectId: inv.id,
        triggerKey: trigger,
        snapshot: {
          decisionType: "COLLECTION_STEP",
          subject: { type: "invoice", id: inv.id },
          evidence,
          untrusted: responses.map((r, i) => ({ ref: `client_text:${i}`, text: r.response_text! })),
        },
        policyCtx: { invoiceAmountMinor: minorFromString(inv.amount_minor) },
      });
      n++;
    } catch (e) {
      console.error(`[collections] ${inv.id}: ${(e as Error).message}`);
    }
  }
  return n;
}

/** When a freelancer's forecast shows a shortfall, ask the agent which invoices get an early-pay offer. */
export async function runEarlyPayOffers(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  const freelancers = await ctx.db.query<{ freelancer_id: string }>("SELECT DISTINCT freelancer_id FROM cash_needs WHERE due_date > $1", [now]);
  let n = 0;
  for (const { freelancer_id } of freelancers) {
    const fc = await freelancerForecast(ctx.db, freelancer_id, now);
    if (fc.totalShortfallMinor <= 0n) continue;
    // One decision per freelancer per day per shortfall size, so a changed forecast gets a fresh look.
    const trigger = `earlypay:${freelancer_id}:${now.toISOString().slice(0, 10)}:${fc.totalShortfallMinor}`;
    const policy = await loadPolicy(ctx.db, freelancer_id);

    // Eligible: open, terms set, no live offer, not overdue (overdue ones go through collections).
    const eligible = fc.receivables.filter((r) => r.status === "SENT" || r.status === "ACKNOWLEDGED" || r.status === "PARTIALLY_PAID");
    const liveOffers = await ctx.db.query<{ id: string }>(
      "SELECT id FROM invoices WHERE freelancer_id = $1 AND (terms_json->'early_pay_offer'->>'expires_at')::timestamptz > $2",
      [freelancer_id, now],
    );
    const live = new Set(liveOffers.map((r) => r.id));
    const candidates = eligible.filter((r) => !live.has(r.invoiceId));
    if (candidates.length === 0) continue;

    const evidence: Record<string, string | number | boolean | null> = {
      "forecast:shortfall_total_minor": fc.totalShortfallMinor.toString(),
      "forecast:starting_balance_minor": fc.startingBalanceMinor.toString(),
      ...policyEvidence(policy),
    };
    for (const s of fc.shortfalls) {
      const need = fc.needs.find((x) => x.id === s.needId);
      evidence[`cash_need:${s.needId}`] = `${need?.label ?? "need"} on ${new Date(s.at * 1000).toISOString().slice(0, 10)}: short ${formatAmount(s.shortfallMinor)} USDC`;
    }
    for (const c of candidates) {
      evidence[`candidate:${c.invoiceId}:outstanding_minor`] = c.outstandingMinor.toString();
      evidence[`candidate:${c.invoiceId}:due_date`] = new Date(c.dueDate * 1000).toISOString().slice(0, 10);
      evidence[`candidate:${c.invoiceId}:client_on_time_rate`] = c.clientOnTimeRate;
      evidence[`candidate:${c.invoiceId}:client_expected_days_late`] = c.expectedDaysLate;
    }
    try {
      await runDecision(ctx, {
        freelancerId: freelancer_id,
        subjectType: "freelancer",
        subjectId: freelancer_id,
        triggerKey: trigger,
        snapshot: { decisionType: "EARLY_PAY_OFFER", subject: { type: "freelancer", id: freelancer_id }, evidence, untrusted: [] },
        policyCtx: { eligibleInvoiceIds: candidates.map((c) => c.invoiceId) },
      });
      n++;
    } catch (e) {
      console.error(`[earlypay] ${freelancer_id}: ${(e as Error).message}`);
    }
  }
  return n;
}

/** Anchor the decision-log head every `anchorEvery` entries, or hourly if anything changed. */
export async function maybeAnchor(ctx: Ctx): Promise<boolean> {
  const { count, head } = await logHead(ctx);
  if (count === 0) return false;
  const [last] = await ctx.db.query<{ count: number; created_at: Date }>("SELECT count, created_at FROM decision_anchors ORDER BY count DESC LIMIT 1");
  const lastCount = last?.count ?? 0;
  if (count <= lastCount) return false;
  const due = count - lastCount >= ctx.cfg.anchorEvery || !last || ctx.now().getTime() - new Date(last.created_at).getTime() > HOUR_MS;
  if (!due) return false;
  await ctx.db.tx(async (q) => {
    await q.query("INSERT INTO decision_anchors (id, chain_head, count, status) VALUES ($1,$2,$3,'PENDING') ON CONFLICT (count) DO NOTHING", [newId("anc"), head, count]);
    await enqueueChainJob(q, "ANCHOR", `anchor:${count}`, { chainHead: head, count });
  });
  return true;
}
