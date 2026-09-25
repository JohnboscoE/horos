import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A scripted run-through of Horos's core loop. Purely presentational (no API calls), used in the
 * landing hero strip and in the "How it works" section.
 */
export const FLOW_STEPS = [
  {
    key: "create",
    status: "DRAFT",
    title: "Invoice created",
    body: "Acme DAO · 250.00 USDC",
    detail: "Own deposit address 0x7a3f…c21e",
  },
  {
    key: "terms",
    status: "SENT",
    title: "Agent proposes terms",
    body: "Net 30 · no deposit · 1.5% early-pay",
    detail: "Acme DAO pays on time 94% across 6 freelancers",
    badge: "Policy ✓ within bounds · auto-applied",
  },
  {
    key: "sign",
    status: "ACKNOWLEDGED",
    title: "Client signs",
    body: "EIP-712 acknowledgment",
    detail: "0x51c…9d2 signed the invoice and its terms",
  },
  {
    key: "pay",
    status: "PAID",
    title: "Payment detected",
    body: "250.00 USDC received",
    detail: "Balance-matched on Arc · exact · 2 days early",
  },
  {
    key: "record",
    status: "RECORDED",
    title: "Written to the shared record",
    body: "PaymentRecord · on time",
    detail: "Decision #128 signed & anchored onchain",
  },
] as const;

export function useFlowStep(intervalMs = 2200, paused = false) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setStep((s) => (s + 1) % (FLOW_STEPS.length + 1)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, paused]);
  // One extra "hold" beat on the final state before looping.
  return Math.min(step, FLOW_STEPS.length - 1);
}

/** Full-width stepper for the "How it works" section. */
export function FlowStepper() {
  const [paused, setPaused] = useState(false);
  const step = useFlowStep(2600, paused);
  const [manual, setManual] = useState<number | null>(null);
  const active = manual ?? step;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => { setPaused(false); setManual(null); }}>
      <ol className="space-y-2">
        {FLOW_STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              onClick={() => setManual(i)}
              className={cn(
                "w-full rounded-2xl border p-4 text-left transition-all duration-500",
                i === active ? "border-primary/60 bg-card shadow-[0_20px_40px_-20px_rgba(0,194,168,0.35)]" : "border-border bg-transparent hover:border-muted-foreground/40",
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold", i <= active ? "border-primary text-primary" : "border-border text-muted-foreground")}>
                  {i < active ? "✓" : i + 1}
                </span>
                <div>
                  <div className="font-semibold">{s.title}</div>
                  <div className="text-sm text-muted-foreground">{s.body}</div>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ol>
      <StepDetail step={active} />
    </div>
  );
}

const DETAILS: Record<string, { heading: string; lines: [string, string][]; note: string }> = {
  create: {
    heading: "A deposit address for every invoice",
    lines: [["Client", "Acme DAO"], ["Amount", "250.00 USDC"], ["Deposit wallet", "Circle · 0x7a3f…c21e"]],
    note: "Any payment to this address matches this invoice, no matter which wallet it comes from.",
  },
  terms: {
    heading: "The agent proposes. Your policy decides.",
    lines: [["Network on-time rate", "94% · 6 freelancers"], ["Your history", "3 invoices, all on time"], ["Cash forecast", "Rent in 5 days: short 300 USDC"], ["Proposal", "Net 30 · 0% deposit · 1.5% early-pay"], ["Policy check", "✓ inside your bounds → auto-applied"]],
    note: "Anything outside your bounds lands in your approvals queue instead.",
  },
  sign: {
    heading: "Only acknowledged invoices count",
    lines: [["Signature", "EIP-712 over invoice + terms"], ["Signer", "0x51c…9d2"], ["Counts toward record", "Yes"]],
    note: "Freelancers can't invent invoices to smear a client, because the client has to sign first.",
  },
  pay: {
    heading: "Detected by balance, reconciled by code",
    lines: [["Received", "250.00 USDC"], ["Classification", "EXACT"], ["Paid", "2 days before due"]],
    note: "Partial, over- and duplicate payments are caught too. Refunds wait for the payer to confirm an address.",
  },
  record: {
    heading: "A credential for good payers",
    lines: [["PaymentRecord", "due · paid · amount band"], ["Decision log", "#128 · hash-chained · signed"], ["Anchor", "DecisionAnchor on Arc"]],
    note: "Facts only. Clients can attach a response to any entry, and disputed entries are excluded from scoring.",
  },
};

function StepDetail({ step }: { step: number }) {
  const s = FLOW_STEPS[step]!;
  const d = DETAILS[s.key]!;
  return (
    <div key={s.key} className="card flex flex-col gap-4 animate-[fadeIn_0.4s_ease]">
      <div className="text-xs uppercase tracking-wider text-primary">Step {step + 1} of {FLOW_STEPS.length}</div>
      <h3 className="text-2xl font-semibold tracking-tight">{d.heading}</h3>
      <dl className="divide-y divide-border rounded-xl border border-border bg-background">
        {d.lines.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn("text-right font-medium", v.startsWith("✓") && "text-primary")}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">{d.note}</p>
    </div>
  );
}
