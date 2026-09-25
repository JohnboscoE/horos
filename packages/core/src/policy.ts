import type { AgentProposal } from "./agentSchema.js";

/**
 * Deterministic policy checker. The model proposes; this decides.
 *
 *   AUTO_APPLY      within the freelancer's bounds, safe to execute without a human
 *   NEEDS_APPROVAL  valid but outside bounds / above threshold / sensitive; goes to the approvals queue
 *   REJECTED        can never be executed, even with approval (e.g. refund exceeds what we hold)
 */

export interface Policy {
  minTermsDays: number;
  maxTermsDays: number;
  maxDiscountBps: number;
  maxDepositBps: number;
  lateFeeBpsCap: number;
  /** Invoices / refunds at or above this amount always need approval. Minor units. */
  approvalThresholdMinor: bigint;
}

export interface PolicyContext {
  /** Invoice amount for SET_TERMS / COLLECTION_STEP. */
  invoiceAmountMinor?: bigint;
  /** For RECONCILE: amount received above what's owed (the only money that may ever be refunded). */
  refundableExcessMinor?: bigint;
  /** For EARLY_PAY_OFFER: invoices the offer may target (open, acknowledged, owned by this freelancer). */
  eligibleInvoiceIds?: string[];
}

export type PolicyOutcome = "AUTO_APPLY" | "NEEDS_APPROVAL" | "REJECTED";

export interface PolicyResult {
  outcome: PolicyOutcome;
  reasons: string[];
}

export function validatePolicy(p: Policy): string[] {
  const errs: string[] = [];
  const bps = (n: number) => Number.isInteger(n) && n >= 0 && n <= 10_000;
  if (!Number.isInteger(p.minTermsDays) || p.minTermsDays < 0) errs.push("minTermsDays must be a non-negative integer");
  if (!Number.isInteger(p.maxTermsDays) || p.maxTermsDays > 365) errs.push("maxTermsDays must be an integer ≤ 365");
  if (p.minTermsDays > p.maxTermsDays) errs.push("minTermsDays must be ≤ maxTermsDays");
  if (!bps(p.maxDiscountBps)) errs.push("maxDiscountBps must be 0–10000");
  if (!bps(p.maxDepositBps)) errs.push("maxDepositBps must be 0–10000");
  if (!bps(p.lateFeeBpsCap)) errs.push("lateFeeBpsCap must be 0–10000");
  if (p.approvalThresholdMinor < 0n) errs.push("approvalThresholdMinor must be ≥ 0");
  return errs;
}

export function checkPolicy(proposal: AgentProposal, policy: Policy, ctx: PolicyContext = {}): PolicyResult {
  const hard: string[] = [];
  const soft: string[] = [];

  const aboveThreshold = (amount: bigint | undefined, what: string) => {
    if (amount !== undefined && amount >= policy.approvalThresholdMinor) {
      soft.push(`${what} ${amount} ≥ approval threshold ${policy.approvalThresholdMinor}`);
    }
  };

  switch (proposal.decision_type) {
    case "SET_TERMS": {
      const { net_days, deposit_bps, early_pay_discount_bps } = proposal.params;
      if (net_days < policy.minTermsDays) soft.push(`net_days ${net_days} < min ${policy.minTermsDays}`);
      if (net_days > policy.maxTermsDays) soft.push(`net_days ${net_days} > max ${policy.maxTermsDays}`);
      if (deposit_bps > policy.maxDepositBps) soft.push(`deposit_bps ${deposit_bps} > max ${policy.maxDepositBps}`);
      if (early_pay_discount_bps > policy.maxDiscountBps) {
        soft.push(`early_pay_discount_bps ${early_pay_discount_bps} > max ${policy.maxDiscountBps}`);
      }
      aboveThreshold(ctx.invoiceAmountMinor, "invoice amount");
      break;
    }

    case "EARLY_PAY_OFFER": {
      if (proposal.action === "NO_OFFER") {
        if (proposal.params.offers.length > 0) hard.push("NO_OFFER must not include offers");
        break;
      }
      if (proposal.params.offers.length === 0) hard.push("OFFER_DISCOUNTS with no offers");
      const eligible = new Set(ctx.eligibleInvoiceIds ?? []);
      const seen = new Set<string>();
      for (const o of proposal.params.offers) {
        if (!eligible.has(o.invoice_id)) hard.push(`invoice ${o.invoice_id} is not eligible for an offer`);
        if (seen.has(o.invoice_id)) hard.push(`duplicate offer for invoice ${o.invoice_id}`);
        seen.add(o.invoice_id);
        if (o.discount_bps > policy.maxDiscountBps) {
          soft.push(`offer on ${o.invoice_id}: discount ${o.discount_bps} > max ${policy.maxDiscountBps}`);
        }
      }
      break;
    }

    case "COLLECTION_STEP": {
      const { discount_bps, late_fee_bps } = proposal.params;
      switch (proposal.action) {
        case "REMINDER":
        case "ESCALATE": // escalation goes to the freelancer, never to the client
          if (discount_bps !== undefined || late_fee_bps !== undefined) {
            hard.push(`${proposal.action} must not carry a discount or fee`);
          }
          break;
        case "DISCOUNT_OFFER":
          if (discount_bps === undefined) hard.push("DISCOUNT_OFFER requires discount_bps");
          else if (discount_bps > policy.maxDiscountBps) soft.push(`discount ${discount_bps} > max ${policy.maxDiscountBps}`);
          if (late_fee_bps !== undefined) hard.push("DISCOUNT_OFFER must not carry a late fee");
          break;
        case "LATE_FEE_NOTICE":
          if (late_fee_bps === undefined) hard.push("LATE_FEE_NOTICE requires late_fee_bps");
          else if (late_fee_bps > policy.lateFeeBpsCap) soft.push(`late fee ${late_fee_bps} > cap ${policy.lateFeeBpsCap}`);
          if (discount_bps !== undefined) hard.push("LATE_FEE_NOTICE must not carry a discount");
          break;
        case "FLAG_PAUSE_WORK":
          soft.push("pausing work on a client always needs the freelancer's approval");
          break;
      }
      break;
    }

    case "RECONCILE": {
      if (proposal.action !== "PROPOSE_REFUND") {
        if (proposal.params.refund_amount_minor !== undefined) hard.push(`${proposal.action} must not carry a refund amount`);
        break;
      }
      const raw = proposal.params.refund_amount_minor;
      if (raw === undefined) {
        hard.push("PROPOSE_REFUND requires refund_amount_minor");
        break;
      }
      const amount = BigInt(raw);
      const excess = ctx.refundableExcessMinor ?? 0n;
      if (amount <= 0n) hard.push("refund amount must be positive");
      if (amount > excess) hard.push(`refund ${amount} exceeds refundable excess ${excess}`);
      aboveThreshold(amount, "refund");
      break;
    }
  }

  if (hard.length > 0) return { outcome: "REJECTED", reasons: [...hard, ...soft] };
  if (soft.length > 0) return { outcome: "NEEDS_APPROVAL", reasons: soft };
  return { outcome: "AUTO_APPLY", reasons: [] };
}
