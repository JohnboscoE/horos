import { describe, expect, it } from "vitest";
import { computeClientStats, type RecordFact } from "../src/stats.js";
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
