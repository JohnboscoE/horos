import { randomBytes } from "node:crypto";
import {
  amountBand,
  applyBps,
  clientIdHash,
  formatAmount,
  freelancerIdHash,
  invoiceHash,
  minorFromString,
  verifyInvoiceAck,
  type InvoiceMessage,
  type SetTermsProposal,
} from "@horos/core";
import { getAddress, type Address, type Hex } from "viem";
import type { Ctx } from "../context.js";
import { newId, newToken } from "../context.js";
import type { Queryable } from "../db/db.js";
import type { ClientRow, DecisionRow, FreelancerRow, InvoiceRow, InvoiceTerms } from "../db/rows.js";
import { HttpError } from "../errors.js";
import { policyEvidence, statsEvidence, type Snapshot } from "../agent/snapshot.js";
import { runDecision } from "./agent.js";
import { appendLog } from "./decisionLog.js";
import { freelancerForecast } from "./forecast.js";
import { enqueueChainJob } from "./chainJobs.js";
import { loadPolicy, networkStats, privateStats } from "./stats.js";

const DAY_S = 86_400;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function upsertClient(q: Queryable, displayName: string, orgSlug: string): Promise<ClientRow> {
  const slug = slugify(orgSlug || displayName);
  if (!slug) throw new HttpError(400, "Client organization is required");
  const existing = (await q.query<ClientRow>("SELECT * FROM clients WHERE org_slug = $1", [slug]))[0];
  if (existing) return existing;
  const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
  const rows = await q.query<ClientRow>(
    `INSERT INTO clients (id, display_name, org_slug, salt, client_id_hash) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_slug) DO NOTHING RETURNING *`,
    [newId("cli"), displayName.trim() || slug, slug, salt, clientIdHash(slug, salt)],
  );
  return rows[0] ?? (await q.query<ClientRow>("SELECT * FROM clients WHERE org_slug = $1", [slug]))[0]!;
}

export interface CreateInvoiceInput {
  clientName: string;
  clientOrg?: string;
  clientEmail?: string;
  currency: "USDC" | "EURC";
  amountMinor: bigint;
  description?: string;
  isSelfTest?: boolean;
}

export async function createInvoice(ctx: Ctx, freelancerId: string, input: CreateInvoiceInput) {
  if (ctx.cfg.killSwitch) throw new HttpError(503, "Horos is paused (kill switch)");
  if (input.amountMinor <= 0n) throw new HttpError(400, "Amount must be positive");
  if (input.amountMinor > ctx.cfg.maxInvoiceMinor) {
    throw new HttpError(400, `Amount exceeds the per-invoice cap of ${formatAmount(ctx.cfg.maxInvoiceMinor)}`);
  }
  if (input.currency === "EURC" && !ctx.cfg.network.eurc) throw new HttpError(400, "EURC is not enabled on this network yet");

  const client = await upsertClient(ctx.db, input.clientName, input.clientOrg ?? input.clientName);
  if (input.clientEmail) {
    await ctx.db.query(
      "INSERT INTO client_contacts (client_id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [client.id, input.clientEmail.trim().toLowerCase()],
    );
  }

  const id = newId("inv");
  // External call before the insert; Circle's idempotency key (derived from the invoice id) makes a retry safe.
  const wallet = await ctx.circle.createWallet(id, `horos-deposit-${id}`);
  await ctx.db.query(
    `INSERT INTO invoices (id, freelancer_id, client_id, currency, amount_minor, description, status,
                           deposit_wallet_id, deposit_address, pay_token, is_self_test, network, issued_at)
     VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12)`,
    [
      id,
      freelancerId,
      client.id,
      input.currency,
      input.amountMinor.toString(),
      input.description ?? "",
      wallet.walletId,
      wallet.address,
      newToken(),
      input.isSelfTest ?? false,
      ctx.cfg.network.network,
      ctx.now(),
    ],
  );
  const invoice = await getInvoice(ctx.db, id);
  const decision = await proposeTerms(ctx, invoice);
  return { invoice: await getInvoice(ctx.db, id), decision };
}

export async function getInvoice(q: Queryable, id: string): Promise<InvoiceRow> {
  const inv = (await q.query<InvoiceRow>("SELECT * FROM invoices WHERE id = $1", [id]))[0];
  if (!inv) throw new HttpError(404, "Invoice not found");
  return inv;
}

export async function buildSetTermsSnapshot(ctx: Ctx, inv: InvoiceRow): Promise<Snapshot> {
  const now = ctx.now();
  const policy = await loadPolicy(ctx.db, inv.freelancer_id);
  const net = await networkStats(ctx.db, inv.client_id, now);
  const priv = await privateStats(ctx.db, inv.freelancer_id, inv.client_id, now, inv.id);
  const fc = await freelancerForecast(ctx.db, inv.freelancer_id, now);
  const flag = (await ctx.db.query<{ pause_work: boolean }>(
    "SELECT pause_work FROM client_flags WHERE freelancer_id = $1 AND client_id = $2",
    [inv.freelancer_id, inv.client_id],
  ))[0];

  const evidence: Snapshot["evidence"] = {
    "invoice:amount_minor": inv.amount_minor,
    "invoice:currency": inv.currency,
    ...(net.displayable ? statsEvidence("network", net) : { "stat:network_score_available": false, "stat:network_invoice_count": net.invoiceCount }),
    ...statsEvidence("private", priv),
    ...policyEvidence(policy),
    "forecast:shortfall_total_minor": fc.totalShortfallMinor.toString(),
    "client:pause_work_flag": flag?.pause_work ?? false,
  };
  for (const s of fc.shortfalls) {
    const need = fc.needs.find((n) => n.id === s.needId);
    evidence[`cash_need:${s.needId}`] = `${need?.label ?? "need"}: short ${formatAmount(s.shortfallMinor)} USDC on ${new Date(s.at * 1000).toISOString().slice(0, 10)}`;
  }
  return { decisionType: "SET_TERMS", subject: { type: "invoice", id: inv.id }, evidence, untrusted: [] };
}

export async function proposeTerms(ctx: Ctx, inv: InvoiceRow): Promise<DecisionRow> {
  return runDecision(ctx, {
    freelancerId: inv.freelancer_id,
    subjectType: "invoice",
    subjectId: inv.id,
    triggerKey: `terms:${inv.id}`,
    snapshot: await buildSetTermsSnapshot(ctx, inv),
    policyCtx: { invoiceAmountMinor: minorFromString(inv.amount_minor) },
  });
}

/** Freelancer overrides the agent's terms. Recorded in the log as a MANUAL decision. */
export async function setManualTerms(ctx: Ctx, freelancerId: string, invoiceId: string, params: SetTermsProposal["params"]) {
  const inv = await getInvoice(ctx.db, invoiceId);
  if (inv.freelancer_id !== freelancerId) throw new HttpError(404, "Invoice not found");
  if (inv.status !== "DRAFT") throw new HttpError(409, "Terms are already set");
  const id = newId("dec");
  const proposal: SetTermsProposal = {
    decision_type: "SET_TERMS",
    action: "PROPOSE_TERMS",
    params,
    reasoning: "Terms set manually by the freelancer.",
    evidence_refs: ["manual"],
    confidence: 1,
  };
  await ctx.db.tx(async (q) => {
    // Any pending agent proposal for these terms is superseded.
    await q.query(
      "UPDATE agent_decisions SET final_status = 'REJECTED', decided_by = $2, updated_at = now() WHERE trigger_key = $1 AND final_status = 'PENDING_APPROVAL'",
      [`terms:${invoiceId}`, freelancerId],
    );
    await q.query(
      `INSERT INTO agent_decisions (id, freelancer_id, subject_type, subject_id, decision_type, trigger_key, input_snapshot,
         input_snapshot_hash, proposal_json, reasoning, evidence_refs, source, policy_result, final_status, decided_by)
       VALUES ($1,$2,'invoice',$3,'SET_TERMS',$4,'{}'::jsonb,'0x',$5,$6,'["manual"]','MANUAL','{"outcome":"AUTO_APPLY","reasons":["freelancer override"]}','APPROVED',$2)`,
      [id, freelancerId, invoiceId, `terms-manual:${invoiceId}:${id}`, JSON.stringify(proposal), proposal.reasoning],
    );
    await appendLog(ctx, q, { kind: "DECISION_APPROVED", decisionId: id, data: { manual: true, by: freelancerId, proposal }, at: ctx.now().toISOString() });
  });
  const { applyDecision } = await import("./effects.js");
  return applyDecision(ctx, id);
}

function messageFromTerms(terms: InvoiceTerms): InvoiceMessage {
  const m = terms.ack_message;
  return {
    invoiceId: String(m.invoiceId),
    freelancerIdHash: m.freelancerIdHash as Hex,
    freelancerName: String(m.freelancerName),
    clientOrg: String(m.clientOrg),
    currency: m.currency as "USDC" | "EURC",
    amount: BigInt(m.amount!),
    dueDate: BigInt(m.dueDate!),
    netDays: Number(m.netDays),
    depositBps: Number(m.depositBps),
    earlyPayDiscountBps: Number(m.earlyPayDiscountBps),
    depositAddress: m.depositAddress as Address,
  };
}

/** DRAFT → SENT: fixes terms and the EIP-712 message the client will sign. */
export async function finalizeTerms(
  ctx: Ctx,
  q: Queryable,
  inv: InvoiceRow,
  params: SetTermsProposal["params"],
  decisionId: string,
): Promise<InvoiceRow> {
  if (inv.status !== "DRAFT") return inv;
  const fr = (await q.query<FreelancerRow>("SELECT * FROM freelancers WHERE id = $1", [inv.freelancer_id]))[0]!;
  const client = (await q.query<ClientRow>("SELECT * FROM clients WHERE id = $1", [inv.client_id]))[0]!;
  const issuedS = Math.floor(new Date(inv.issued_at).getTime() / 1000);
  const dueS = issuedS + params.net_days * DAY_S;
  const msg: InvoiceMessage = {
    invoiceId: inv.id,
    freelancerIdHash: freelancerIdHash(fr.id),
    freelancerName: fr.name,
    clientOrg: client.org_slug,
    currency: inv.currency,
    amount: minorFromString(inv.amount_minor),
    dueDate: BigInt(dueS),
    netDays: params.net_days,
    depositBps: params.deposit_bps,
    earlyPayDiscountBps: params.early_pay_discount_bps,
    depositAddress: getAddress(inv.deposit_address!),
  };
  const terms: InvoiceTerms = {
    ...params,
    decision_id: decisionId,
    ack_message: { ...msg, amount: msg.amount.toString(), dueDate: msg.dueDate.toString() },
  };
  const hash = invoiceHash(ctx.cfg.network.chain.id, msg);
  const rows = await q.query<InvoiceRow>(
    `UPDATE invoices SET terms_json = $2, due_date = to_timestamp($3), invoice_hash = $4, status = 'SENT', updated_at = now()
     WHERE id = $1 AND status = 'DRAFT' RETURNING *`,
    [inv.id, JSON.stringify(terms), dueS, hash],
  );
  return rows[0] ?? inv;
}

export function ackTypedData(ctx: Ctx, inv: InvoiceRow) {
  if (!inv.terms_json) throw new HttpError(409, "Invoice terms are not set yet");
  return { chainId: ctx.cfg.network.chain.id, message: messageFromTerms(inv.terms_json) };
}

/** Client signs the EIP-712 invoice. Only these acknowledgments count toward the shared record. */
export async function acknowledgeInvoice(ctx: Ctx, payToken: string, signature: Hex, signer: Address) {
  const inv = (await ctx.db.query<InvoiceRow>("SELECT * FROM invoices WHERE pay_token = $1", [payToken]))[0];
  if (!inv) throw new HttpError(404, "Invoice not found");
  if (inv.ack_at) return inv;
  if (!["SENT", "OVERDUE", "PARTIALLY_PAID", "PAID", "OVERPAID"].includes(inv.status)) {
    throw new HttpError(409, `Invoice is ${inv.status} and can't be acknowledged`);
  }
  const { chainId, message } = ackTypedData(ctx, inv);
  if (!(await verifyInvoiceAck(chainId, message, signature, signer))) throw new HttpError(400, "Signature does not match this invoice");

  return ctx.db.tx(async (q) => {
    const rows = await q.query<InvoiceRow>(
      `UPDATE invoices SET ack_signature = $2, ack_signer = $3, ack_method = 'EIP712', ack_at = now(),
         status = CASE WHEN status = 'SENT' THEN 'ACKNOWLEDGED' ELSE status END, updated_at = now()
       WHERE id = $1 AND ack_at IS NULL RETURNING *`,
      [inv.id, signature, getAddress(signer)],
    );
    const updated = rows[0];
    if (!updated) return inv;
    const client = (await q.query<ClientRow>("SELECT * FROM clients WHERE id = $1", [inv.client_id]))[0]!;
    const band = amountBand(minorFromString(inv.amount_minor)); // EURC treated 1:1 for banding until FX lands
    await q.query(
      `INSERT INTO record_entries (invoice_hash, invoice_id, client_id, client_id_hash, freelancer_id, due_date, paid_at, amount_band)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (invoice_hash) DO NOTHING`,
      [inv.invoice_hash, inv.id, inv.client_id, client.client_id_hash, inv.freelancer_id, inv.due_date, inv.paid_at, band],
    );
    await enqueueChainJob(q, "RECORD_ACK", `ack:${inv.invoice_hash}`, {
      invoiceHash: inv.invoice_hash,
      clientIdHash: client.client_id_hash,
      freelancerIdHash: freelancerIdHash(inv.freelancer_id),
      dueDate: Math.floor(new Date(inv.due_date!).getTime() / 1000),
      amountBand: band,
    });
    if (inv.paid_at) {
      await enqueueChainJob(q, "RECORD_SETTLED", `settle:${inv.invoice_hash}`, {
        invoiceHash: inv.invoice_hash,
        paidAt: Math.floor(new Date(inv.paid_at).getTime() / 1000),
      });
    }
    return updated;
  });
}

/** Weaker path for clients without a wallet: recorded, but excluded from the shared record. */
export async function acknowledgeByEmail(ctx: Ctx, payToken: string, name: string) {
  const rows = await ctx.db.query<InvoiceRow>(
    `UPDATE invoices SET ack_method = 'EMAIL', ack_signer = $2, ack_at = now(),
       status = CASE WHEN status = 'SENT' THEN 'ACKNOWLEDGED' ELSE status END, updated_at = now()
     WHERE pay_token = $1 AND ack_at IS NULL AND status <> 'DRAFT' AND status <> 'CANCELLED' RETURNING *`,
    [payToken, `email:${name.trim().slice(0, 80)}`],
  );
  if (!rows[0]) throw new HttpError(409, "Invoice can't be acknowledged");
  return rows[0];
}

/** Amount that settles the invoice if paid at `at`, after any active early-pay discount. */
export function amountDue(inv: InvoiceRow, at: Date): bigint {
  const amount = minorFromString(inv.amount_minor);
  let best = 0;
  const t = inv.terms_json;
  if (t) {
    const earlyDeadline = new Date(inv.issued_at).getTime() + Math.ceil(t.net_days / 2) * DAY_S * 1000;
    if (t.early_pay_discount_bps > 0 && at.getTime() <= earlyDeadline) best = t.early_pay_discount_bps;
    if (t.early_pay_offer && at.getTime() <= new Date(t.early_pay_offer.expires_at).getTime()) {
      best = Math.max(best, t.early_pay_offer.discount_bps);
    }
  }
  return amount - applyBps(amount, best);
}
