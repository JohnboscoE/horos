import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, auth } from "@/api";
import { ErrorNote } from "@/ui/bits";
import { CinematicHero } from "@/components/ui/cinematic-hero";
import { FlowStepper } from "@/components/ui/flow-simulation";

export function Home() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <div className="bg-background text-foreground">
      <header className={`fixed inset-x-0 top-0 z-[70] transition-colors duration-300 ${scrolled ? "border-b border-border bg-background/85 backdrop-blur" : ""}`}>
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-3 w-3 rounded-sm bg-primary" /> Horos
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <a href="#how" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground sm:inline">How it works</a>
            <Link to="/log" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground sm:inline">Decision log</Link>
            <Link to="/metrics" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground sm:inline">Metrics</Link>
            {auth.get() ? (
              <Link to="/dashboard" className="btn ml-2 px-3 py-1.5">Open app</Link>
            ) : (
              <a href="#start" className="btn ml-2 px-3 py-1.5">Get started</a>
            )}
          </nav>
        </div>
      </header>

      <CinematicHero />

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
