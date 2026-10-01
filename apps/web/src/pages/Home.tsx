import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Briefcase, Building2, Check } from "lucide-react";
import { api, auth, clientAuth } from "@/api";
import { ErrorNote } from "@/ui/bits";
import { ResponsiveHeroBanner } from "@/components/ui/responsive-hero-banner";
import { FLOW_STEPS, FlowStepper, useFlowStep } from "@/components/ui/flow-simulation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth";

// Dark, blue-teal photo of Earth at night with network lines (Unsplash).
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=2400&q=80";

export function Home() {
  const signedIn = !!auth.get();
  const clientSignedIn = !!clientAuth.get();

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
          { label: "For freelancers", href: "#start" },
          { label: "For clients", href: "/client" },
          { label: "Decision log", href: "/log" },
          { label: "Metrics", href: "/metrics" },
        ]}
        ctaButtonText={signedIn ? "Open app" : clientSignedIn ? "Your invoices" : "Sign in"}
        ctaButtonHref={signedIn ? "/dashboard" : clientSignedIn ? "/client/dashboard" : "#start"}
        badgeLabel="Live"
        badgeText="On Arc Testnet · clients can now pay by card"
        title="Know who pays late,"
        titleLine2="before you start the work."
        description="Trust on both sides of freelance work paid in USDC on Arc. Clients sign for the work they received, freelancers see who pays on time, and an AI agent sets terms and runs collections inside bounds you set."
        primaryButtonText={signedIn ? "Go to your invoices" : "I'm a freelancer"}
        primaryButtonHref={signedIn ? "/dashboard" : "#start"}
        secondaryButtonText={clientSignedIn ? "Your client dashboard" : "I'm a client"}
        secondaryButtonHref={clientSignedIn ? "/client/dashboard" : "/client"}
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

      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="mb-10 max-w-2xl">
          <div className="mb-3 text-xs uppercase tracking-[0.25em] text-primary">Trust, both ways</div>
          <h2 className="text-raised text-3xl font-bold tracking-tight md:text-5xl">Each side can check the other.</h2>
          <p className="mt-4 text-muted-foreground">
            Horos starts where a marketplace's protection ends: work you found yourself, through referrals, LinkedIn, X or Discord. Every
            record is built from invoices the client signed, so neither side can invent history.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TrustCard
            icon={<Building2 className="h-5 w-5 text-primary" aria-hidden="true" />}
            title="Clients check the freelancer"
            points={[
              "A public record: invoices signed by clients, how many different clients, and how many came with linked work.",
              "Each invoice links to the delivered work. Signing confirms you received it, and the link can't change afterwards.",
              "A dashboard of everything you've signed, paid and still owe.",
            ]}
          />
          <TrustCard
            icon={<Briefcase className="h-5 w-5 text-primary" aria-hidden="true" />}
            title="Freelancers check the client"
            points={[
              "A payment record per client organization: on time, late or unpaid, weighted toward recent invoices.",
              "The agent sets terms from it: a deposit for a risky client, an early-payment discount for a reliable one.",
              "Good payers earn a credential, not a blacklist. Clients can respond to any entry, and disputed entries don't count.",
            ]}
          />
        </div>
      </section>

      <section id="start" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24">
        <div className="mb-8 text-center">
          <div className="mb-3 text-xs uppercase tracking-[0.25em] text-primary">Get started</div>
          <h2 className="text-raised text-3xl font-bold tracking-tight md:text-4xl">How do you use Horos?</h2>
          <p className="mt-3 text-muted-foreground">Two separate accounts, each with its own dashboard and history.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Signup />
          <ClientEntry />
        </div>
        <div className="card mx-auto mt-8 max-w-3xl space-y-2 text-sm">
          <div className="font-semibold">Honest limits</div>
          <ul className="space-y-1 text-muted-foreground">
            <li>· Not sybil-proof: a signature proves a wallet signed, not who owns it.</li>
            <li>· Late fees are notices. Nothing can enforce them.</li>
            <li>· Facts only: due date, paid date, amount band. Not a credit bureau.</li>
          </ul>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground">
          Horos is a beta built on Arc with Circle. It records objective payment facts only. Contracts are unaudited.
        </div>
      </footer>
    </div>
  );
}

function TrustCard({ icon, title, points }: { icon: React.ReactNode; title: string; points: string[] }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">{icon}</span>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <ul className="space-y-2.5 text-sm text-muted-foreground">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleHeading({ icon, role, title }: { icon: React.ReactNode; role: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">{icon}</span>
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-primary">{role}</div>
        <h3 className="font-semibold">{title}</h3>
      </div>
    </div>
  );
}

const FreelancerHeading = () => (
  <RoleHeading icon={<Briefcase className="h-5 w-5 text-primary" aria-hidden="true" />} role="Freelancer" title="I do the work and send invoices" />
);

/** Client side of the role choice: a separate sign-in that only shows invoices addressed to you. */
function ClientEntry() {
  const signedIn = !!clientAuth.get();
  return (
    <div className="card flex h-full flex-col space-y-4">
      <RoleHeading icon={<Building2 className="h-5 w-5 text-primary" aria-hidden="true" />} role="Client" title="I hire freelancers and pay invoices" />
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li>· Every invoice sent to you, with the work it's for</li>
        <li>· What you've paid, what's due, and refunds owed to you</li>
        <li>· Each freelancer's record, and your organization's own</li>
      </ul>
      <div className="mt-auto space-y-2 pt-2">
        <Link className="btn w-full" to={signedIn ? "/client/dashboard" : "/client"}>
          {signedIn ? "Open your client dashboard" : "Sign in as a client"}
        </Link>
        <p className="text-xs text-muted-foreground">With the wallet you sign invoices with, or your email. No freelancer account is created.</p>
      </div>
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
  const { mode } = useAuth();
  if (auth.get()) {
    return (
      <div className="card flex h-full flex-col space-y-4">
        <FreelancerHeading />
        <p className="text-sm text-muted-foreground">You're signed in as a freelancer.</p>
        <Link className="btn mt-auto w-full" to="/dashboard">Open your freelancer dashboard</Link>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col space-y-4">
      {mode === "privy" ? <PrivySignup /> : <DevSignup />}
      <DevTokenLogin collapsed={mode === "privy"} />
    </div>
  );
}

/** Privy: email, Google or wallet. First sign-in creates the account, then onboarding asks for a name. */
function PrivySignup() {
  const { startSignIn, busy, error } = useAuth();
  return (
    <div className="card flex flex-1 flex-col space-y-4">
      <FreelancerHeading />
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li>· Invoices that link to your work, and a public record to share</li>
        <li>· Terms set from each client's payment record</li>
        <li>· Payments in USDC to your own Circle wallet on Arc</li>
      </ul>
      <ErrorNote error={error} />
      <div className="mt-auto space-y-2 pt-2">
        <button className="btn w-full" onClick={() => startSignIn("freelancer")} disabled={busy}>
          {busy ? "Setting up your account…" : "Sign in as a freelancer"}
        </button>
        <p className="text-xs text-muted-foreground">Email, Google or wallet, secured by Privy. Horos never sees your password or wallet keys.</p>
      </div>
    </div>
  );
}

/** Dev fallback when Privy isn't configured. */
function DevSignup() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
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
      <FreelancerHeading />
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
      <p className="text-xs text-muted-foreground">Dev sign-up (Privy isn't configured). A Circle wallet is created for you on Arc.</p>
    </form>
  );
}

/** Access-token sign-in for seeded demo accounts. */
function DevTokenLogin({ collapsed }: { collapsed: boolean }) {
  const nav = useNavigate();
  const [token, setToken] = useState("");
  const form = (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        auth.set(token.trim());
        nav("/dashboard");
      }}
    >
      <input className="input mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste token" />
      <button className="btn-ghost w-full">Sign in</button>
    </form>
  );
  if (collapsed) {
    return (
      <details className="card text-sm">
        <summary className="cursor-pointer text-muted-foreground">Have a demo access token?</summary>
        <div className="mt-3">{form}</div>
      </details>
    );
  }
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold">Have an access token?</h3>
      {form}
    </div>
  );
}
