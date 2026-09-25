import { keccak256, recoverMessageAddress, toBytes, isAddressEqual, type Hex } from "viem";
import type { Ctx } from "../context.js";
import type { InvoiceRow } from "../db/rows.js";
import { HttpError } from "../errors.js";
import { enqueueChainJob } from "./chainJobs.js";

export const MAX_RESPONSE_CHARS = 1_000;

/** The exact text a client signs to dispute or to resolve. Signing binds the response to the invoice. */
export function disputeMessage(invoiceHash: string, text: string): string {
  return `Horos dispute\nInvoice: ${invoiceHash}\nResponse: ${text}`;
}
export function resolveMessage(invoiceHash: string): string {
  return `Horos resolve dispute\nInvoice: ${invoiceHash}`;
}

/**
 * A client attaches a response to a record entry. With a signature from the wallet that acknowledged
 * the invoice, the entry becomes DISPUTED: excluded from scoring and marked onchain.
 * The text is shown next to the entry and handed to the agent only as untrusted data.
 */
export async function submitResponse(ctx: Ctx, payToken: string, text: string, signature?: Hex) {
  const clean = text.trim().slice(0, MAX_RESPONSE_CHARS);
  if (!clean) throw new HttpError(400, "Response text is required");
  const inv = (await ctx.db.query<InvoiceRow>("SELECT * FROM invoices WHERE pay_token = $1", [payToken]))[0];
  if (!inv) throw new HttpError(404, "Invoice not found");
  if (inv.ack_method !== "EIP712" || !inv.invoice_hash || !inv.ack_signer) {
    throw new HttpError(409, "Only wallet-acknowledged invoices have a record entry to respond to");
  }

  let dispute = false;
  if (signature) {
    const signer = await recoverMessageAddress({ message: disputeMessage(inv.invoice_hash, clean), signature }).catch(() => null);
    if (!signer || !isAddressEqual(signer, inv.ack_signer as Hex)) throw new HttpError(400, "Signature must come from the wallet that acknowledged this invoice");
    dispute = true;
  }

  return ctx.db.tx(async (q) => {
    const rows = await q.query<{ disputed: boolean }>(
      `UPDATE record_entries SET response_text = $2, response_signer = $3, disputed = disputed OR $4 WHERE invoice_hash = $1 RETURNING disputed`,
      [inv.invoice_hash, clean, dispute ? inv.ack_signer : null, dispute],
    );
    if (!rows[0]) throw new HttpError(409, "Record entry not found");
    if (dispute) {
      await q.query("UPDATE invoices SET status = 'DISPUTED', updated_at = now() WHERE id = $1 AND status NOT IN ('CANCELLED','DISPUTED')", [inv.id]);
      await enqueueChainJob(q, "RECORD_DISPUTE", `dispute:${inv.invoice_hash}`, {
        invoiceHash: inv.invoice_hash,
        responseHash: keccak256(toBytes(disputeMessage(inv.invoice_hash!, clean))),
      });
    }
    return { disputed: rows[0].disputed, response: clean };
  });
}

/** Only the client who disputed can resolve (signed). The response stays attached. */
export async function resolveDispute(ctx: Ctx, payToken: string, signature: Hex) {
  const inv = (await ctx.db.query<InvoiceRow>("SELECT * FROM invoices WHERE pay_token = $1", [payToken]))[0];
  if (!inv?.invoice_hash || !inv.ack_signer) throw new HttpError(404, "Invoice not found");
  const signer = await recoverMessageAddress({ message: resolveMessage(inv.invoice_hash), signature }).catch(() => null);
  if (!signer || !isAddressEqual(signer, inv.ack_signer as Hex)) throw new HttpError(400, "Signature must come from the acknowledging wallet");
  return ctx.db.tx(async (q) => {
    const invoiceHash = inv.invoice_hash!;
    const rows = await q.query("UPDATE record_entries SET disputed = FALSE WHERE invoice_hash = $1 AND disputed RETURNING invoice_hash", [invoiceHash]);
    if (!rows[0]) throw new HttpError(409, "Entry is not disputed");
    const next = inv.paid_at ? "PAID" : inv.due_date && new Date(inv.due_date) < ctx.now() ? "OVERDUE" : "ACKNOWLEDGED";
    await q.query("UPDATE invoices SET status = $2, updated_at = now() WHERE id = $1 AND status = 'DISPUTED'", [inv.id, next]);
    await enqueueChainJob(q, "RESOLVE_DISPUTE", `resolve:${inv.invoice_hash}:${Date.now()}`, { invoiceHash: inv.invoice_hash });
    return { resolved: true };
  });
}
