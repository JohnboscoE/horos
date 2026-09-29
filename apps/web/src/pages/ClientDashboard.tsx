import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, LogOut } from "lucide-react";
import { clientApi, clientAuth, date, pct } from "@/api";
import { useAuth } from "@/auth";
import { Badge, ErrorNote, Section, Stat } from "@/ui/bits";
import { cn } from "@/lib/utils";

type Bucket = "TO_SIGN" | "DUE" | "OVERDUE" | "PAID" | "REFUND" | "OTHER";

interface ClientInvoice {
  id: string;
  bucket: Bucket;
  status: string;
  freelancer: string;
  client: { name: string; slug: string };
  description: string;
  currency: string;
  amount: string;
  amountDueNow: string;
  paid: string;
  outstandingMinor: string;
  dueDate: string | null;
  paidAt: string | null;
  acknowledged: boolean;
  earlyPayOffer: { discount_bps: number; expires_at: string } | null;
  refundsAwaitingYou: number;
  messages: number;
  payToken: string;
}

const TABS: { key: Bucket | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "TO_SIGN", label: "To sign" },
  { key: "DUE", label: "Due" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "REFUND", label: "Refunds" },
  { key: "PAID", label: "Paid" },
];

const ACTION: Record<Bucket, string> = {
  TO_SIGN: "Review & sign",
  DUE: "Pay",
  OVERDUE: "Pay now",
  REFUND: "Confirm refund",
  PAID: "View",
  OTHER: "View",
};

export function ClientDashboard() {
  const nav = useNavigate();
  const { signOut } = useAuth();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Bucket | "ALL">("ALL");

  useEffect(() => {
    if (!clientAuth.get()) {
      nav("/client", { replace: true });
      return;
    }
    const load = () =>
      clientApi("/api/client/dashboard")
        .then(setD)
        .catch((e) => {
          if (e.status === 401) {
            clientAuth.clear();
            nav("/client", { replace: true });
          } else setErr(e.message);
        });
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [nav]);

  const invoices: ClientInvoice[] = d?.invoices ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: invoices.length };
    for (const i of invoices) c[i.bucket] = (c[i.bucket] ?? 0) + 1;
    return c;
  }, [invoices]);
  const shown = tab === "ALL" ? invoices : invoices.filter((i) => i.bucket === tab);
  const wallets = (d?.identities ?? []).filter((i: any) => i.kind === "wallet");
  const emails = (d?.identities ?? []).filter((i: any) => i.kind === "email");

  return (
    <div className="app-grain min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-3 w-3 rounded-sm bg-primary" /> Horos
          </Link>
          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">Client</span>
          <button
            className="btn-ghost ml-auto px-3 py-1"
            onClick={async () => {
              clientAuth.clear();
              await signOut();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
        <ErrorNote error={err} />
        {!d ? (
          <p className="text-sm text-muted">Loading your invoices…</p>
        ) : (
          <>
            <div>
              <h1 className="font-instrument-serif text-3xl text-white sm:text-4xl">Your invoices</h1>
              <p className="mt-1 text-sm text-muted">
                Signed in as{" "}
                {[...wallets.map((w: any) => <span key={w.value} className="mono">{w.value.slice(0, 6)}…{w.value.slice(-4)}</span>), ...emails.map((e: any) => <span key={e.value}>{e.value}</span>)].reduce(
                  (acc: React.ReactNode[], el, i) => (i ? [...acc, " · ", el] : [el]),
                  [],
                )}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Outstanding" value={`${d.totals.outstandingUsdc} USDC`} />
              <Stat label="Waiting for your signature" value={d.totals.toSign} />
              <Stat label="Overdue" value={<span className={d.totals.overdue ? "text-bad" : ""}>{d.totals.overdue}</span>} />
              <Stat label="Refunds to confirm" value={<span className={d.totals.refundsAwaitingYou ? "text-warn" : ""}>{d.totals.refundsAwaitingYou}</span>} />
            </div>

            <Section title="Invoices">
              <div className="flex flex-wrap gap-1 rounded-xl bg-ink p-1 text-sm">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cn("rounded-lg px-3 py-1.5", tab === t.key ? "bg-panel text-accent" : "text-muted hover:text-fg")}
                  >
                    {t.label} <span className="text-xs opacity-70">{counts[t.key] ?? 0}</span>
                  </button>
                ))}
              </div>

              {shown.length === 0 ? (
                <div className="card text-sm text-muted">
                  {invoices.length === 0 ? (
                    <>
                      No invoices yet. You'll see invoices here once you've signed one with this wallet, or when a freelancer sends one to your
                      verified email. If a freelancer sent you a pay link, open it and sign the invoice there.
                    </>
                  ) : (
                    "Nothing in this list."
                  )}
                </div>
              ) : (
                <div className="card overflow-x-auto p-0">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="text-left text-xs uppercase text-muted">
                      <tr className="border-b border-line">
                        <th className="px-4 py-3">From</th>
                        <th className="px-4 py-3">For</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Due</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((i) => (
                        <tr key={i.id} className="border-b border-line/60">
                          <td className="px-4 py-3">
                            <div className="font-medium">{i.freelancer}</div>
                            <div className="text-xs text-muted">{i.description || "—"}</div>
                          </td>
                          <td className="px-4 py-3 text-muted">{i.client.name}</td>
                          <td className="px-4 py-3">
                            <div>
                              {i.amount} {i.currency}
                            </div>
                            {i.bucket !== "PAID" && i.amountDueNow !== i.amount && <div className="text-xs text-accent">{i.amountDueNow} if paid now</div>}
                            {i.earlyPayOffer && new Date(i.earlyPayOffer.expires_at) > new Date() && (
                              <div className="text-xs text-accent">
                                {pct(i.earlyPayOffer.discount_bps)} off until {date(i.earlyPayOffer.expires_at)}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">{i.paidAt ? <span className="text-muted">paid {date(i.paidAt)}</span> : date(i.dueDate)}</td>
                          <td className="px-4 py-3">
                            <Badge>{i.status}</Badge>
                            {i.messages > 0 && <div className="mt-1 text-xs text-muted">{i.messages} message{i.messages === 1 ? "" : "s"}</div>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link to={`/pay/${i.payToken}`} className={i.bucket === "PAID" || i.bucket === "OTHER" ? "btn-ghost px-3 py-1.5" : "btn px-3 py-1.5"}>
                              {ACTION[i.bucket]} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {d.organizations.length > 0 && (
              <Section title="Your payment record">
                <div className="grid gap-3 md:grid-cols-2">
                  {d.organizations.map((o: any) => (
                    <div key={o.slug} className="card space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold">{o.name}</div>
                        <Link to={`/clients/${o.slug}`} className="text-xs text-muted hover:text-accent">
                          public record →
                        </Link>
                      </div>
                      {o.score ? (
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                          <span className="text-3xl font-semibold text-raised">{Math.round((o.score.reliability ?? 0) * 100)}%</span>
                          <span className="text-sm text-muted">reliability</span>
                          {o.score.trend === "improving" && <span className="text-xs font-semibold text-accent">↑ Improving</span>}
                          {o.score.trend === "declining" && <span className="text-xs font-semibold text-warn">↓ Declining</span>}
                          <span className="text-sm text-muted">
                            last {o.score.recent.total}: {o.score.recent.onTime} on time
                          </span>
                        </div>
                      ) : (
                        <p className="text-sm text-muted">
                          Not enough history yet ({o.counts.invoices} signed invoice{o.counts.invoices === 1 ? "" : "s"} from {o.counts.freelancers}{" "}
                          freelancer{o.counts.freelancers === 1 ? "" : "s"}). A score appears after 3 invoices from 2 freelancers.
                        </p>
                      )}
                      <p className="text-xs text-muted">Paying on time builds a public credential that helps you attract contributors.</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
