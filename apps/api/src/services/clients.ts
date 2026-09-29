import { createHash, randomBytes } from "node:crypto";
import { formatAmount, minorFromString } from "@horos/core";
import { getAddress, isAddress, recoverMessageAddress, type Hex } from "viem";
import type { Ctx } from "../context.js";
import { newId, newToken } from "../context.js";
import type { Queryable } from "../db/db.js";
import type { InvoiceRow } from "../db/rows.js";
import { HttpError } from "../errors.js";
import { amountDue } from "./invoices.js";
import { networkStats } from "./stats.js";

/**
 * Client accounts.
 *
 * A client user is a person who proves control of identities:
 *   - a wallet, by signing a one-time sign-in message (always available), or via Privy
 *   - an email, only via Privy's server API (verified by Privy; never trusted from the browser)
 *
 * Visibility is per invoice, never org-wide: a client sees an invoice iff it was acknowledged by one of
 * their verified wallets, or it was sent to one of their verified emails.
 */

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const NONCE_TTL_MS = 10 * 60_000;

export function signInMessage(address: string, nonce: string, origin: string): string {
  return [
    "Sign in to Horos as a client.",
    "",
    "This proves you control this wallet. It does not send a transaction or cost gas.",
    "",
    `Wallet: ${getAddress(address)}`,
    `Site: ${origin}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export async function createNonce(ctx: Ctx, address: string) {
  if (!isAddress(address)) throw new HttpError(400, "Not a valid wallet address");
  const nonce = randomBytes(16).toString("hex");
  await ctx.db.query("INSERT INTO client_nonces (nonce, address, expires_at) VALUES ($1,$2,$3)", [
    nonce,
    address.toLowerCase(),
    new Date(ctx.now().getTime() + NONCE_TTL_MS),
  ]);
  return { nonce, message: signInMessage(address, nonce, ctx.cfg.publicWebUrl) };
}

/** Verifies the signed challenge (single use, unexpired, right wallet) and signs the client in. */
export async function signInWithWallet(ctx: Ctx, address: string, nonce: string, signature: Hex) {
  if (!isAddress(address)) throw new HttpError(400, "Not a valid wallet address");
  const addr = address.toLowerCase();
  const used = await ctx.db.query<{ nonce: string }>(
    "UPDATE client_nonces SET used_at = now() WHERE nonce = $1 AND address = $2 AND used_at IS NULL AND expires_at > $3 RETURNING nonce",
    [nonce, addr, ctx.now()],
  );
  if (!used[0]) throw new HttpError(401, "Sign-in request expired or already used. Try again.");
  const signer = await recoverMessageAddress({ message: signInMessage(address, nonce, ctx.cfg.publicWebUrl), signature }).catch(() => null);
  if (!signer || signer.toLowerCase() !== addr) throw new HttpError(401, "Signature doesn't match this wallet");
  return upsertClientUser(ctx, { privyUserId: null, identities: [{ kind: "wallet", value: addr, via: "signature" }] });
}

/** Privy sign-in: identities come from Privy's server API (verified), not from the browser. */
export async function signInWithPrivy(ctx: Ctx, privyUserId: string) {
  if (!ctx.privyUsers) throw new HttpError(501, "Client email sign-in isn't enabled yet (PRIVY_APP_SECRET missing)");
  const acc = await ctx.privyUsers.linkedAccounts(privyUserId);
  const identities = [
    ...acc.emails.map((value) => ({ kind: "email" as const, value, via: "privy" as const })),
    ...acc.wallets.map((value) => ({ kind: "wallet" as const, value, via: "privy" as const })),
  ];
  if (identities.length === 0) throw new HttpError(400, "Your Privy account has no verified email or wallet");
  return upsertClientUser(ctx, { privyUserId, identities });
}

type Identity = { kind: "wallet" | "email"; value: string; via: "signature" | "privy" };

/**
 * Finds the client user owning any of these identities (or the Privy id), creates one if none, and
 * attaches identities that aren't owned yet. Identities already owned by a *different* user are left
 * alone (no silent account merging).
 */
async function upsertClientUser(ctx: Ctx, input: { privyUserId: string | null; identities: Identity[] }) {
  const userId = await ctx.db.tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock($1)", [470_302]);
    let id: string | undefined;
    if (input.privyUserId) {
      id = (await q.query<{ id: string }>("SELECT id FROM client_users WHERE privy_user_id = $1", [input.privyUserId]))[0]?.id;
    }
    if (!id) {
      for (const i of input.identities) {
        id = (await q.query<{ client_user_id: string }>("SELECT client_user_id FROM client_identities WHERE kind = $1 AND value = $2", [i.kind, i.value]))[0]?.client_user_id;
        if (id) break;
      }
    }
    if (!id) {
      id = newId("cu");
      await q.query("INSERT INTO client_users (id, privy_user_id) VALUES ($1,$2)", [id, input.privyUserId]);
    } else if (input.privyUserId) {
      await q.query("UPDATE client_users SET privy_user_id = COALESCE(privy_user_id, $2) WHERE id = $1", [id, input.privyUserId]);
    }
    for (const i of input.identities) {
      await q.query(
        "INSERT INTO client_identities (client_user_id, kind, value, verified_via) VALUES ($1,$2,$3,$4) ON CONFLICT (kind, value) DO NOTHING",
        [id, i.kind, i.value, i.via],
      );
    }
    return id;
  });
  const token = newToken();
  await ctx.db.query("INSERT INTO client_sessions (token_hash, client_user_id) VALUES ($1,$2)", [hashToken(token), userId]);
  return { token, clientUserId: userId };
}

export async function authenticateClient(ctx: Ctx, token: string | undefined): Promise<string> {
  if (!token) throw new HttpError(401, "Missing client session");
  const rows = await ctx.db.query<{ client_user_id: string }>("SELECT client_user_id FROM client_sessions WHERE token_hash = $1", [hashToken(token)]);
  if (!rows[0]) throw new HttpError(401, "Invalid client session");
  return rows[0].client_user_id;
}

async function identitiesOf(q: Queryable, clientUserId: string) {
  return q.query<{ kind: "wallet" | "email"; value: string; verified_via: string }>(
    "SELECT kind, value, verified_via FROM client_identities WHERE client_user_id = $1 ORDER BY kind, value",
    [clientUserId],
  );
}

type Row = InvoiceRow & { freelancer_name: string; client_display_name: string; org_slug: string };

/** The only query that decides what a client can see. Per invoice, never org-wide. */
async function visibleInvoices(q: Queryable, clientUserId: string): Promise<Row[]> {
  return q.query<Row>(
    `SELECT i.*, f.name AS freelancer_name, c.display_name AS client_display_name, c.org_slug
     FROM invoices i
     JOIN freelancers f ON f.id = i.freelancer_id
     JOIN clients c ON c.id = i.client_id
     WHERE i.status <> 'DRAFT' AND (
       lower(i.ack_signer) IN (SELECT value FROM client_identities WHERE client_user_id = $1 AND kind = 'wallet')
       OR lower(i.client_email) IN (SELECT value FROM client_identities WHERE client_user_id = $1 AND kind = 'email')
     )
     ORDER BY i.created_at DESC`,
    [clientUserId],
  );
}

export type ClientBucket = "TO_SIGN" | "DUE" | "OVERDUE" | "PAID" | "REFUND" | "OTHER";

function bucketOf(inv: InvoiceRow): ClientBucket {
  switch (inv.status) {
    case "SENT":
      return "TO_SIGN";
    case "ACKNOWLEDGED":
    case "PARTIALLY_PAID":
      return "DUE";
    case "OVERDUE":
      return "OVERDUE";
    case "PAID":
    case "REFUNDED":
      return "PAID";
    case "OVERPAID":
    case "REFUND_PENDING":
      return "REFUND";
    default:
      return "OTHER";
  }
}

export async function clientDashboard(ctx: Ctx, clientUserId: string) {
  const now = ctx.now();
  const identities = await identitiesOf(ctx.db, clientUserId);
  const rows = await visibleInvoices(ctx.db, clientUserId);

  const invoices = await Promise.all(
    rows.map(async (inv) => {
      const due = amountDue(inv, now);
      const paid = minorFromString(inv.paid_minor);
      const refunds = await ctx.db.query<{ status: string }>("SELECT status FROM refund_intents WHERE invoice_id = $1", [inv.id]);
      const [msg] = await ctx.db.query<{ n: string }>("SELECT count(*)::text AS n FROM client_messages WHERE invoice_id = $1 AND audience = 'CLIENT'", [inv.id]);
      return {
        id: inv.id,
        bucket: bucketOf(inv),
        status: inv.status,
        freelancer: inv.freelancer_name,
        client: { name: inv.client_display_name, slug: inv.org_slug },
        description: inv.description,
        currency: inv.currency,
        amount: formatAmount(minorFromString(inv.amount_minor)),
        amountDueNow: formatAmount(due),
        paid: formatAmount(paid),
        outstandingMinor: (due > paid && !["PAID", "REFUNDED", "OVERPAID", "REFUND_PENDING", "CANCELLED"].includes(inv.status) ? due - paid : 0n).toString(),
        dueDate: inv.due_date,
        paidAt: inv.paid_at,
        acknowledged: inv.ack_at !== null,
        earlyPayOffer: inv.terms_json?.early_pay_offer ?? null,
        refundsAwaitingYou: refunds.filter((r) => r.status === "AWAITING_PAYER").length,
        messages: Number(msg?.n ?? 0),
        payToken: inv.pay_token,
      };
    }),
  );

  // The credential: reliability for each organization this client has invoices with (public data).
  const orgs = new Map<string, { name: string; slug: string; clientId: string }>();
  for (const r of rows) orgs.set(r.client_id, { name: r.client_display_name, slug: r.org_slug, clientId: r.client_id });
  const organizations = await Promise.all(
    [...orgs.values()].map(async (o) => {
      const s = await networkStats(ctx.db, o.clientId, now);
      return { name: o.name, slug: o.slug, score: s.displayable ? s : null, counts: { invoices: s.invoiceCount, freelancers: s.distinctFreelancers } };
    }),
  );

  const outstanding = invoices.filter((i) => i.currency === "USDC").reduce((s, i) => s + BigInt(i.outstandingMinor), 0n);
  return {
    identities: identities.map((i) => ({ kind: i.kind, value: i.value, verifiedVia: i.verified_via })),
    totals: {
      outstandingUsdc: formatAmount(outstanding),
      toSign: invoices.filter((i) => i.bucket === "TO_SIGN").length,
      overdue: invoices.filter((i) => i.bucket === "OVERDUE").length,
      refundsAwaitingYou: invoices.reduce((s, i) => s + i.refundsAwaitingYou, 0),
    },
    invoices,
    organizations,
  };
}
