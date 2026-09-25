import type { Ctx } from "../context.js";
import type { InvoiceRow } from "../db/rows.js";
import { HttpError } from "../errors.js";
import { isOpen } from "@horos/core";

/**
 * Pay by card via Arc App Kit Onramp. The client buys USDC with card / Apple Pay / Google Pay / bank
 * transfer and Circle's widget delivers it to `destinationAddress`.
 *
 * The destination is ALWAYS the invoice's own deposit address, set here on the server. Anything the
 * browser sends is ignored. The watcher then detects the purchase like any other payment, and
 * reconciliation handles amounts that don't match exactly (provider fees → partial, extra → refund).
 */

type ServerKit = { onramp: { createSession: (input: Record<string, unknown>) => Promise<unknown> } };
let serverKit: ServerKit | null = null;

async function kit(ctx: Ctx): Promise<ServerKit> {
  if (ctx.cfg.onramp.mode !== "live") throw new HttpError(404, "Onramp is not enabled");
  if (!serverKit) {
    const mod = (await import("@circle-fin/app-kit/server")) as unknown as {
      createAppServerKit: (cfg: { onramp: { apiKey: string; referrerDomain: string } }) => ServerKit;
    };
    serverKit = mod.createAppServerKit({
      onramp: { apiKey: ctx.cfg.onramp.apiKey, referrerDomain: ctx.cfg.onramp.referrerDomain },
    });
  }
  return serverKit;
}

async function payableInvoice(ctx: Ctx, payToken: string): Promise<InvoiceRow> {
  const inv = (await ctx.db.query<InvoiceRow>("SELECT * FROM invoices WHERE pay_token = $1", [payToken]))[0];
  if (!inv || inv.status === "DRAFT") throw new HttpError(404, "Invoice not found");
  if (!isOpen(inv.status)) throw new HttpError(409, `Invoice is ${inv.status}`);
  if (inv.currency !== "USDC") throw new HttpError(409, "Card payments are available for USDC invoices");
  if (!inv.deposit_address) throw new HttpError(409, "Invoice has no deposit address");
  return inv;
}

export async function createOnrampSession(ctx: Ctx, payToken: string): Promise<unknown> {
  if (ctx.cfg.killSwitch) throw new HttpError(503, "Horos is paused (kill switch)");
  const inv = await payableInvoice(ctx, payToken);
  const k = await kit(ctx);
  return k.onramp.createSession({
    appUserId: `invoice:${inv.id}`,
    destinationAddress: inv.deposit_address,
  });
}

/** What the pay page needs to decide how to render the card option. */
export function onrampMode(ctx: Ctx & { mockChain?: unknown }): "live" | "preview" | "off" {
  if (ctx.cfg.onramp.mode === "preview" && !ctx.mockChain) return "off"; // preview needs the in-memory chain
  return ctx.cfg.onramp.mode;
}
