/**
 * Cash forecast: upcoming needs vs expected receivables. Drives EARLY_PAY_OFFER.
 * Receivables are expected at dueDate + the client's typical lateness.
 */

const DAY = 86_400;

export interface CashNeed {
  id: string;
  /** Unix seconds. */
  dueDate: number;
  amountMinor: bigint;
  label: string;
}

export interface Receivable {
  invoiceId: string;
  clientId: string;
  outstandingMinor: bigint;
  /** Unix seconds. */
  dueDate: number;
  /** Expected lateness in days (client avgDaysLate, or 0 if unknown). */
  expectedDaysLate: number;
}

export interface ForecastEvent {
  at: number;
  kind: "RECEIPT" | "NEED";
  ref: string;
  deltaMinor: bigint;
  balanceMinor: bigint;
}

export interface Shortfall {
  needId: string;
  at: number;
  shortfallMinor: bigint;
}

export interface Forecast {
  events: ForecastEvent[];
  shortfalls: Shortfall[];
  totalShortfallMinor: bigint;
}

export function forecastCash(args: {
  now: number;
  startingBalanceMinor: bigint;
  needs: CashNeed[];
  receivables: Receivable[];
  horizonDays: number;
}): Forecast {
  const horizon = args.now + args.horizonDays * DAY;
  type Raw = { at: number; kind: "RECEIPT" | "NEED"; ref: string; delta: bigint };
  const raw: Raw[] = [];

  for (const r of args.receivables) {
    if (r.outstandingMinor <= 0n) continue;
    const at = Math.max(args.now, r.dueDate + Math.max(0, Math.round(r.expectedDaysLate)) * DAY);
    if (at <= horizon) raw.push({ at, kind: "RECEIPT", ref: r.invoiceId, delta: r.outstandingMinor });
  }
  for (const n of args.needs) {
    if (n.dueDate < args.now || n.dueDate > horizon) continue;
    raw.push({ at: n.dueDate, kind: "NEED", ref: n.id, delta: -n.amountMinor });
  }

  // Chronological; on the same timestamp, receipts land before needs.
  raw.sort((a, b) => a.at - b.at || (a.kind === b.kind ? a.ref.localeCompare(b.ref) : a.kind === "RECEIPT" ? -1 : 1));

  let balance = args.startingBalanceMinor;
  const events: ForecastEvent[] = [];
  const shortfalls: Shortfall[] = [];
  let total = 0n;

  for (const e of raw) {
    const before = balance;
    balance += e.delta;
    events.push({ at: e.at, kind: e.kind, ref: e.ref, deltaMinor: e.delta, balanceMinor: balance });
    if (e.kind === "NEED" && balance < 0n) {
      // Only the part of this need that isn't covered counts; earlier shortfalls aren't double counted.
      const uncovered = before >= 0n ? -balance : -e.delta;
      shortfalls.push({ needId: e.ref, at: e.at, shortfallMinor: uncovered });
      total += uncovered;
    }
  }

  return { events, shortfalls, totalShortfallMinor: total };
}
