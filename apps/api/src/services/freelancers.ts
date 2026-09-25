import { createHash } from "node:crypto";
import { validatePolicy, type Policy } from "@horos/core";
import type { Ctx } from "../context.js";
import { newId, newToken } from "../context.js";
import type { FreelancerRow } from "../db/rows.js";
import { HttpError } from "../errors.js";
import { DEFAULT_POLICY } from "./stats.js";

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

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
      "INSERT INTO freelancers (id, name, email, main_wallet_id, main_wallet_address, is_self_test) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, name, email, wallet.walletId, wallet.address, input.isSelfTest ?? false],
    );
    await savePolicy(q, id, DEFAULT_POLICY);
    await q.query("INSERT INTO sessions (token_hash, freelancer_id) VALUES ($1,$2)", [hashToken(token), id]);
  });
  return { freelancerId: id, token };
}

/** New login token for an existing account. Hackathon-grade: no email verification yet. */
export async function issueToken(ctx: Ctx, freelancerId: string) {
  const token = newToken();
  await ctx.db.query("INSERT INTO sessions (token_hash, freelancer_id) VALUES ($1,$2)", [hashToken(token), freelancerId]);
  return token;
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
