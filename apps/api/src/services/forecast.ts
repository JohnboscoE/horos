import { forecastCash, minorFromString, type Forecast, type Receivable } from "@horos/core";
import type { Queryable } from "../db/db.js";
import { networkStats, privateStats } from "./stats.js";

export const FORECAST_HORIZON_DAYS = 30;

export interface FreelancerForecast extends Forecast {
  receivables: (Receivable & { clientOnTimeRate: number | null; status: string })[];
  needs: { id: string; dueDate: number; amountMinor: bigint; label: string }[];
  startingBalanceMinor: bigint;
}

/** Cash forecast over open USDC receivables. EURC invoices are left out until FX is supported. */
export async function freelancerForecast(q: Queryable, freelancerId: string, now: Date): Promise<FreelancerForecast> {
  const nowS = Math.floor(now.getTime() / 1000);
  const [fr] = await q.query<{ cash_on_hand_minor: string }>("SELECT cash_on_hand_minor FROM freelancers WHERE id = $1", [freelancerId]);
  const needsRows = await q.query<{ id: string; due_date: Date; amount_minor: string; label: string }>(
    "SELECT id, due_date, amount_minor, label FROM cash_needs WHERE freelancer_id = $1 ORDER BY due_date",
    [freelancerId],
  );
  const invRows = await q.query<{ id: string; client_id: string; amount_minor: string; paid_minor: string; due_date: Date; status: string }>(
    `SELECT id, client_id, amount_minor, paid_minor, due_date, status FROM invoices
     WHERE freelancer_id = $1 AND currency = 'USDC' AND due_date IS NOT NULL
       AND status IN ('SENT','ACKNOWLEDGED','PARTIALLY_PAID','OVERDUE')`,
    [freelancerId],
  );

  const statsCache = new Map<string, { avgLate: number; onTime: number | null }>();
  const receivables: FreelancerForecast["receivables"] = [];
  for (const r of invRows) {
    if (!statsCache.has(r.client_id)) {
      const net = await networkStats(q, r.client_id, now);
      const priv = await privateStats(q, freelancerId, r.client_id, now);
      const use = net.displayable ? net : priv;
      statsCache.set(r.client_id, { avgLate: use.avgDaysLate ?? 0, onTime: use.onTimeRate });
    }
    const s = statsCache.get(r.client_id)!;
    const outstanding = minorFromString(r.amount_minor) - minorFromString(r.paid_minor);
    receivables.push({
      invoiceId: r.id,
      clientId: r.client_id,
      outstandingMinor: outstanding > 0n ? outstanding : 0n,
      dueDate: Math.floor(new Date(r.due_date).getTime() / 1000),
      expectedDaysLate: s.avgLate,
      clientOnTimeRate: s.onTime,
      status: r.status,
    });
  }

  const needs = needsRows.map((n) => ({
    id: n.id,
    dueDate: Math.floor(new Date(n.due_date).getTime() / 1000),
    amountMinor: minorFromString(n.amount_minor),
    label: n.label,
  }));
  const startingBalanceMinor = minorFromString(fr?.cash_on_hand_minor ?? "0");
  const f = forecastCash({ now: nowS, startingBalanceMinor, needs, receivables, horizonDays: FORECAST_HORIZON_DAYS });
  return { ...f, receivables, needs, startingBalanceMinor };
}
