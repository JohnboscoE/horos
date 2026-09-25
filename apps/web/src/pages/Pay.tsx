import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Address, Hex } from "viem";
import { api, date, pct } from "../api";
import { Badge, ErrorNote } from "../ui/bits";
import { connect, payToken } from "../wallet";
import { PayByCard } from "../ui/PayByCard";

/** Public client page: review, acknowledge (EIP-712), pay, confirm refunds, respond. */
export function Pay() {
  const { token } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [refundAddr, setRefundAddr] = useState<Record<string, string>>({});
  const [emailName, setEmailName] = useState("");
  const [payMethod, setPayMethod] = useState<"wallet" | "card">("wallet");

  const load = () => api(`/api/pay/${token}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [token]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    setNote(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!d) return <Shell><ErrorNote error={err ?? null} /></Shell>;
  const inv = d.invoice;
  const minor = (s: string) => {
    const [w, f = ""] = s.split(".");
    return BigInt(w!) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  };

  const acknowledge = () =>
    run("ack", async () => {
      const { wallet, account } = await connect(d.chain.chainId, d.chain.explorer);
      const td = d.typedData;
      const message = { ...td.message, amount: BigInt(td.message.amount), dueDate: BigInt(td.message.dueDate) };
      const signature = await wallet.signTypedData({ account, domain: td.domain, types: td.types, primaryType: "Invoice", message });
      await api(`/api/pay/${token}/ack`, { body: { signature, signer: account } });
      setNote("Acknowledged. Your on-time payment will count toward your organization's payment record.");
    });

  const payNow = () =>
    run("pay", async () => {
      const { wallet, account } = await connect(d.chain.chainId, d.chain.explorer);
      const hash = await payToken(wallet, account, inv.tokenAddress as Address, inv.depositAddress as Address, minor(inv.outstanding), d.chain.chainId, d.chain.explorer);
      setNote(`Payment sent: ${hash}. It will show here within a few seconds.`);
    });

  const respond = (signed: boolean) =>
    run("respond", async () => {
      let signature: Hex | undefined;
      if (signed) {
        const { wallet, account } = await connect(d.chain.chainId, d.chain.explorer);
        signature = await wallet.signMessage({ account, message: d.disputeMessageTemplate.replace("<your response>", response.trim().slice(0, 1000)) });
      }
      await api(`/api/pay/${token}/response`, { body: { text: response, signature } });
      setResponse("");
    });

  return (
    <Shell>
      <div className="space-y-6">
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs uppercase tracking-wide text-muted">Invoice from {inv.freelancer} to {inv.client?.display_name}</div>
            <Badge>{inv.status}</Badge>
          </div>
          <div className="text-4xl font-semibold">{inv.amount} <span className="text-lg text-muted">{inv.currency}</span></div>
          {inv.description && <p className="text-sm text-muted">{inv.description}</p>}
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div><div className="label">Due</div>{date(inv.dueDate)}</div>
            <div><div className="label">Terms</div>net {inv.terms?.netDays} · deposit {pct(inv.terms?.depositBps)}</div>
            <div><div className="label">Pay now</div><span className="text-accent">{inv.amountDueNow}</span>{inv.amountDueNow !== inv.amount && <span className="text-xs text-muted"> (discount applied)</span>}</div>
          </div>
          {inv.terms?.earlyPayOffer && (
            <div className="rounded-lg border border-accent/40 bg-accent-dim px-3 py-2 text-sm">
              Early-payment offer: {pct(inv.terms.earlyPayOffer.discount_bps)} off if paid by {date(inv.terms.earlyPayOffer.expires_at)}.
            </div>
          )}
          <div className="text-sm">Paid so far {inv.paid} · outstanding <span className="font-semibold">{inv.outstanding}</span></div>
        </div>

        <ErrorNote error={err} />
        {note && <div className="rounded-lg border border-accent/40 bg-accent-dim px-3 py-2 text-sm">{note}</div>}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-3">
            <h2 className="font-semibold">1 · Acknowledge</h2>
            {inv.acknowledged ? (
              <p className="text-sm text-muted">Acknowledged {inv.ackMethod === "EIP712" ? <>by <span className="mono">{inv.ackSigner}</span></> : "by email (not counted in the shared record)"}.</p>
            ) : (
              <>
                <p className="text-sm text-muted">Sign the invoice and its terms with your wallet. Signed invoices that you pay on time build your organization's credential as a good payer.</p>
                <button className="btn w-full" disabled={!!busy} onClick={acknowledge}>{busy === "ack" ? "Waiting for wallet…" : "Sign with wallet"}</button>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">No wallet? Acknowledge by name</summary>
                  <div className="mt-2 flex gap-2">
                    <input className="input" placeholder="Your name" value={emailName} onChange={(e) => setEmailName(e.target.value)} />
                    <button className="btn-ghost" disabled={!emailName || !!busy} onClick={() => run("email", () => api(`/api/pay/${token}/ack-email`, { body: { name: emailName } }))}>Confirm</button>
                  </div>
                </details>
              </>
            )}
          </div>

          <div className="card space-y-3">
            <h2 className="font-semibold">2 · Pay</h2>
            {d.onramp?.mode !== "off" && (
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-ink p-1 text-sm">
                {(["wallet", "card"] as const).map((m) => (
                  <button
                    key={m}
                    className={`rounded-md px-3 py-1.5 ${payMethod === m ? "bg-panel text-accent" : "text-muted hover:text-fg"}`}
                    onClick={() => setPayMethod(m)}
                  >
                    {m === "wallet" ? "Crypto wallet" : "Card or bank"}
                  </button>
                ))}
              </div>
            )}
            {inv.outstanding === "0.00" ? (
              <p className="text-sm text-accent">Nothing outstanding. Thank you!</p>
            ) : payMethod === "card" && d.onramp?.mode !== "off" ? (
              <PayByCard
                token={token!}
                mode={d.onramp.mode}
                outstanding={inv.outstanding}
                currency={inv.currency}
                depositAddress={inv.depositAddress}
                onDone={load}
              />
            ) : (
              <>
                <p className="text-sm text-muted">Send {inv.currency} on {d.chain.network === "testnet" ? "Arc Testnet" : "Arc"} to this invoice's own deposit address:</p>
                <code className="mono block rounded bg-ink px-2 py-2">{inv.depositAddress}</code>
                <button className="btn w-full" disabled={!!busy} onClick={payNow}>
                  {busy === "pay" ? "Confirm in wallet…" : `Pay ${inv.outstanding} ${inv.currency}`}
                </button>
                {d.chain.network === "testnet" && <p className="text-xs text-muted">Test USDC: faucet.circle.com (Arc Testnet).</p>}
              </>
            )}
          </div>
        </div>

        {d.refunds.length > 0 && (
          <div className="card space-y-3">
            <h2 className="font-semibold">Refunds</h2>
            {d.refunds.map((r: any) => (
              <div key={r.id} className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">You overpaid by <b>{r.amount}</b> <Badge>{r.status}</Badge></div>
                {r.status === "AWAITING_PAYER" && (
                  <>
                    <p className="text-muted">Where should we send it? We never refund automatically, because the sending address may belong to an exchange.{r.suggestedAddress && <> The payment came from <span className="mono">{r.suggestedAddress}</span>.</>}</p>
                    <div className="flex flex-wrap gap-2">
                      <input className="input mono flex-1" placeholder="0x…" value={refundAddr[r.id] ?? ""} onChange={(e) => setRefundAddr({ ...refundAddr, [r.id]: e.target.value })} />
                      <button className="btn" disabled={!!busy} onClick={() => run("refund", () => api(`/api/refunds/${r.confirmToken}/confirm`, { body: { address: refundAddr[r.id] } }))}>Confirm address</button>
                    </div>
                  </>
                )}
                {r.toAddress && <div className="text-muted">→ <span className="mono">{r.toAddress}</span> {r.txUrl && <a className="text-accent" href={r.txUrl} target="_blank" rel="noreferrer">tx</a>}</div>}
              </div>
            ))}
          </div>
        )}

        {d.messages.length > 0 && (
          <div className="card space-y-2">
            <h2 className="font-semibold">Messages</h2>
            {d.messages.map((m: any, i: number) => (
              <div key={i} className="text-sm"><span className="text-xs text-muted">{date(m.created_at)} · </span>{m.body}</div>
            ))}
          </div>
        )}

        {inv.invoiceHash && inv.ackMethod === "EIP712" && (
          <div className="card space-y-3">
            <h2 className="font-semibold">Your response</h2>
            <p className="text-sm text-muted">You can attach a response to this record entry, and it is always shown next to it. Signing with the wallet that acknowledged the invoice marks the entry as disputed, which removes it from scoring until you resolve it.</p>
            {inv.response && <div className="rounded bg-ink px-3 py-2 text-sm">“{inv.response}” {inv.disputed && <Badge>DISPUTED</Badge>}</div>}
            <textarea className="input" rows={3} maxLength={1000} value={response} onChange={(e) => setResponse(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={!response || !!busy} onClick={() => respond(false)}>Attach response</button>
              <button className="btn" disabled={!response || !!busy} onClick={() => respond(true)}>Sign & dispute</button>
              {inv.disputed && (
                <button
                  className="btn-ghost"
                  disabled={!!busy}
                  onClick={() =>
                    run("resolve", async () => {
                      const { wallet, account } = await connect(d.chain.chainId, d.chain.explorer);
                      const signature = await wallet.signMessage({ account, message: d.resolveMessage });
                      await api(`/api/pay/${token}/resolve`, { body: { signature } });
                    })
                  }
                >
                  Resolve dispute
                </button>
              )}
            </div>
          </div>
        )}
        <p className="text-xs text-muted">{d.disclaimer}</p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-grain min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 font-semibold">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" /> Horos
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
