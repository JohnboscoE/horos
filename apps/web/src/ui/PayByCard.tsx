import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const BASE = import.meta.env.VITE_API_URL ?? "";

type Props = {
  token: string;
  mode: "live" | "preview";
  outstanding: string;
  currency: string;
  depositAddress: string;
  onDone: () => void;
};

/**
 * Pay by card / Apple Pay / Google Pay / bank via Arc App Kit Onramp.
 * USDC is delivered straight to this invoice's deposit address (fixed by the server), so the payment
 * is detected and reconciled exactly like a wallet payment.
 */
export function PayByCard(props: Props) {
  return props.mode === "live" ? <LiveWidget {...props} /> : <PreviewWidget {...props} />;
}

function LiveWidget({ token, depositAddress, onDone }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "open" | "settled" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const widget = useRef<{ unmount?: () => void; destroy?: () => void } | null>(null);

  useEffect(() => () => {
    widget.current?.unmount?.();
    widget.current?.destroy?.();
  }, []);

  const start = async () => {
    setState("loading");
    setMsg(null);
    try {
      const { AppKit } = (await import("@circle-fin/app-kit")) as any;
      const kit = new AppKit();
      const session = await kit.onramp.fetchSession({
        url: `${BASE}/api/pay/${token}/onramp-session`,
        // Informational only; the server ignores these and uses the invoice's own deposit address.
        body: { appUserId: `pay:${token.slice(0, 8)}`, destinationAddress: depositAddress },
      });
      widget.current = kit.onramp.mountIframe({
        session,
        container: ref.current!,
        onDepositSettled: () => {
          setState("settled");
          setMsg("Purchase settled. Waiting for the USDC to arrive on Arc; this page updates automatically.");
          onDone();
        },
        onDepositNotCompleted: ({ code }: { code?: string }) => {
          setState("error");
          setMsg(`The purchase didn't complete${code ? ` (${code})` : ""}. You haven't been charged for USDC that wasn't delivered.`);
        },
      });
      setState("open");
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      {state === "idle" || state === "error" ? (
        <button className="btn w-full" onClick={start}>Pay with card or bank</button>
      ) : state === "loading" ? (
        <div className="text-sm text-muted">Opening secure checkout…</div>
      ) : null}
      {msg && <div className={`text-sm ${state === "error" ? "text-bad" : "text-accent"}`}>{msg}</div>}
      <div ref={ref} className={state === "open" || state === "settled" ? "min-h-[560px] overflow-hidden rounded-lg border border-line" : ""} />
    </div>
  );
}

const METHODS = ["Debit card", "Apple Pay", "Google Pay", "Bank transfer"] as const;
const STEPS = ["Verifying identity", "Authorizing payment", "Buying USDC", "Delivering to invoice on Arc"] as const;

/** Local stand-in for Circle's widget: same flow, simulated purchase. Never charges anything. */
function PreviewWidget({ token, outstanding, currency, depositAddress, onDone }: Props) {
  const [amount, setAmount] = useState(outstanding);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("Debit card");
  const [step, setStep] = useState(-1);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setAmount(outstanding), [outstanding]);

  const buy = async () => {
    setErr(null);
    try {
      for (let i = 0; i < STEPS.length - 1; i++) {
        setStep(i);
        await new Promise((r) => setTimeout(r, 700));
      }
      setStep(STEPS.length - 1);
      await api(`/api/dev/pay/${token}`, { body: { amount, from: "0x0000000000000000000000000000000000c1c1e0" } });
      setStep(STEPS.length);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setStep(-1);
    }
  };

  const busy = step >= 0 && step < STEPS.length;
  return (
    <div className="space-y-4 rounded-lg border border-dashed border-line p-4">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted">Checkout · Arc Onramp</span>
        <span className="rounded-full border border-warn px-2 py-0.5 text-warn">Local preview, simulated</span>
      </div>

      {step === STEPS.length ? (
        <div className="space-y-1 text-sm">
          <div className="text-accent">✓ {amount} {currency} delivered to the invoice.</div>
          <div className="text-muted">The payment was detected on the deposit address and reconciled like any other.</div>
          <button className="btn-ghost mt-2" onClick={() => setStep(-1)}>Buy again</button>
        </div>
      ) : (
        <>
          <div>
            <label className="label">You receive ({currency})</label>
            <input className="input" inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
            <div className="mt-1 text-xs text-muted">Prefilled with the outstanding amount. Change it to see partial or over-payment handling.</div>
          </div>
          <div>
            <label className="label">Pay with</label>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => setMethod(m)}
                  className={`rounded-lg border px-3 py-2 text-sm ${method === m ? "border-accent text-accent" : "border-line text-fg hover:border-muted"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted">
            Delivered to <span className="mono">{depositAddress}</span>, this invoice's own address.
          </div>
          {busy ? (
            <ol className="space-y-1 text-sm">
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? "text-accent" : i === step ? "text-fg" : "text-muted"}>
                  {i < step ? "✓" : i === step ? "…" : "·"} {s}
                </li>
              ))}
            </ol>
          ) : (
            <button className="btn w-full" onClick={buy} disabled={!amount}>
              Buy {amount || "0"} {currency} with {method.toLowerCase()}
            </button>
          )}
          {err && <div className="text-sm text-bad">{err}</div>}
        </>
      )}
    </div>
  );
}
