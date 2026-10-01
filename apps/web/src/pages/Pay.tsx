import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Address, Hex } from "viem";
import { api, date, pct } from "../api";
import { Badge, ErrorNote } from "../ui/bits";
import { connect, payToken } from "../wallet";
import { PayByCard } from "../ui/PayByCard";
import { CheckCircle2, ExternalLink, FileCheck2, Loader2 } from "lucide-react";
import { FreelancerRecordCard } from "../ui/FreelancerRecord";

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
  const [reviewed, setReviewed] = useState(false);

  // A payment we sent from this browser that isn't confirmed yet. Kept across reloads so the client
  // can't miss it and pay twice.
  const pendingKey = `horos_pending_tx:${token}`;
  const [pendingTx, setPendingTx] = useState<{ hash: string; at: number } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(pendingKey) ?? "null");
    } catch {
      return null;
    }
  });
  const savePending = (hash: string) => {
    const p = { hash, at: Date.now() };
    localStorage.setItem(pendingKey, JSON.stringify(p));
    setPendingTx(p);
  };
  const clearPending = () => {
    localStorage.removeItem(pendingKey);
    setPendingTx(null);
  };

  const load = () =>
    api(`/api/pay/${token}`)
      .then((data) => {
        setD(data);
        if (data.payments?.settled) clearPending();
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, pendingTx ? 3_000 : 8_000);
    return () => clearInterval(t);
  }, [token, !!pendingTx]);

  /** Ask the API to verify our transaction on-chain now instead of waiting for the watcher. */
  const confirmTx = async (hash: string) => {
    for (let i = 0; i < 12; i++) {
      try {
        const r = await api(`/api/pay/${token}/report-tx`, { body: { txHash: hash } });
        if (r.state !== "pending") {
          await load();
          return;
        }
      } catch (e) {
        // A real answer ("no transfer to this invoice", "transaction failed") ends the wait.
        if ((e as { status?: number }).status && (e as { status?: number }).status !== 202) {
          clearPending();
          throw e;
        }
      }
      await new Promise((r) => setTimeout(r, 2_500));
    }
  };

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
  const simulated = d.payments?.mode === "simulated";
  const settled = !!d.payments?.settled;
  const pendingStale = !!pendingTx && Date.now() - pendingTx.at > 10 * 60_000;
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
      setNote(inv.deliverableUrl ? "Signed. You've confirmed you received the work. Paying on time builds your organization's payment record." : "Signed. Paying on time builds your organization's payment record.");
    });

  const payNow = () =>
    run("pay", async () => {
      const { wallet, account } = await connect(d.chain.chainId, d.chain.explorer);
      const hash = await payToken(wallet, account, inv.tokenAddress as Address, inv.depositAddress as Address, minor(inv.outstanding), d.chain.chainId, d.chain.explorer);
      savePending(hash);
      await confirmTx(hash);
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

        {(inv.deliverableUrl || d.freelancerRecord) && (
          <div className={inv.deliverableUrl && d.freelancerRecord ? "grid gap-4 md:grid-cols-2" : ""}>
            {inv.deliverableUrl && (
              <div className="card space-y-3">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-accent" aria-hidden="true" />
                  <div className="label !mb-0">Work delivered</div>
                </div>
                <a
                  href={inv.deliverableUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="group flex items-center gap-3 rounded-lg border border-line bg-ink px-3 py-3 hover:border-accent/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold group-hover:text-accent">Open the work on {hostOf(inv.deliverableUrl)}</div>
                    <div className="truncate font-mono text-[11px] text-muted" title={inv.deliverableUrl}>{inv.deliverableUrl}</div>
                  </div>
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted group-hover:text-accent" aria-hidden="true" />
                </a>
                {inv.acknowledged && inv.ackMethod === "EIP712" ? (
                  <p className="flex items-start gap-2 text-sm text-accent">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    The client confirmed receipt of this work by signing the invoice.
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    This link is part of the invoice you sign, so it can't be swapped afterwards. Check it before you sign.
                  </p>
                )}
              </div>
            )}
            {d.freelancerRecord && <FreelancerRecordCard record={d.freelancerRecord} compact={!!inv.deliverableUrl} />}
          </div>
        )}

        <ErrorNote error={err} />
        {note && <div className="rounded-lg border border-accent/40 bg-accent-dim px-3 py-2 text-sm">{note}</div>}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-3">
            <h2 className="font-semibold">1 · Review &amp; sign</h2>
            {inv.acknowledged ? (
              <div className="space-y-2 rounded-lg border border-accent/40 bg-accent-dim p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-accent">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {inv.ackMethod === "EIP712" ? (inv.deliverableUrl ? "Work confirmed and signed" : "Signed") : "Acknowledged by name"}
                </div>
                <p className="text-muted">
                  {inv.ackMethod === "EIP712" ? (
                    <>
                      Signed by <span className="mono" title={inv.ackSigner}>{inv.ackSigner?.slice(0, 6)}…{inv.ackSigner?.slice(-4)}</span>. Paying on time now counts toward your
                      organization's payment record.
                    </>
                  ) : (
                    "Acknowledged without a wallet, so it isn't counted in the shared record."
                  )}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted">
                  {inv.deliverableUrl
                    ? "Your signature confirms you received the work and accept the invoice and its terms. It's free and sends no transaction."
                    : "Sign the invoice and its terms with your wallet. It's free and sends no transaction."}{" "}
                  Signed invoices you pay on time build your organization's record as a good payer.
                </p>
                {inv.deliverableUrl && (
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 accent-accent" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                    I've opened the delivered work and I'm satisfied with it.
                  </label>
                )}
                <button className="btn w-full" disabled={!!busy || (!!inv.deliverableUrl && !reviewed)} onClick={acknowledge}>
                  {busy === "ack" ? "Waiting for wallet…" : inv.deliverableUrl ? "Confirm work & sign" : "Sign with wallet"}
                </button>
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
            {settled ? (
              <PaidInFull last={d.payments.last} />
            ) : pendingTx ? (
              <div className="space-y-3 rounded-lg border border-accent/40 bg-accent-dim p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-accent">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Payment sent, confirming on Arc…
                </div>
                <p>
                  Your transaction was submitted.{" "}
                  <a className="text-accent underline" href={`${d.chain.explorer}/tx/${pendingTx.hash}`} target="_blank" rel="noreferrer">
                    View it on the explorer
                  </a>
                  . This usually takes a few seconds.
                </p>
                <p className="font-semibold">Please don't pay again.</p>
                <button className="btn-ghost w-full" disabled={!!busy} onClick={() => run("check", () => confirmTx(pendingTx.hash))}>
                  {busy === "check" ? "Checking…" : "Check again"}
                </button>
                {pendingStale && (
                  <button className="w-full text-xs text-muted underline" onClick={() => clearPending()}>
                    It's been a while. The transaction may have failed or been dropped; dismiss this to pay again.
                  </button>
                )}
              </div>
            ) : (
              <>
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
            ) : simulated ? (
              <>
                <div className="rounded-lg border border-warn/50 bg-warn/10 p-3 text-sm">
                  <div className="font-semibold text-warn">Demo environment: payments are simulated</div>
                  <p className="mt-1">
                    This invoice doesn't have a real wallet yet, so <b>don't send real funds</b>; they couldn't be recovered. Use the button below to
                    simulate the payment.
                  </p>
                </div>
                <button className="btn w-full" disabled={!!busy} onClick={() => run("simulate", () => api(`/api/dev/pay/${token}`, { body: { amount: inv.outstanding } }))}>
                  {busy === "simulate" ? "Simulating…" : `Simulate paying ${inv.outstanding} ${inv.currency}`}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">Send {inv.currency} on {d.chain.network === "testnet" ? "Arc Testnet" : "Arc"} to this invoice's own deposit address:</p>
                <code className="mono block break-all rounded bg-ink px-2 py-2 text-[11px]">{inv.depositAddress}</code>
                <button className="btn w-full" disabled={!!busy} onClick={payNow}>
                  {busy === "pay" ? "Confirm in wallet…" : `Pay ${inv.outstanding} ${inv.currency}`}
                </button>
                {d.chain.network === "testnet" && <p className="text-xs text-muted">Test USDC: faucet.circle.com (Arc Testnet).</p>}
              </>
            )}
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

function PaidInFull({ last }: { last: { amount: string; at: string; txUrl: string | null } | null }) {
  return (
    <div className="space-y-2 rounded-lg border border-accent/50 bg-accent-dim p-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-accent">
        <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Paid in full
      </div>
      {last && (
        <p className="text-sm">
          Last payment: {last.amount} on {date(last.at)}
          {last.txUrl && (
            <>
              {" · "}
              <a className="text-accent underline" href={last.txUrl} target="_blank" rel="noreferrer">
                receipt on the explorer
              </a>
            </>
          )}
        </p>
      )}
      <p className="text-xs text-muted">Nothing more to pay. The freelancer has been notified.</p>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the linked site";
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-grain min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" /> <span className="font-semibold">Horos</span>
          <a href="/client" className="ml-auto text-xs text-muted hover:text-accent">
            See all your invoices →
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
