import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { formatAmount, minorFromString, parseAmount, explorerTxUrl, INVOICE_TYPES, invoiceDomain } from "@horos/core";
import type { Hex } from "viem";
import type { Ctx } from "./context.js";
import type { MockChain } from "./chain/reader.js";
import type { DecisionRow, FreelancerRow, InvoiceRow, RefundRow } from "./db/rows.js";
import { HttpError } from "./errors.js";
import { newId } from "./context.js";
import { authenticate, signup, updatePolicy } from "./services/freelancers.js";
import { acknowledgeByEmail, acknowledgeInvoice, ackTypedData, amountDue, createInvoice, getInvoice, setManualTerms } from "./services/invoices.js";
import { approveDecision, rejectDecision } from "./services/agent.js";
import { confirmRefundAddress } from "./services/refunds.js";
import { readLog, verifyLog, logHead } from "./services/decisionLog.js";
import { freelancerForecast } from "./services/forecast.js";
import { networkStats } from "./services/stats.js";
import { disputeMessage, resolveDispute, resolveMessage, submitResponse } from "./services/responses.js";
import { metrics } from "./services/metrics.js";
import { runCollections, runEarlyPayOffers, maybeAnchor } from "./services/scheduler.js";
import { watchOnce } from "./services/watcher.js";
import { processChainJobs } from "./services/chainJobs.js";
import { processRefunds } from "./services/refunds.js";
import { createOnrampSession, onrampMode } from "./services/onramp.js";

type Authed = Request & { freelancer: FreelancerRow };

const DISCLAIMER =
  "Horos is a beta. It is not a credit bureau: it records objective payment facts (due date, paid date, amount band) for client-acknowledged invoices only. Contracts are unaudited.";

export function createApp(ctx: Ctx & { mockChain?: MockChain | null }) {
  const app = express();
  app.set("json replacer", (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  app.use(cors({ origin: ctx.cfg.webOrigin.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "64kb" }));

  const auth = async (req: Request, _res: Response, next: NextFunction) => {
    const h = req.header("authorization");
    (req as Authed).freelancer = await authenticate(ctx, h?.startsWith("Bearer ") ? h.slice(7) : undefined);
    next();
  };
  const me = (req: Request) => (req as Authed).freelancer;
  const body = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> => {
    const r = schema.safeParse(req.body);
    if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    return r.data;
  };
  const amount = z.string().transform((s, c) => {
    try {
      return parseAmount(s);
    } catch (e) {
      c.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });

  // ---------------------------------------------------------------- public
  app.get("/api/health", async (_req, res) => {
    res.json({
      ok: true,
      network: ctx.cfg.network.network,
      chainId: ctx.cfg.network.chain.id,
      circle: ctx.circle.kind,
      attester: ctx.attester.enabled ? "onchain" : "mock",
      agent: ctx.model?.name ?? "mock",
      onramp: onrampMode(ctx),
      killSwitch: ctx.cfg.killSwitch,
      unverifiedConfig: ctx.cfg.network.unverified,
      disclaimer: DISCLAIMER,
    });
  });

  app.post("/api/signup", async (req, res) => {
    const b = body(z.object({ name: z.string().min(1).max(80), email: z.string().email(), isSelfTest: z.boolean().optional() }), req);
    res.status(201).json(await signup(ctx, b));
  });

  app.get("/api/metrics", async (_req, res) => res.json(await metrics(ctx)));

  app.get("/api/clients/:slug/score", async (req, res) => {
    const c = (await ctx.db.query<{ id: string; display_name: string; org_slug: string }>("SELECT id, display_name, org_slug FROM clients WHERE org_slug = $1", [req.params.slug]))[0];
    if (!c) throw new HttpError(404, "Unknown client");
    const s = await networkStats(ctx.db, c.id, ctx.now());
    const entries = await ctx.db.query(
      `SELECT due_date, paid_at, amount_band, disputed, response_text, ack_tx, settle_tx, verified FROM record_entries
       WHERE client_id = $1 ORDER BY due_date DESC LIMIT 50`,
      [c.id],
    );
    res.json({
      client: { name: c.display_name, slug: c.org_slug },
      // Display rule: ≥3 non-disputed acknowledged invoices from ≥2 freelancers, else "insufficient data".
      score: s.displayable ? s : null,
      insufficientData: !s.displayable,
      counts: { invoices: s.invoiceCount, freelancers: s.distinctFreelancers },
      entries,
      disclaimer: DISCLAIMER,
    });
  });

  // Client pay page
  const byToken = async (token: string) => {
    const inv = (await ctx.db.query<InvoiceRow>("SELECT * FROM invoices WHERE pay_token = $1", [token]))[0];
    if (!inv || inv.status === "DRAFT") throw new HttpError(404, "Invoice not found");
    return inv;
  };

  app.get("/api/pay/:token", async (req, res) => {
    const inv = await byToken(req.params.token);
    const [fr] = await ctx.db.query<{ name: string }>("SELECT name FROM freelancers WHERE id = $1", [inv.freelancer_id]);
    const [cl] = await ctx.db.query<{ display_name: string; org_slug: string }>("SELECT display_name, org_slug FROM clients WHERE id = $1", [inv.client_id]);
    const messages = await ctx.db.query("SELECT kind, body, params, created_at FROM client_messages WHERE invoice_id = $1 AND audience = 'CLIENT' ORDER BY created_at", [inv.id]);
    const refunds = await ctx.db.query<RefundRow>("SELECT * FROM refund_intents WHERE invoice_id = $1 ORDER BY created_at", [inv.id]);
    const [entry] = await ctx.db.query("SELECT disputed, response_text FROM record_entries WHERE invoice_id = $1", [inv.id]);
    const { chainId, message } = ackTypedData(ctx, inv);
    const now = ctx.now();
    const dueNow = amountDue(inv, now);
    const paid = minorFromString(inv.paid_minor);
    res.json({
      invoice: {
        id: inv.id,
        status: inv.status,
        freelancer: fr?.name,
        client: cl,
        description: inv.description,
        currency: inv.currency,
        amount: formatAmount(minorFromString(inv.amount_minor)),
        amountDueNow: formatAmount(dueNow),
        paid: formatAmount(paid),
        outstanding: formatAmount(dueNow > paid ? dueNow - paid : 0n),
        dueDate: inv.due_date,
        terms: inv.terms_json && {
          netDays: inv.terms_json.net_days,
          depositBps: inv.terms_json.deposit_bps,
          earlyPayDiscountBps: inv.terms_json.early_pay_discount_bps,
          earlyPayOffer: inv.terms_json.early_pay_offer ?? null,
        },
        depositAddress: inv.deposit_address,
        tokenAddress: inv.currency === "USDC" ? ctx.cfg.network.usdc : ctx.cfg.network.eurc,
        acknowledged: inv.ack_at !== null,
        ackMethod: inv.ack_method,
        ackSigner: inv.ack_signer,
        invoiceHash: inv.invoice_hash,
        disputed: (entry as { disputed?: boolean } | undefined)?.disputed ?? false,
        response: (entry as { response_text?: string } | undefined)?.response_text ?? null,
      },
      typedData: { domain: invoiceDomain(chainId), types: INVOICE_TYPES, primaryType: "Invoice", message },
      disputeMessageTemplate: inv.invoice_hash ? disputeMessage(inv.invoice_hash, "<your response>") : null,
      resolveMessage: inv.invoice_hash ? resolveMessage(inv.invoice_hash) : null,
      messages,
      refunds: refunds.map((r) => ({
        id: r.id,
        amount: formatAmount(minorFromString(r.amount_minor)),
        status: r.status,
        suggestedAddress: r.suggested_address,
        toAddress: r.to_address,
        confirmToken: r.status === "AWAITING_PAYER" ? r.confirm_token : undefined,
        txUrl: r.tx_hash ? explorerTxUrl(ctx.cfg.network, r.tx_hash) : null,
      })),
      chain: { chainId, explorer: ctx.cfg.network.explorerUrl, network: ctx.cfg.network.network },
      onramp: { mode: inv.currency === "USDC" ? onrampMode(ctx) : "off" },
      disclaimer: DISCLAIMER,
    });
  });

  // Pay by card (Arc App Kit Onramp). The body the widget sends is ignored: destination is fixed server-side.
  app.post("/api/pay/:token/onramp-session", async (req, res) => {
    res.json(await createOnrampSession(ctx, req.params.token));
  });

  app.post("/api/pay/:token/ack", async (req, res) => {
    const b = body(z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/), signer: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }), req);
    const inv = await acknowledgeInvoice(ctx, req.params.token, b.signature as Hex, b.signer as Hex);
    res.json({ status: inv.status, acknowledged: true });
  });

  app.post("/api/pay/:token/ack-email", async (req, res) => {
    const b = body(z.object({ name: z.string().min(1).max(80) }), req);
    const inv = await acknowledgeByEmail(ctx, req.params.token, b.name);
    res.json({ status: inv.status, acknowledged: true, countsTowardRecord: false });
  });

  app.post("/api/pay/:token/response", async (req, res) => {
    const b = body(z.object({ text: z.string().min(1).max(2000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional() }), req);
    res.json(await submitResponse(ctx, req.params.token, b.text, b.signature as Hex | undefined));
  });

  app.post("/api/pay/:token/resolve", async (req, res) => {
    const b = body(z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), req);
    res.json(await resolveDispute(ctx, req.params.token, b.signature as Hex));
  });

  app.post("/api/refunds/:confirmToken/confirm", async (req, res) => {
    const b = body(z.object({ address: z.string() }), req);
    const r = await confirmRefundAddress(ctx, req.params.confirmToken, b.address);
    res.json({ id: r.id, status: r.status, toAddress: r.to_address });
  });

  // Decision log (public, replayable)
  app.get("/api/log", async (req, res) => {
    const fromSeq = Number(req.query.from ?? 0);
    res.json({ entries: await readLog(ctx, { fromSeq, limit: 200 }), head: await logHead(ctx), signer: ctx.logSigner.address });
  });
  app.get("/api/log/verify", async (_req, res) => res.json(await verifyLog(ctx)));
  app.get("/api/decisions/:id/replay", async (req, res) => {
    const d = (await ctx.db.query<DecisionRow>("SELECT * FROM agent_decisions WHERE id = $1", [req.params.id]))[0];
    if (!d) throw new HttpError(404, "Decision not found");
    res.json({ decision: d, log: await readLog(ctx, { decisionId: d.id }) });
  });

  // ---------------------------------------------------------------- freelancer
  app.get("/api/me", auth, async (req, res) => {
    const f = me(req);
    const [policy] = await ctx.db.query("SELECT * FROM policies WHERE freelancer_id = $1", [f.id]);
    const [cash] = await ctx.db.query<{ cash_on_hand_minor: string }>("SELECT cash_on_hand_minor FROM freelancers WHERE id = $1", [f.id]);
    res.json({ freelancer: f, policy, cashOnHand: formatAmount(minorFromString(cash!.cash_on_hand_minor)) });
  });

  app.put("/api/me/policy", auth, async (req, res) => {
    const b = body(
      z.object({
        minTermsDays: z.number().int(),
        maxTermsDays: z.number().int(),
        maxDiscountBps: z.number().int(),
        maxDepositBps: z.number().int(),
        lateFeeBpsCap: z.number().int(),
        approvalThreshold: amount,
      }),
      req,
    );
    await updatePolicy(ctx, me(req).id, { ...b, approvalThresholdMinor: b.approvalThreshold });
    res.json({ ok: true });
  });

  app.put("/api/me/cash", auth, async (req, res) => {
    const b = body(z.object({ cashOnHand: amount }), req);
    await ctx.db.query("UPDATE freelancers SET cash_on_hand_minor = $2 WHERE id = $1", [me(req).id, b.cashOnHand.toString()]);
    res.json({ ok: true });
  });

  app.get("/api/me/cash-needs", auth, async (req, res) => {
    res.json(await ctx.db.query("SELECT * FROM cash_needs WHERE freelancer_id = $1 ORDER BY due_date", [me(req).id]));
  });
  app.post("/api/me/cash-needs", auth, async (req, res) => {
    const b = body(z.object({ label: z.string().min(1).max(80), amount, dueDate: z.string().datetime({ offset: true }).or(z.string().date()) }), req);
    const id = newId("need");
    await ctx.db.query("INSERT INTO cash_needs (id, freelancer_id, due_date, amount_minor, label) VALUES ($1,$2,$3,$4,$5)", [
      id,
      me(req).id,
      new Date(b.dueDate),
      b.amount.toString(),
      b.label,
    ]);
    res.status(201).json({ id });
  });
  app.delete("/api/me/cash-needs/:id", auth, async (req, res) => {
    await ctx.db.query("DELETE FROM cash_needs WHERE id = $1 AND freelancer_id = $2", [req.params.id, me(req).id]);
    res.json({ ok: true });
  });

  app.get("/api/me/forecast", auth, async (req, res) => {
    res.json(await freelancerForecast(ctx.db, me(req).id, ctx.now()));
  });

  app.post("/api/invoices", auth, async (req, res) => {
    const b = body(
      z.object({
        clientName: z.string().min(1).max(120),
        clientOrg: z.string().max(120).optional(),
        clientEmail: z.string().email().optional(),
        currency: z.enum(["USDC", "EURC"]).default("USDC"),
        amount,
        description: z.string().max(500).optional(),
        isSelfTest: z.boolean().optional(),
      }),
      req,
    );
    const out = await createInvoice(ctx, me(req).id, { ...b, amountMinor: b.amount, isSelfTest: b.isSelfTest || me(req).is_self_test });
    res.status(201).json(out);
  });

  app.get("/api/invoices", auth, async (req, res) => {
    const rows = await ctx.db.query(
      `SELECT i.*, c.display_name AS client_name, c.org_slug AS client_slug FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.freelancer_id = $1 ORDER BY i.created_at DESC`,
      [me(req).id],
    );
    res.json(rows);
  });

  app.get("/api/invoices/:id", auth, async (req, res) => {
    const inv = await getInvoice(ctx.db, req.params.id as string);
    if (inv.freelancer_id !== me(req).id) throw new HttpError(404, "Invoice not found");
    const [client] = await ctx.db.query("SELECT id, display_name, org_slug FROM clients WHERE id = $1", [inv.client_id]);
    const [payments, decisions, messages, refunds, record] = await Promise.all([
      ctx.db.query("SELECT * FROM payments WHERE invoice_id = $1 ORDER BY detected_at", [inv.id]),
      ctx.db.query("SELECT * FROM agent_decisions WHERE subject_id = $1 OR (decision_type = 'EARLY_PAY_OFFER' AND proposal_json::text LIKE $2) ORDER BY created_at", [inv.id, `%${inv.id}%`]),
      ctx.db.query("SELECT * FROM client_messages WHERE invoice_id = $1 ORDER BY created_at", [inv.id]),
      ctx.db.query("SELECT id, amount_minor, status, suggested_address, to_address, tx_hash, created_at FROM refund_intents WHERE invoice_id = $1", [inv.id]),
      ctx.db.query("SELECT * FROM record_entries WHERE invoice_id = $1", [inv.id]),
    ]);
    res.json({ invoice: inv, client, payments, decisions, messages, refunds, record: record[0] ?? null, payUrl: `${ctx.cfg.publicWebUrl}/pay/${inv.pay_token}` });
  });

  app.post("/api/invoices/:id/terms", auth, async (req, res) => {
    const b = body(z.object({ net_days: z.number().int().min(0).max(365), deposit_bps: z.number().int().min(0).max(10_000), early_pay_discount_bps: z.number().int().min(0).max(10_000) }), req);
    res.json(await setManualTerms(ctx, me(req).id, req.params.id as string, b));
  });

  app.post("/api/invoices/:id/cancel", auth, async (req, res) => {
    const rows = await ctx.db.query(
      "UPDATE invoices SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND freelancer_id = $2 AND status IN ('DRAFT','SENT','ACKNOWLEDGED','OVERDUE') AND paid_minor = 0 RETURNING id",
      [req.params.id, me(req).id],
    );
    if (!rows[0]) throw new HttpError(409, "Only unpaid invoices can be cancelled");
    res.json({ ok: true });
  });

  app.get("/api/decisions", auth, async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const rows = await ctx.db.query(
      `SELECT * FROM agent_decisions WHERE freelancer_id = $1 AND ($2::text IS NULL OR final_status = $2) ORDER BY created_at DESC LIMIT 200`,
      [me(req).id, status],
    );
    res.json(rows);
  });
  app.post("/api/decisions/:id/approve", auth, async (req, res) => res.json(await approveDecision(ctx, req.params.id as string, me(req).id)));
  app.post("/api/decisions/:id/reject", auth, async (req, res) => {
    const b = body(z.object({ reason: z.string().max(300).default("") }), req);
    res.json(await rejectDecision(ctx, req.params.id as string, me(req).id, b.reason));
  });

  /** Run the background loops now (demo convenience; the worker does this on a timer). */
  app.post("/api/agent/tick", auth, async (_req, res) => {
    res.json(await tick(ctx));
  });

  // ---------------------------------------------------------------- dev only (in-memory chain)
  if (ctx.mockChain) {
    const chain = ctx.mockChain;
    app.post("/api/dev/pay/:token", async (req, res) => {
      const b = body(z.object({ amount, native: z.boolean().optional(), from: z.string().optional() }), req);
      const inv = await byToken(req.params.token);
      const { txHash } = chain.pay(inv.deposit_address as Hex, b.amount, { native: b.native, from: b.from as Hex | undefined });
      const w = await watchOnce(ctx);
      res.json({ simulated: true, txHash, watcher: w });
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}

/** One pass of every background loop. Used by the worker and by /api/agent/tick. */
export async function tick(ctx: Ctx) {
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: (e as Error).message };
      console.error(`[tick] ${name}:`, e);
    }
  };
  await step("watcher", () => watchOnce(ctx));
  await step("collections", () => runCollections(ctx));
  await step("earlyPay", () => runEarlyPayOffers(ctx));
  await step("refunds", () => processRefunds(ctx));
  await step("anchor", () => maybeAnchor(ctx));
  await step("chainJobs", () => processChainJobs(ctx));
  return out;
}
