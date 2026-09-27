import { createHash } from "node:crypto";
import { validatePolicy, type Policy } from "@horos/core";
import type { Ctx } from "../context.js";
import { newId, newToken } from "../context.js";
import type { FreelancerRow } from "../db/rows.js";
import { HttpError } from "../errors.js";
import { DEFAULT_POLICY } from "./stats.js";

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Dev/fallback signup (no Privy configured): name + email, returns an access token. */
export async function signup(ctx: Ctx, input: { name: string; email: string; isSelfTest?: boolean }) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Name and a valid email are required");
  const exists = await ctx.db.query("SELECT 1 FROM freelancers WHERE email = $1", [email]);
  if (exists[0]) throw new HttpError(409, "An account with this email already exists");

  const id = newId("fl");
  const wallet = await ctx.circle.createWallet(`main:${id}`, `horos-main-${id}`);
  const token = newToken();
  await ctx.db.tx(async (q) => {
    await q.query(
      "INSERT INTO freelancers (id, name, email, main_wallet_id, main_wallet_address, is_self_test, onboarded_at) VALUES ($1,$2,$3,$4,$5,$6, now())",
      [id, name, email, wallet.walletId, wallet.address, input.isSelfTest ?? false],
    );
    await savePolicy(q, id, DEFAULT_POLICY);
    await q.query("INSERT INTO sessions (token_hash, freelancer_id) VALUES ($1,$2)", [hashToken(token), id]);
  });
  return { freelancerId: id, token };
}

async function issueToken(ctx: Ctx, freelancerId: string) {
  const token = newToken();
  await ctx.db.query("INSERT INTO sessions (token_hash, freelancer_id) VALUES ($1,$2)", [hashToken(token), freelancerId]);
  return token;
}

/** Hints from the browser's Privy session. Untrusted: used only to suggest a display name and contact. */
export interface PrivyHints {
  name?: string;
  email?: string;
  wallet?: string;
}

export const MAX_NAME = 80;

/** Suggested display name: provider name → "Ada Lovelace" from ada.lovelace@… → short wallet → "Freelancer". */
export function defaultName(h: PrivyHints): string {
  const name = h.name?.trim();
  if (name) return name.slice(0, MAX_NAME);
  const local = h.email?.split("@")[0]?.replace(/\+.*$/, "");
  if (local) {
    const words = local.split(/[._-]+/).filter((w) => /[a-z]/i.test(w));
    if (words.length) return words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ").slice(0, MAX_NAME);
  }
  if (h.wallet && /^0x[0-9a-fA-F]{40}$/.test(h.wallet)) return `Freelancer ${h.wallet.slice(0, 6)}…${h.wallet.slice(-4)}`;
  return "Freelancer";
}

/**
 * Privy login. The Privy user id (already verified from the access token) is the identity. First
 * login creates the account (Circle wallet, default policy) with a suggested name and
 * needsOnboarding=true; the onboarding step then confirms or changes the name.
 */
export async function loginWithPrivy(ctx: Ctx, privyUserId: string, hints: PrivyHints) {
  const find = () => ctx.db.query<FreelancerRow & { onboarded_at: Date | null }>("SELECT * FROM freelancers WHERE privy_user_id = $1", [privyUserId]);
  let fr = (await find())[0];
  let created = false;

  if (!fr) {
    const id = newId("fl");
    // Keyed by the Privy id, so a retried or concurrent first login reuses the same Circle wallet.
    const wallet = await ctx.circle.createWallet(`main:${privyUserId}`, `horos-main-${id}`);
    const email = hints.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(hints.email) ? hints.email.trim().toLowerCase() : null;
    await ctx.db.tx(async (q) => {
      const rows = await q.query<{ id: string }>(
        `INSERT INTO freelancers (id, name, email, main_wallet_id, main_wallet_address, privy_user_id)
         VALUES ($1,$2,
           CASE WHEN $3::text IS NOT NULL AND NOT EXISTS (SELECT 1 FROM freelancers WHERE email = $3::text) THEN $3::text END,
           $4,$5,$6)
         ON CONFLICT (privy_user_id) DO NOTHING RETURNING id`,
        [id, defaultName(hints), email, wallet.walletId, wallet.address, privyUserId],
      );
      if (rows[0]) {
        await savePolicy(q, id, DEFAULT_POLICY);
        created = true;
      }
    });
    fr = (await find())[0]!;
  }

  const token = await issueToken(ctx, fr.id);
  return { token, freelancerId: fr.id, created, needsOnboarding: !fr.onboarded_at, suggestedName: fr.name };
}

export async function updateProfile(ctx: Ctx, freelancerId: string, name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > MAX_NAME) throw new HttpError(400, `Name must be 1–${MAX_NAME} characters`);
  const rows = await ctx.db.query<FreelancerRow>(
    "UPDATE freelancers SET name = $2, onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1 RETURNING *",
    [freelancerId, clean],
  );
  return rows[0]!;
}

export async function authenticate(ctx: Ctx, token: string | undefined): Promise<FreelancerRow> {
  if (!token) throw new HttpError(401, "Missing token");
  const rows = await ctx.db.query<FreelancerRow>(
    "SELECT f.* FROM sessions s JOIN freelancers f ON f.id = s.freelancer_id WHERE s.token_hash = $1",
    [hashToken(token)],
  );
  if (!rows[0]) throw new HttpError(401, "Invalid token");
  return rows[0];
}

async function savePolicy(q: { query: Ctx["db"]["query"] }, freelancerId: string, p: Policy) {
  await q.query(
    `INSERT INTO policies (freelancer_id, min_terms_days, max_terms_days, max_discount_bps, max_deposit_bps, late_fee_bps_cap, approval_threshold_minor)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (freelancer_id) DO UPDATE SET min_terms_days = $2, max_terms_days = $3, max_discount_bps = $4,
       max_deposit_bps = $5, late_fee_bps_cap = $6, approval_threshold_minor = $7, updated_at = now()`,
    [freelancerId, p.minTermsDays, p.maxTermsDays, p.maxDiscountBps, p.maxDepositBps, p.lateFeeBpsCap, p.approvalThresholdMinor.toString()],
  );
}

export async function updatePolicy(ctx: Ctx, freelancerId: string, p: Policy) {
  const errs = validatePolicy(p);
  if (errs.length) throw new HttpError(400, errs.join("; "));
  await savePolicy(ctx.db, freelancerId, p);
}
