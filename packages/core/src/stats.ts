/**
 * Client payment stats computed from record facts. The agent only ever sees these computed stats,
 * never raw rows.
 *
 * Display rule (SPEC §5.5): the network score is shown only with >= 3 non-disputed, acknowledged
 * invoices from >= 2 distinct freelancers. Otherwise it's "insufficient data" and the agent treats
 * the client as new.
 *
 * Recovery (how a client rebuilds credibility):
 *  - Reliability is time-decayed: each invoice is weighted 0.5^(age / 90 days), so recent behaviour
 *    dominates and old mistakes fade. Facts onchain never change; only the score ages them.
 *  - Lateness is graded: a day or two late costs far less than a month late.
 *  - Unpaid overdue invoices never fade (their age is always "now") and count as fully late.
 *  - Invoices resolved more than 18 months ago drop out of scoring but stay in the history.
 *  - A recent streak and a trend make improvement visible to people and to the agent.
 */

export const MIN_INVOICES_FOR_SCORE = 3;
export const MIN_FREELANCERS_FOR_SCORE = 2;
export const HALF_LIFE_DAYS = 90;
export const SCORE_WINDOW_DAYS = 540;
export const RECENT_COUNT = 5;
const DAY = 86_400;

export interface RecordFact {
  freelancerId: string;
  /** Unix seconds. */
  dueDate: number;
  /** Unix seconds, null if unpaid. */
  paidAt: number | null;
  acknowledged: boolean;
  disputed: boolean;
  /** Paid under probation-style terms (a deposit, or short net terms). On-time ones count toward recovery. */
  strictTerms?: boolean;
}

export type Trend = "improving" | "steady" | "declining";

export interface ClientStats {
  /** Acknowledged, non-disputed invoices inside the scoring window. */
  invoiceCount: number;
  distinctFreelancers: number;
  settledCount: number;
  onTimeCount: number;
  /** Unpaid and past due at `now`. */
  openOverdueCount: number;
  /** Lifetime (in-window) on-time / resolved, unweighted. null when nothing has resolved yet. */
  onTimeRate: number | null;
  /** Mean days late over settled + open-overdue (on-time counts as 0). */
  avgDaysLate: number | null;
  /**
   * The headline score, 0..1: time-decayed (90-day half-life), graded for how late. null when nothing
   * has resolved yet.
   */
  reliability: number | null;
  /** The most recent resolved invoices (newest first): how many of the last N were on time. */
  recent: { onTime: number; total: number };
  /** Recent behaviour vs the in-window lifetime rate. null until there's enough history to compare. */
  trend: Trend | null;
  /** On-time payments made under strict terms (deposit / short terms): the probation path. */
  onTimeUnderStrictTerms: number;
  /** Resolved invoices older than the scoring window (still visible in the history). */
  agedOutCount: number;
  /** 0..1, grows with invoice count and freelancer diversity. */
  confidence: number;
  displayable: boolean;
}

export function daysLate(dueDate: number, paidAt: number): number {
  return paidAt <= dueDate ? 0 : Math.ceil((paidAt - dueDate) / DAY);
}

/**
 * Credit an invoice earns toward reliability, by days late:
 *   on time 1 · 1–3 days 0.5 · 4–14 days 0.25 · 15–29 days 0.1 · 30+ days or unpaid-overdue 0
 */
export function latenessCredit(daysLateValue: number, unpaid = false): number {
  if (unpaid) return 0;
  if (daysLateValue <= 0) return 1;
  if (daysLateValue <= 3) return 0.5;
  if (daysLateValue <= 14) return 0.25;
  if (daysLateValue <= 29) return 0.1;
  return 0;
}

/** Weight of an invoice resolved `ageDays` ago under the 90-day half-life. */
export function decayWeight(ageDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
}

interface Resolved {
  freelancerId: string;
  /** When it resolved: paid date, or now for unpaid-overdue (so unpaid debt never fades). */
  at: number;
  daysLate: number;
  unpaid: boolean;
  credit: number;
  strictTerms: boolean;
}

export function computeClientStats(facts: RecordFact[], now: number): ClientStats {
  const valid = facts.filter((f) => f.acknowledged && !f.disputed);
  const windowStart = now - SCORE_WINDOW_DAYS * DAY;

  const resolvedAll: Resolved[] = [];
  const pending: RecordFact[] = [];
  for (const f of valid) {
    if (f.paidAt !== null) {
      const d = daysLate(f.dueDate, f.paidAt);
      resolvedAll.push({ freelancerId: f.freelancerId, at: f.paidAt, daysLate: d, unpaid: false, credit: latenessCredit(d), strictTerms: !!f.strictTerms });
    } else if (now > f.dueDate) {
      const d = daysLate(f.dueDate, now);
      resolvedAll.push({ freelancerId: f.freelancerId, at: now, daysLate: d, unpaid: true, credit: 0, strictTerms: !!f.strictTerms });
    } else {
      pending.push(f);
    }
  }

  const resolved = resolvedAll.filter((r) => r.at >= windowStart);
  const agedOutCount = resolvedAll.length - resolved.length;
  // Not-yet-due invoices always count toward "how much history exists".
  const inWindowFreelancers = new Set([...resolved.map((r) => r.freelancerId), ...pending.map((p) => p.freelancerId)]);

  const settled = resolved.filter((r) => !r.unpaid);
  const onTime = resolved.filter((r) => r.credit === 1);
  const openOverdue = resolved.filter((r) => r.unpaid);

  let wSum = 0;
  let wCredit = 0;
  for (const r of resolved) {
    const w = decayWeight((now - r.at) / DAY);
    wSum += w;
    wCredit += w * r.credit;
  }

  const lifetimeRate = resolved.length === 0 ? null : onTime.length / resolved.length;
  const newest = [...resolved].sort((a, b) => b.at - a.at).slice(0, RECENT_COUNT);
  const recentOnTime = newest.filter((r) => r.credit === 1).length;

  let trend: Trend | null = null;
  // Only meaningful when there's history beyond the recent window to compare against.
  if (resolved.length > RECENT_COUNT && lifetimeRate !== null) {
    const recentRate = recentOnTime / newest.length;
    if (recentRate - lifetimeRate >= 0.2 && recentRate >= 0.8) trend = "improving";
    else if (lifetimeRate - recentRate >= 0.2) trend = "declining";
    else trend = "steady";
  }

  const n = resolved.length + pending.length;
  const d = inWindowFreelancers.size;
  const confidence = round2(Math.min(1, n / 10) * 0.6 + Math.min(1, d / 4) * 0.4);

  return {
    invoiceCount: n,
    distinctFreelancers: d,
    settledCount: settled.length,
    onTimeCount: onTime.length,
    openOverdueCount: openOverdue.length,
    onTimeRate: lifetimeRate === null ? null : round2(lifetimeRate),
    avgDaysLate: resolved.length === 0 ? null : round2(resolved.reduce((s, r) => s + r.daysLate, 0) / resolved.length),
    reliability: wSum === 0 ? null : round2(wCredit / wSum),
    recent: { onTime: recentOnTime, total: newest.length },
    trend,
    onTimeUnderStrictTerms: onTime.filter((r) => r.strictTerms).length,
    agedOutCount,
    confidence,
    displayable: n >= MIN_INVOICES_FOR_SCORE && d >= MIN_FREELANCERS_FOR_SCORE,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
