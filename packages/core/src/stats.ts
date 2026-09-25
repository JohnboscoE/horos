/**
 * Client payment stats computed from record facts. The agent only ever sees these computed stats,
 * never raw rows.
 *
 * Display rule (SPEC §5.5): the network score is shown only with >= 3 non-disputed, acknowledged
 * invoices from >= 2 distinct freelancers. Otherwise it's "insufficient data" and the agent treats
 * the client as new.
 */

export const MIN_INVOICES_FOR_SCORE = 3;
export const MIN_FREELANCERS_FOR_SCORE = 2;
const DAY = 86_400;

export interface RecordFact {
  freelancerId: string;
  /** Unix seconds. */
  dueDate: number;
  /** Unix seconds, null if unpaid. */
  paidAt: number | null;
  acknowledged: boolean;
  disputed: boolean;
}

export interface ClientStats {
  /** Acknowledged, non-disputed invoices considered. */
  invoiceCount: number;
  distinctFreelancers: number;
  settledCount: number;
  onTimeCount: number;
  /** Unpaid and past due at `now`. */
  openOverdueCount: number;
  /** on-time / (settled + open overdue). null when nothing has resolved yet. */
  onTimeRate: number | null;
  /** Mean days late over settled + open-overdue (on-time counts as 0). */
  avgDaysLate: number | null;
  /** 0..1, grows with invoice count and freelancer diversity. */
  confidence: number;
  displayable: boolean;
}

export function daysLate(dueDate: number, paidAt: number): number {
  return paidAt <= dueDate ? 0 : Math.ceil((paidAt - dueDate) / DAY);
}

export function computeClientStats(facts: RecordFact[], now: number): ClientStats {
  const counted = facts.filter((f) => f.acknowledged && !f.disputed);
  const freelancers = new Set(counted.map((f) => f.freelancerId));

  let settled = 0;
  let onTime = 0;
  let openOverdue = 0;
  let lateDaysSum = 0;

  for (const f of counted) {
    if (f.paidAt !== null) {
      settled++;
      const d = daysLate(f.dueDate, f.paidAt);
      if (d === 0) onTime++;
      lateDaysSum += d;
    } else if (now > f.dueDate) {
      openOverdue++;
      lateDaysSum += daysLate(f.dueDate, now);
    }
  }

  const resolved = settled + openOverdue;
  const n = counted.length;
  const d = freelancers.size;
  const confidence = round2(Math.min(1, n / 10) * 0.6 + Math.min(1, d / 4) * 0.4);

  return {
    invoiceCount: n,
    distinctFreelancers: d,
    settledCount: settled,
    onTimeCount: onTime,
    openOverdueCount: openOverdue,
    onTimeRate: resolved === 0 ? null : round2(onTime / resolved),
    avgDaysLate: resolved === 0 ? null : round2(lateDaysSum / resolved),
    confidence,
    displayable: n >= MIN_INVOICES_FOR_SCORE && d >= MIN_FREELANCERS_FOR_SCORE,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
