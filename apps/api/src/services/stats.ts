import { computeClientStats, type ClientStats, type Policy, type RecordFact } from "@horos/core";
import { minorFromString } from "@horos/core";
import type { Queryable } from "../db/db.js";
import type { PolicyRow } from "../db/rows.js";

const secs = (d: Date | string | null) => (d === null ? null : Math.floor(new Date(d).getTime() / 1000));

/** Probation-style terms: a deposit, or net 7 or shorter. Paying on time under these rebuilds trust. */
export const STRICT_NET_DAYS = 7;
function isStrict(terms: { deposit_bps?: number; net_days?: number } | null | undefined): boolean {
  return !!terms && ((terms.deposit_bps ?? 0) > 0 || (terms.net_days ?? Infinity) <= STRICT_NET_DAYS);
}

/** Shared network record: verified, client-acknowledged entries across all freelancers. */
export async function networkStats(q: Queryable, clientId: string, now: Date): Promise<ClientStats> {
  const rows = await q.query<{ freelancer_id: string; due_date: Date; paid_at: Date | null; disputed: boolean; terms_json: { deposit_bps?: number; net_days?: number } | null }>(
    `SELECT r.freelancer_id, r.due_date, r.paid_at, r.disputed, i.terms_json
     FROM record_entries r LEFT JOIN invoices i ON i.id = r.invoice_id
     WHERE r.client_id = $1 AND r.verified = TRUE`,
    [clientId],
  );
  const facts: RecordFact[] = rows.map((r) => ({
    freelancerId: r.freelancer_id,
    dueDate: secs(r.due_date)!,
    paidAt: secs(r.paid_at),
    acknowledged: true,
    disputed: r.disputed,
    strictTerms: isStrict(r.terms_json),
  }));
  return computeClientStats(facts, secs(now)!);
}

/** This freelancer's own history with the client (includes unacknowledged invoices and imported history). */
export async function privateStats(q: Queryable, freelancerId: string, clientId: string, now: Date, excludeInvoiceId?: string): Promise<ClientStats> {
  const rows = await q.query<{ due_date: Date; paid_at: Date | null; status: string; terms_json: { deposit_bps?: number; net_days?: number } | null }>(
    `SELECT due_date, paid_at, status, terms_json FROM invoices
     WHERE freelancer_id = $1 AND client_id = $2 AND due_date IS NOT NULL AND status NOT IN ('CANCELLED', 'DRAFT') AND id <> $3`,
    [freelancerId, clientId, excludeInvoiceId ?? ""],
  );
  const imported = await q.query<{ due_date: Date; paid_at: Date | null; disputed: boolean }>(
    "SELECT due_date, paid_at, disputed FROM record_entries WHERE client_id = $1 AND freelancer_id = $2 AND verified = FALSE",
    [clientId, freelancerId],
  );
  const facts: RecordFact[] = [
    ...rows.map((r) => ({ freelancerId, dueDate: secs(r.due_date)!, paidAt: secs(r.paid_at), acknowledged: true, disputed: r.status === "DISPUTED", strictTerms: isStrict(r.terms_json) })),
    ...imported.map((r) => ({ freelancerId, dueDate: secs(r.due_date)!, paidAt: secs(r.paid_at), acknowledged: true, disputed: r.disputed })),
  ];
  return computeClientStats(facts, secs(now)!);
}

export const DEFAULT_POLICY: Policy = {
  minTermsDays: 7,
  maxTermsDays: 30,
  maxDiscountBps: 200,
  maxDepositBps: 3_000,
  lateFeeBpsCap: 150,
  approvalThresholdMinor: 1_000_000_000n,
};

export async function loadPolicy(q: Queryable, freelancerId: string): Promise<Policy> {
  const r = (await q.query<PolicyRow>("SELECT * FROM policies WHERE freelancer_id = $1", [freelancerId]))[0];
  if (!r) return DEFAULT_POLICY;
  return {
    minTermsDays: r.min_terms_days,
    maxTermsDays: r.max_terms_days,
    maxDiscountBps: r.max_discount_bps,
    maxDepositBps: r.max_deposit_bps,
    lateFeeBpsCap: r.late_fee_bps_cap,
    approvalThresholdMinor: minorFromString(r.approval_threshold_minor),
  };
}
