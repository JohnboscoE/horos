import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "@/api";
import { ErrorNote } from "@/ui/bits";

/**
 * First-run step after Privy sign-up: confirm or change the display name clients see on invoices
 * and pay pages. Prefilled with a suggestion (Google name, email, or short wallet address).
 */
export function Onboarding() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.get()) {
      nav("/", { replace: true });
      return;
    }
    api("/api/me")
      .then((me) => {
        setName(me.freelancer.name);
        setWallet(me.freelancer.main_wallet_address);
        setLoaded(true);
      })
      .catch((e) => setErr(e.message));
  }, [nav]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/me/profile", { method: "PUT", body: { name } });
      nav("/dashboard", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const trimmed = name.replace(/\s+/g, " ").trim();

  return (
    <div className="app-grain flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-3 w-3 rounded-sm bg-primary" /> Horos
        </div>

        <form onSubmit={save} className="card animate-fade-slide-in-1 space-y-5">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-primary">Welcome</div>
            <h1 className="mt-2 font-instrument-serif text-3xl text-white">What should clients call you?</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This name appears on your invoices and on the page clients use to sign and pay. We've suggested one. Change it to your name or
              your studio's.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              className="input text-base"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
              disabled={!loaded}
              placeholder={loaded ? "" : "Loading…"}
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>You can change this later in Settings.</span>
              <span>{trimmed.length}/80</span>
            </div>
          </div>

          {trimmed && (
            <div className="rounded-xl border border-border bg-background p-3 text-sm">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Clients will see</div>
              <div className="mt-1">
                Invoice from <span className="font-semibold text-foreground">{trimmed}</span>
              </div>
            </div>
          )}

          {wallet && (
            <div className="text-xs text-muted-foreground">
              Your Circle wallet on Arc is ready: <span className="mono text-foreground">{wallet}</span>
            </div>
          )}

          <ErrorNote error={err} />
          <button className="btn w-full" disabled={busy || !loaded || !trimmed}>
            {busy ? "Saving…" : "Continue to Horos"}
          </button>
        </form>
      </div>
    </div>
  );
}
