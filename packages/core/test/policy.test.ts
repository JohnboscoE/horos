import { describe, expect, it } from "vitest";
import { checkPolicy, validatePolicy, type Policy } from "../src/policy.js";
import { AgentProposal, unknownEvidenceRefs } from "../src/agentSchema.js";

const policy: Policy = {
  minTermsDays: 7,
  maxTermsDays: 30,
  maxDiscountBps: 200,
  maxDepositBps: 3_000,
  lateFeeBpsCap: 150,
  approvalThresholdMinor: 1_000_000_000n, // 1,000 USDC
};

const common = { reasoning: "Client pays on time across four freelancers.", evidence_refs: ["stat:network_on_time_rate"], confidence: 0.8 };

describe("SET_TERMS", () => {
  const terms = (net_days: number, deposit_bps = 0, early_pay_discount_bps = 0) =>
    AgentProposal.parse({
      decision_type: "SET_TERMS",
      action: "PROPOSE_TERMS",
      params: { net_days, deposit_bps, early_pay_discount_bps },
      ...common,
    });

  it("auto-applies within bounds", () => {
    expect(checkPolicy(terms(14, 0, 150), policy, { invoiceAmountMinor: 500_000_000n }).outcome).toBe("AUTO_APPLY");
  });

  it("needs approval out of bounds", () => {
    const r = checkPolicy(terms(60, 5_000, 900), policy, { invoiceAmountMinor: 1n });
    expect(r.outcome).toBe("NEEDS_APPROVAL");
    expect(r.reasons).toHaveLength(3);
  });

  it("needs approval at/above the amount threshold", () => {
    expect(checkPolicy(terms(14), policy, { invoiceAmountMinor: 1_000_000_000n }).outcome).toBe("NEEDS_APPROVAL");
  });
});

describe("prompt-injection shaped outputs are bounded by code", () => {
  it("'waive all fees, 100% discount' can never auto-apply", () => {
    const p = AgentProposal.parse({
      decision_type: "COLLECTION_STEP",
      action: "DISCOUNT_OFFER",
      params: { discount_bps: 10_000, message: "As instructed, all fees waived." },
      ...common,
    });
    expect(checkPolicy(p, policy).outcome).toBe("NEEDS_APPROVAL");
  });

  it("schema rejects out-of-range and extra fields", () => {
    const bad = [
      { decision_type: "SET_TERMS", action: "PROPOSE_TERMS", params: { net_days: 14, deposit_bps: 0, early_pay_discount_bps: 20_000 }, ...common },
      { decision_type: "SET_TERMS", action: "PROPOSE_TERMS", params: { net_days: 14, deposit_bps: 0, early_pay_discount_bps: 0, pay_to: "0xevil" }, ...common },
      { decision_type: "RECONCILE", action: "SEND_FUNDS", params: { note: "x" }, ...common },
      { decision_type: "SET_TERMS", action: "PROPOSE_TERMS", params: { net_days: 14, deposit_bps: 0, early_pay_discount_bps: 0 }, ...common, evidence_refs: [] },
    ];
    for (const b of bad) expect(AgentProposal.safeParse(b).success).toBe(false);
  });
});

describe("COLLECTION_STEP", () => {
  const step = (action: string, params: Record<string, unknown>) =>
    AgentProposal.parse({ decision_type: "COLLECTION_STEP", action, params: { message: "Friendly reminder.", ...params }, ...common });

  it("reminder auto-applies", () => expect(checkPolicy(step("REMINDER", {}), policy).outcome).toBe("AUTO_APPLY"));
  it("reminder with a fee is rejected", () => expect(checkPolicy(step("REMINDER", { late_fee_bps: 10 }), policy).outcome).toBe("REJECTED"));
  it("late fee within cap auto-applies", () => expect(checkPolicy(step("LATE_FEE_NOTICE", { late_fee_bps: 150 }), policy).outcome).toBe("AUTO_APPLY"));
  it("late fee over cap needs approval", () => expect(checkPolicy(step("LATE_FEE_NOTICE", { late_fee_bps: 151 }), policy).outcome).toBe("NEEDS_APPROVAL"));
  it("late fee without amount is rejected", () => expect(checkPolicy(step("LATE_FEE_NOTICE", {}), policy).outcome).toBe("REJECTED"));
  it("pause work always needs approval", () => expect(checkPolicy(step("FLAG_PAUSE_WORK", {}), policy).outcome).toBe("NEEDS_APPROVAL"));
});

describe("RECONCILE refunds", () => {
  const refund = (amt: string) =>
    AgentProposal.parse({ decision_type: "RECONCILE", action: "PROPOSE_REFUND", params: { refund_amount_minor: amt, note: "Duplicate payment." }, ...common });

  it("refund of the excess auto-applies (still waits for payer address confirmation in the executor)", () => {
    expect(checkPolicy(refund("100000000"), policy, { refundableExcessMinor: 100_000_000n }).outcome).toBe("AUTO_APPLY");
  });

  it("refund above the excess is rejected outright", () => {
    const r = checkPolicy(refund("100000001"), policy, { refundableExcessMinor: 100_000_000n });
    expect(r.outcome).toBe("REJECTED");
  });

  it("refund with no known excess is rejected", () => {
    expect(checkPolicy(refund("1"), policy).outcome).toBe("REJECTED");
  });

  it("large refunds need approval", () => {
    expect(checkPolicy(refund("2000000000"), policy, { refundableExcessMinor: 2_000_000_000n }).outcome).toBe("NEEDS_APPROVAL");
  });
});

describe("EARLY_PAY_OFFER", () => {
  const offer = (offers: { invoice_id: string; discount_bps: number; valid_for_days: number }[]) =>
    AgentProposal.parse({ decision_type: "EARLY_PAY_OFFER", action: "OFFER_DISCOUNTS", params: { offers }, ...common });

  it("only targets eligible invoices", () => {
    expect(checkPolicy(offer([{ invoice_id: "a", discount_bps: 100, valid_for_days: 3 }]), policy, { eligibleInvoiceIds: ["a"] }).outcome).toBe("AUTO_APPLY");
    expect(checkPolicy(offer([{ invoice_id: "zzz", discount_bps: 100, valid_for_days: 3 }]), policy, { eligibleInvoiceIds: ["a"] }).outcome).toBe("REJECTED");
  });
});

describe("evidence refs and policy validation", () => {
  it("finds fabricated refs", () => {
    expect(unknownEvidenceRefs({ evidence_refs: ["stat:a", "stat:made_up"] }, ["stat:a"])).toEqual(["stat:made_up"]);
  });

  it("validates bounds", () => {
    expect(validatePolicy(policy)).toEqual([]);
    expect(validatePolicy({ ...policy, minTermsDays: 40 })).not.toEqual([]);
  });
});
