import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, auth } from "@/api";
import { ErrorNote } from "@/ui/bits";
import { ResponsiveHeroBanner } from "@/components/ui/responsive-hero-banner";
import { FLOW_STEPS, FlowStepper, useFlowStep } from "@/components/ui/flow-simulation";
import { cn } from "@/lib/utils";

// Dark, blue-teal photo of Earth at night with network lines (Unsplash).
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=2400&q=80";

export function Home() {
  const signedIn = !!auth.get();

  return (
    <div className="bg-background text-foreground">
      <ResponsiveHeroBanner
        logo={
          <span className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
            <span className="inline-block h-3.5 w-3.5 rounded-sm bg-primary" /> Horos
          </span>
        }
        backgroundImageUrl={HERO_IMAGE}
        navLinks={[
          { label: "Home", href: "/", isActive: true },
          { label: "How it works", href: "#how" },
          { label: "Decision log", href: "/log" },
          { label: "Metrics", href: "/metrics" },
        ]}
        ctaButtonText={signedIn ? "Open app" : "Get started"}
        ctaButtonHref={signedIn ? "/dashboard" : "#start"}
        badgeLabel="Live"
        badgeText="On Arc Testnet · clients can now pay by card"
        title="Know who pays late,"
        titleLine2="before you start the work."
        description="Invoices paid in USDC on Arc build a shared payment record. An AI agent sets your terms from it and runs collections, inside bounds you set. Every decision is signed and replayable."
        primaryButtonText={signedIn ? "Go to your invoices" : "Start as a freelancer"}
        primaryButtonHref={signedIn ? "/dashboard" : "#start"}
        secondaryButtonText="Watch how it works"
        secondaryButtonHref="#how"
        partnersTitle="Built on"
        partners={[
          { label: "Arc", href: "https://docs.arc.network" },
          { label: "Circle Wallets", href: "https://developers.circle.com" },
          { label: "USDC", href: "https://www.circle.com/usdc" },
          { label: "App Kit Onramp", href: "https://docs.arc.io/app-kit/onramp" },
          { label: "Claude", href: "https://www.anthropic.com/claude" },
        ]}
      >
        <LiveFlowStrip />
      </ResponsiveHeroBanner>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24">
        <div className="mb-10 max-w-2xl">
          <div className="mb-3 text-xs uppercase tracking-[0.25em] text-primary">How it works</div>
          <h2 className="text-raised text-3xl font-bold tracking-tight md:text-5xl">One invoice, start to finish.</h2>
          <p className="mt-4 text-muted-foreground">
            Follow a single invoice through Horos. Hover to pause, or click a step to look closer.
          </p>
        </div>
        <FlowStepper />
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-24 md:grid-cols-3">
        {[
          ["The model proposes, code decides", "Every proposal is schema-checked, its evidence verified against the input, and run through your policy bounds. No code path lets model output move money."],
          ["Money only flows in", "No escrow. Refunds only cover the excess received, and only go to an address the payer confirms. Circle idempotency keys prevent double sends."],
          ["Replay any decision", "Inputs are hashed, and every decision is hash-chained and signed. The chain head is anchored on Arc, so tampering shows up."],
        ].map(([t, d]) => (
          <div key={t} className="card">
            <h3 className="mb-2 font-semibold">{t}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>

      <section id="start" className="mx-auto grid max-w-6xl scroll-mt-20 gap-8 px-4 pb-24 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <h2 className="text-raised text-3xl font-bold tracking-tight md:text-4xl">
            Good payers earn a credential. <span className="text-primary">Not a blacklist.</span>
          </h2>
          <p className="max-w-xl text-muted-foreground">
            Clients who pay on time want the record, because it helps them attract contributors. Clients can respond to any entry, and disputed entries don't count toward scoring.
          </p>
          <div className="card max-w-xl space-y-2 text-sm">
            <div className="font-semibold">Honest limits</div>
            <ul className="space-y-1 text-muted-foreground">
              <li>· Not sybil-proof: a signature proves a wallet signed, not who owns it.</li>
              <li>· Late fees are notices. Nothing can enforce them.</li>
              <li>· Facts only: due date, paid date, amount band. Not a credit bureau.</li>
            </ul>
          </div>
        </div>
        <Signup />
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground">
          Horos is a beta built on Arc with Circle. It records objective payment facts only. Contracts are unaudited.
        </div>
      </footer>
    </div>
  );
}

/** In-hero simulation: one invoice moving through Horos, auto-advancing. */
function LiveFlowStrip() {
  const step = useFlowStep(2200);
  const current = FLOW_STEPS[step]!;
  return (
    <div className="rounded-2xl bg-card/80 p-4 text-left ring-1 ring-white/10 backdrop-blur sm:p-5" aria-live="polite">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Live simulation · one invoice</div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-white/70">Acme DAO · 250.00 USDC</span>
          <span className="rounded-full border border-primary px-2 py-0.5 text-[11px] font-semibold text-primary">{current.status}</span>
        </div>
      </div>
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {FLOW_STEPS.map((s, i) => (
          <li key={s.key} className="min-w-0">
            <div className={cn("h-1.5 rounded-full transition-colors duration-500", i <= step ? "bg-primary" : "bg-white/10")} />
            <div className={cn("mt-2 hidden text-xs font-medium transition-colors duration-500 sm:block", i === step ? "text-white" : i < step ? "text-white/60" : "text-white/35")}>
              {s.title}
            </div>
          </li>
        ))}
      </ol>
      <div key={current.key} className="animate-fade-slide-in-1 mt-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
        <span className="font-semibold text-white">{current.title}</span>
        <span className="text-sm text-white/75">{current.body}</span>
        <span className="text-sm text-primary sm:ml-auto">{current.detail}</span>
      </div>
    </div>
  );
}

function Signup() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.get()) {
    return (
      <div className="card h-fit space-y-3">
        <p>You're signed in.</p>
        <Link className="btn" to="/dashboard">Go to invoices</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form
        className="card space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const r = await api("/api/signup", { body: { name, email } });
            auth.set(r.token);
            nav("/dashboard");
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="font-semibold">Start as a freelancer</h3>
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <ErrorNote error={err} />
        <button className="btn w-full" disabled={busy}>{busy ? "Creating your wallet…" : "Create account"}</button>
        <p className="text-xs text-muted-foreground">A Circle wallet is created for you on Arc.</p>
      </form>
      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          auth.set(token.trim());
          nav("/dashboard");
        }}
      >
        <h3 className="font-semibold">Have an access token?</h3>
        <input className="input mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste token" />
        <button className="btn-ghost w-full">Sign in</button>
      </form>
    </div>
  );
}
