import type { AgentProposal, Policy } from "@horos/core";
import type { Snapshot } from "./snapshot.js";

/**
 * Deterministic proposals. Used when MOCK_AGENT=true, when the model is unavailable, and when the
 * model's output is invalid twice. Always stays inside policy bounds and cites only snapshot keys.
 */
export function fallbackProposal(s: Snapshot, policy: Policy): AgentProposal {
  switch (s.decisionType) {
    case "SET_TERMS":
      return setTerms(s, policy);
    case "COLLECTION_STEP":
      return collectionStep(s, policy);
    case "RECONCILE":
      return reconcile(s);
    case "EARLY_PAY_OFFER":
      return earlyPay(s, policy);
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : null);
const big = (v: unknown): bigint => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : 0n);

function refs(s: Snapshot, wanted: string[]): string[] {
  const have = wanted.filter((k) => k in s.evidence);
  return have.length ? have : [Object.keys(s.evidence)[0]!];
}

function setTerms(s: Snapshot, p: Policy): AgentProposal {
  const e = s.evidence;
  const available = e["stat:network_score_available"] === true;
  const src = available ? "network" : "private";
  // Reliability (decayed, graded) is the headline; fall back to the plain rate if absent.
  const onTime = num(e[`stat:${src}_reliability`]) ?? num(e[`stat:${src}_on_time_rate`]);
  const avgLate = num(e[`stat:${src}_avg_days_late`]);
  const trend = e[`stat:${src}_trend`];
  const recent = e[`stat:${src}_recent_on_time`];
  const shortfall = big(e["forecast:shortfall_total_minor"]);
  const amount = big(e["invoice:amount_minor"]);

  let net: number, deposit: number, discount: number, why: string, confidence: number;
  if (onTime === null) {
    net = 14;
    deposit = amount >= p.approvalThresholdMinor ? 2_000 : 0;
    discount = 0;
    why = "There isn't enough payment history for this client yet, so standard 14-day terms apply";
    confidence = 0.5;
  } else if (onTime >= 0.85 && trend !== "declining") {
    net = 30;
    deposit = 0;
    discount = shortfall > 0n ? 100 : 0;
    why =
      trend === "improving"
        ? `The client's recent record is strong (${recent ?? "recent invoices"} on time, reliability ${Math.round(onTime * 100)}%) after earlier late payments, so they've earned standard long terms again`
        : `The client's reliability is ${Math.round(onTime * 100)}%, so longer terms with no deposit are low risk`;
    confidence = 0.75;
  } else if (trend === "improving") {
    net = 14;
    deposit = 0;
    discount = shortfall > 0n ? 100 : 0;
    why = `The client is improving (${recent ?? "recent invoices"} on time) but their reliability is still ${Math.round(onTime * 100)}%, so standard 14-day terms with no deposit apply as a next step`;
    confidence = 0.6;
  } else if (onTime < 0.6 || (avgLate ?? 0) > 7) {
    net = 7;
    deposit = 3_000;
    discount = 0;
    why = `The client's reliability is only ${Math.round(onTime * 100)}% (about ${avgLate ?? "?"} days late on average), so short terms and a deposit protect the freelancer. Paying on time under these terms rebuilds their score`;
    confidence = 0.7;
  } else {
    net = 14;
    deposit = 0;
    discount = shortfall > 0n ? 100 : 0;
    why =
      trend === "declining"
        ? `The client's recent payments are worse than their history (${recent ?? "recent invoices"} on time, reliability ${Math.round(onTime * 100)}%), so terms tighten to 14 days`
        : `The client's record is mixed (reliability ${Math.round(onTime * 100)}%), so standard 14-day terms apply`;
    confidence = 0.6;
  }
  if (shortfall > 0n && discount > 0) why += "; a small early-pay discount helps cover the freelancer's upcoming cash shortfall";

  return {
    decision_type: "SET_TERMS",
    action: "PROPOSE_TERMS",
    params: {
      net_days: clamp(net, p.minTermsDays, p.maxTermsDays),
      deposit_bps: Math.min(deposit, p.maxDepositBps),
      early_pay_discount_bps: Math.min(discount, p.maxDiscountBps),
    },
    reasoning: `${why}. (Deterministic rule, not the model.)`,
    evidence_refs: refs(s, [
      `stat:${src}_reliability`,
      `stat:${src}_trend`,
      `stat:${src}_recent_on_time`,
      "stat:network_score_available",
      "forecast:shortfall_total_minor",
    ]),
    confidence,
  };
}

function collectionStep(s: Snapshot, p: Policy): AgentProposal {
  const days = num(s.evidence["invoice:days_overdue"]) ?? 0;
  const prev = String(s.evidence["history:previous_steps"] ?? "");
  const shortfall = big(s.evidence["forecast:shortfall_total_minor"]);
  const base = { decision_type: "COLLECTION_STEP" as const, confidence: 0.6 };
  const ev = refs(s, ["invoice:days_overdue", "history:previous_steps", "forecast:shortfall_total_minor"]);

  if (days > 21) {
    return { ...base, action: "FLAG_PAUSE_WORK", params: { message: `This invoice is ${days} days overdue. Consider pausing new work for this client until it's paid.` }, reasoning: `The invoice is ${days} days overdue after earlier steps (${prev || "none"}). Recommending a pause on new work. (Deterministic rule.)`, evidence_refs: ev };
  }
  if (days > 10) {
    return { ...base, action: "ESCALATE", params: { message: `This invoice is ${days} days overdue. A personal follow-up from you is likely to work better than more automated messages.` }, reasoning: `${days} days overdue and automated steps haven't worked (${prev || "none"}). Escalating to the freelancer. (Deterministic rule.)`, evidence_refs: ev };
  }
  if (days > 3 && shortfall > 0n && !prev.includes("DISCOUNT_OFFER") && p.maxDiscountBps > 0) {
    const bps = Math.min(100, p.maxDiscountBps);
    return { ...base, action: "DISCOUNT_OFFER", params: { discount_bps: bps, message: `Your invoice is ${days} days past due. If you pay within 3 days, you can take ${bps / 100}% off the outstanding amount.` }, reasoning: `${days} days overdue and the freelancer has an upcoming cash shortfall, so a small discount for fast payment is worth more than waiting. (Deterministic rule.)`, evidence_refs: ev };
  }
  if (days > 3 && !prev.includes("LATE_FEE_NOTICE") && p.lateFeeBpsCap > 0) {
    const bps = Math.min(100, p.lateFeeBpsCap);
    return { ...base, action: "LATE_FEE_NOTICE", params: { late_fee_bps: bps, message: `Your invoice is ${days} days past due. Under the agreed terms, a ${bps / 100}% late fee may apply.` }, reasoning: `${days} days overdue and a reminder has already gone out (${prev || "none"}). Sending a late-fee notice. (Deterministic rule.)`, evidence_refs: ev };
  }
  return { ...base, action: "REMINDER", params: { message: `Friendly reminder: this invoice was due ${days} day${days === 1 ? "" : "s"} ago. You can pay at the link below.` }, reasoning: `The invoice is ${days} days overdue. A polite reminder is the first step. (Deterministic rule.)`, evidence_refs: ev };
}

function reconcile(s: Snapshot): AgentProposal {
  const excess = big(s.evidence["reconcile:excess_minor"]);
  const outstanding = big(s.evidence["reconcile:outstanding_minor"]);
  const ev = refs(s, ["payment:classification", "reconcile:excess_minor", "reconcile:outstanding_minor"]);
  if (excess > 0n) {
    return {
      decision_type: "RECONCILE",
      action: "PROPOSE_REFUND",
      params: { refund_amount_minor: excess.toString(), note: "Refund of the amount received above the invoice total, once the payer confirms a refund address." },
      reasoning: `The deposit address received ${excess} minor units more than the invoice total. That money isn't the freelancer's, so it should be refunded after the payer confirms where to send it. (Deterministic rule.)`,
      evidence_refs: ev,
      confidence: 0.9,
    };
  }
  if (outstanding > 0n) {
    return {
      decision_type: "RECONCILE",
      action: "REQUEST_BALANCE",
      params: { note: `A partial payment was received; ${outstanding} minor units are still outstanding.` },
      reasoning: `The payment covered only part of the invoice, so the client should be asked for the remaining ${outstanding} minor units. (Deterministic rule.)`,
      evidence_refs: ev,
      confidence: 0.85,
    };
  }
  return {
    decision_type: "RECONCILE",
    action: "NO_ACTION",
    params: { note: "Nothing to reconcile." },
    reasoning: "The payments match the invoice total, so there is nothing to do. (Deterministic rule.)",
    evidence_refs: ev,
    confidence: 0.9,
  };
}

function earlyPay(s: Snapshot, p: Policy): AgentProposal {
  const shortfall = big(s.evidence["forecast:shortfall_total_minor"]);
  const ev = refs(s, ["forecast:shortfall_total_minor"]);
  const candidates = Object.keys(s.evidence)
    .filter((k) => k.startsWith("candidate:") && k.endsWith(":outstanding_minor"))
    .map((k) => {
      const id = k.slice("candidate:".length, -":outstanding_minor".length);
      return { id, outstanding: big(s.evidence[k]), onTime: num(s.evidence[`candidate:${id}:client_on_time_rate`]) ?? 0 };
    })
    .sort((a, b) => b.onTime - a.onTime);

  if (shortfall <= 0n || candidates.length === 0 || p.maxDiscountBps === 0) {
    return { decision_type: "EARLY_PAY_OFFER", action: "NO_OFFER", params: { offers: [] }, reasoning: "There is no forecast shortfall (or no eligible invoice), so no early-payment discount is needed. (Deterministic rule.)", evidence_refs: ev, confidence: 0.8 };
  }
  const bps = Math.min(150, p.maxDiscountBps);
  const offers: { invoice_id: string; discount_bps: number; valid_for_days: number }[] = [];
  let covered = 0n;
  for (const c of candidates) {
    if (covered >= shortfall) break;
    offers.push({ invoice_id: c.id, discount_bps: bps, valid_for_days: 3 });
    ev.push(`candidate:${c.id}:outstanding_minor`);
    covered += c.outstanding;
  }
  return {
    decision_type: "EARLY_PAY_OFFER",
    action: "OFFER_DISCOUNTS",
    params: { offers },
    reasoning: `The forecast shows a shortfall of ${shortfall} minor units. Offering a ${bps / 100}% discount for early payment on the most reliable clients' invoices covers it. (Deterministic rule.)`,
    evidence_refs: [...new Set(ev)],
    confidence: 0.65,
  };
}
