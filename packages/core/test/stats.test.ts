import { describe, expect, it } from "vitest";
import { computeClientStats, decayWeight, latenessCredit, type RecordFact } from "../src/stats.js";
import { forecastCash } from "../src/forecast.js";

const DAY = 86_400;
const NOW = 1_760_000_000;

const fact = (freelancerId: string, dueOffsetDays: number, paidOffsetDays: number | null, extra: Partial<RecordFact> = {}): RecordFact => ({
  freelancerId,
  dueDate: NOW + dueOffsetDays * DAY,
  paidAt: paidOffsetDays === null ? null : NOW + paidOffsetDays * DAY,
  acknowledged: true,
  disputed: false,
  ...extra,
});

describe("computeClientStats", () => {
  it("applies the display rule: ≥3 invoices from ≥2 freelancers", () => {
    expect(computeClientStats([fact("a", -10, -11), fact("a", -5, -6), fact("a", -2, -3)], NOW).displayable).toBe(false);
    expect(computeClientStats([fact("a", -10, -11), fact("b", -5, -6)], NOW).displayable).toBe(false);
    expect(computeClientStats([fact("a", -10, -11), fact("a", -5, -6), fact("b", -2, -3)], NOW).displayable).toBe(true);
  });

  it("excludes disputed and unacknowledged entries", () => {
    const s = computeClientStats(
      [fact("a", -10, 0), fact("b", -10, 0, { disputed: true }), fact("c", -10, 0, { acknowledged: false })],
      NOW,
    );
    expect(s.invoiceCount).toBe(1);
    expect(s.distinctFreelancers).toBe(1);
  });

  it("computes on-time rate and lateness, including open overdue", () => {
    const s = computeClientStats(
      [
        fact("a", -20, -21), // on time
        fact("b", -20, -16), // 4 days late
        fact("a", -6, null), // 6 days overdue, unpaid
        fact("b", 5, null), // not due yet: not resolved
      ],
      NOW,
    );
    expect(s.settledCount).toBe(2);
    expect(s.openOverdueCount).toBe(1);
    expect(s.onTimeRate).toBe(0.33);
    expect(s.avgDaysLate).toBe(3.33);
  });

  it("returns null rates with no resolved invoices", () => {
    expect(computeClientStats([], NOW)).toMatchObject({ onTimeRate: null, avgDaysLate: null, confidence: 0, displayable: false });
  });
});

describe("recovery: decay, grading, window, trend", () => {
  it("90-day half-life", () => {
    expect(decayWeight(0)).toBe(1);
    expect(decayWeight(90)).toBeCloseTo(0.5);
    expect(decayWeight(180)).toBeCloseTo(0.25);
  });

  it("grades lateness instead of pass/fail", () => {
    expect([0, 2, 10, 20, 45].map((d) => latenessCredit(d))).toEqual([1, 0.5, 0.25, 0.1, 0]);
    expect(latenessCredit(0, true)).toBe(0);
  });

  it("a client who paid late months ago recovers by paying on time now", () => {
    // Two 20-days-late payments ~6 months ago, then five on time in the last two months.
    const facts = [
      fact("a", -200, -180),
      fact("b", -195, -175),
      ...[-60, -45, -30, -20, -10].map((dd, i) => fact(i % 2 ? "a" : "b", dd, dd - 1)),
    ];
    const s = computeClientStats(facts, NOW);
    expect(s.onTimeRate).toBe(0.71); // lifetime, unweighted: 5/7
    expect(s.reliability!).toBeGreaterThan(0.85); // recent behaviour dominates
    expect(s.recent).toEqual({ onTime: 5, total: 5 });
    expect(s.trend).toBe("improving");
  });

  it("the same late payments count fully when they're recent", () => {
    // Three 20-days-late payments in the last month after five on-time ones ~6 months ago.
    const facts = [fact("a", -20, 0), fact("b", -25, -5), fact("a", -30, -10), ...[-200, -190, -180, -170, -160].map((dd) => fact("a", dd, dd - 1))];
    const s = computeClientStats(facts, NOW);
    expect(s.reliability!).toBeLessThan(0.5);
    expect(s.trend).toBe("declining");
  });

  it("a day late costs much less than a month late", () => {
    const slightly = computeClientStats([fact("a", -10, -9), fact("b", -10, -11), fact("a", -10, -11)], NOW);
    const very = computeClientStats([fact("a", -40, 0), fact("b", -10, -11), fact("a", -10, -11)], NOW);
    expect(slightly.reliability!).toBeGreaterThan(very.reliability!);
    expect(slightly.onTimeRate).toBe(very.onTimeRate); // the plain rate can't tell them apart
  });

  it("unpaid overdue debt never fades", () => {
    const s = computeClientStats([fact("a", -400, null), fact("b", -30, -31), fact("a", -20, -21)], NOW);
    expect(s.openOverdueCount).toBe(1);
    expect(s.agedOutCount).toBe(0);
    expect(s.reliability!).toBeLessThan(0.7);
  });

  it("invoices resolved over 18 months ago age out of scoring", () => {
    const s = computeClientStats([fact("a", -700, -600), fact("b", -30, -31), fact("a", -20, -21), fact("b", -10, -11)], NOW);
    expect(s.agedOutCount).toBe(1);
    expect(s.invoiceCount).toBe(3);
    expect(s.reliability).toBe(1);
  });

  it("counts on-time payments under strict terms (the probation path)", () => {
    const s = computeClientStats([fact("a", -10, -11, { strictTerms: true }), fact("b", -10, -11), fact("a", -10, -5, { strictTerms: true })], NOW);
    expect(s.onTimeUnderStrictTerms).toBe(1);
  });

  it("no trend until there's history beyond the recent window", () => {
    expect(computeClientStats([fact("a", -10, -11), fact("b", -10, -11), fact("a", -10, -11)], NOW).trend).toBeNull();
  });
});

describe("forecastCash", () => {
  it("finds a shortfall when rent lands before a slow client pays", () => {
    const f = forecastCash({
      now: NOW,
      startingBalanceMinor: 200_000_000n,
      needs: [{ id: "rent", dueDate: NOW + 5 * DAY, amountMinor: 1_000_000_000n, label: "Rent" }],
      receivables: [
        { invoiceId: "fast", clientId: "c1", outstandingMinor: 500_000_000n, dueDate: NOW + 2 * DAY, expectedDaysLate: 0 },
        { invoiceId: "slow", clientId: "c2", outstandingMinor: 900_000_000n, dueDate: NOW + 3 * DAY, expectedDaysLate: 9 },
      ],
      horizonDays: 30,
    });
    expect(f.shortfalls).toEqual([{ needId: "rent", at: NOW + 5 * DAY, shortfallMinor: 300_000_000n }]);
    expect(f.events.map((e) => e.ref)).toEqual(["fast", "rent", "slow"]);
  });

  it("does not double count consecutive shortfalls", () => {
    const f = forecastCash({
      now: NOW,
      startingBalanceMinor: 0n,
      needs: [
        { id: "a", dueDate: NOW + DAY, amountMinor: 10n, label: "a" },
        { id: "b", dueDate: NOW + 2 * DAY, amountMinor: 5n, label: "b" },
      ],
      receivables: [],
      horizonDays: 30,
    });
    expect(f.totalShortfallMinor).toBe(15n);
  });
});
