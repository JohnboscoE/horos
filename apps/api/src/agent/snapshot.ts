import type { ClientStats, DecisionType, Policy } from "@horos/core";
import { formatAmount } from "@horos/core";

/**
 * The only thing the model sees. `evidence` is a flat map of citable facts; every evidence_ref in
 * the model's output must be a key of this map. Client-authored text goes in `untrusted` and is
 * never mixed into evidence.
 */
export interface Snapshot {
  decisionType: DecisionType;
  subject: { type: "invoice" | "freelancer"; id: string };
  evidence: Record<string, string | number | boolean | null>;
  untrusted: { ref: string; text: string }[];
}

export function statsEvidence(prefix: "network" | "private", s: ClientStats | null): Snapshot["evidence"] {
  if (!s) return { [`stat:${prefix}_invoice_count`]: 0 };
  const e: Snapshot["evidence"] = {
    [`stat:${prefix}_invoice_count`]: s.invoiceCount,
    [`stat:${prefix}_on_time_rate`]: s.onTimeRate,
    [`stat:${prefix}_avg_days_late`]: s.avgDaysLate,
    [`stat:${prefix}_open_overdue`]: s.openOverdueCount,
  };
  if (prefix === "network") {
    e["stat:network_distinct_freelancers"] = s.distinctFreelancers;
    e["stat:network_confidence"] = s.confidence;
    // Display rule: below the threshold the agent must treat the client as new.
    e["stat:network_score_available"] = s.displayable;
  }
  return e;
}

export function policyEvidence(p: Policy): Snapshot["evidence"] {
  return {
    "policy:min_terms_days": p.minTermsDays,
    "policy:max_terms_days": p.maxTermsDays,
    "policy:max_discount_bps": p.maxDiscountBps,
    "policy:max_deposit_bps": p.maxDepositBps,
    "policy:late_fee_bps_cap": p.lateFeeBpsCap,
    "policy:approval_threshold": formatAmount(p.approvalThresholdMinor),
  };
}

export function evidenceKeys(s: Snapshot): string[] {
  return [...Object.keys(s.evidence), ...s.untrusted.map((u) => u.ref)];
}
