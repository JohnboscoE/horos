import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Wallet } from "lucide-react";
import { api, clientApi, clientAuth } from "@/api";
import { useAuth } from "@/auth";
import { ErrorNote } from "@/ui/bits";
import { connectAccount } from "@/wallet";

/**
 * Client sign-in. Two verified paths:
 *  - Wallet: sign a one-time message with the wallet you sign invoices with (no gas, no transaction).
 *  - Email via Privy: the email is verified by Privy and read by our server, never taken from the browser.
 */
export function ClientSignIn() {
  const nav = useNavigate();
  const { mode, startSignIn, busy: privyBusy, error: privyError } = useAuth();
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (clientAuth.get()) nav("/client/dashboard", { replace: true });
    api("/api/health")
      .then((h) => setEmailEnabled(mode === "privy" && !!h.clientEmailSignIn))
      .catch(() => {});
  }, [nav, mode]);

  const walletSignIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { wallet, account } = await connectAccount();
      const { nonce, message } = await clientApi("/api/client/auth/nonce", { body: { address: account } });
      const signature = await wallet.signMessage({ account, message });
      const r = await clientApi("/api/client/auth/wallet", { body: { address: account, nonce, signature } });
      clientAuth.set(r.token);
      nav("/client/dashboard");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-grain flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-3 w-3 rounded-sm bg-primary" /> Horos
        </Link>

        <div className="card animate-fade-slide-in-1 space-y-5">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-primary">For clients</div>
            <h1 className="mt-2 font-instrument-serif text-3xl text-white">All your invoices in one place</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              See every invoice freelancers have sent you, what's due, what you've paid, and your organization's payment record.
            </p>
          </div>

          <button className="btn w-full" onClick={walletSignIn} disabled={busy}>
            <Wallet className="h-4 w-4" aria-hidden="true" />
            {busy ? "Check your wallet…" : "Sign in with your wallet"}
          </button>
          <p className="-mt-2 text-xs text-muted-foreground">
            Use the wallet you sign invoices with. You'll sign a one-time message; it's free and sends no transaction.
          </p>

          {emailEnabled && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
              <button className="btn-ghost w-full" onClick={() => startSignIn("client")} disabled={privyBusy}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                {privyBusy ? "Signing you in…" : "Continue with email"}
              </button>
              <p className="-mt-2 text-xs text-muted-foreground">Shows invoices freelancers sent to your email address.</p>
            </>
          )}

          <ErrorNote error={err ?? privyError} />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          You'll only see invoices addressed to you: ones you signed with this wallet, or ones sent to your verified email.
          <br />
          Are you a freelancer? <Link className="text-primary" to="/#start">Sign in here</Link>.
        </p>
      </div>
    </div>
  );
}
