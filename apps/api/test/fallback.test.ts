import { describe, expect, it } from "vitest";
import { fallbackProposal } from "../src/agent/fallback.js";
import type { Snapshot } from "../src/agent/snapshot.js";
import { DEFAULT_POLICY } from "../src/services/stats.js";

const terms = (evidence: Snapshot["evidence"]) => {
  const p = fallbackProposal({ decisionType: "SET_TERMS", subject: { type: "invoice", id: "inv_1" }, evidence, untrusted: [] }, DEFAULT_POLICY);
  if (p.decision_type !== "SET_TERMS") throw new Error("wrong type");
  return p;
};

const base = {
  "invoice:amount_minor": "250000000",
  "stat:network_score_available": true,
  "forecast:shortfall_total_minor": "0",
};

describe("fallback SET_TERMS uses reliability and trend (clients can rebuild credibility)", () => {
  it("an improving client with strong recent reliability earns back long terms", () => {
    const p = terms({ ...base, "stat:network_reliability": 0.9, "stat:network_on_time_rate": 0.71, "stat:network_trend": "improving", "stat:network_recent_on_time": "5/5" });
    expect(p.params).toMatchObject({ net_days: 30, deposit_bps: 0 });
    expect(p.reasoning).toMatch(/earned standard long terms again/);
    expect(p.evidence_refs).toContain("stat:network_trend");
  });

  it("an improving client still below the bar gets a step up, not a deposit", () => {
    const p = terms({ ...base, "stat:network_reliability": 0.55, "stat:network_trend": "improving", "stat:network_recent_on_time": "4/5" });
    expect(p.params).toMatchObject({ net_days: 14, deposit_bps: 0 });
  });

  it("a declining client with a good lifetime record is tightened", () => {
    const p = terms({ ...base, "stat:network_reliability": 0.88, "stat:network_on_time_rate": 0.9, "stat:network_trend": "declining", "stat:network_recent_on_time": "2/5" });
    expect(p.params.net_days).toBe(14);
    expect(p.reasoning).toMatch(/worse than their history/);
  });

  it("an unreliable client gets short terms and a deposit, with a path back", () => {
    const p = terms({ ...base, "stat:network_reliability": 0.4, "stat:network_avg_days_late": 12 });
    expect(p.params).toMatchObject({ net_days: 7, deposit_bps: 3000 });
    expect(p.reasoning).toMatch(/rebuilds their score/);
  });

  it("every cited evidence ref exists in the snapshot", () => {
    const evidence = { ...base, "stat:network_reliability": 0.9, "stat:network_trend": "steady" };
    const p = terms(evidence);
    for (const r of p.evidence_refs) expect(Object.keys(evidence)).toContain(r);
  });
});
