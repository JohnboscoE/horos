import type { AppConfig } from "../env.js";
import { HttpError } from "../errors.js";

/**
 * Reads a Privy user's linked accounts from Privy's server API. These are *verified* by Privy (email
 * ownership, wallet signature), unlike anything the browser reports. Needs the app secret.
 */
export interface VerifiedAccounts {
  emails: string[];
  wallets: string[];
}

export interface PrivyUserLookup {
  linkedAccounts(privyUserId: string): Promise<VerifiedAccounts>;
}

interface LinkedAccount {
  type: string;
  address?: string;
  email?: string;
  chain_type?: string;
}

export class PrivyRestLookup implements PrivyUserLookup {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async linkedAccounts(privyUserId: string): Promise<VerifiedAccounts> {
    const res = await this.fetchImpl(`https://auth.privy.io/api/v1/users/${encodeURIComponent(privyUserId)}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${this.appId}:${this.appSecret}`).toString("base64")}`,
        "privy-app-id": this.appId,
      },
    });
    if (!res.ok) throw new HttpError(502, `Privy user lookup failed (${res.status})`);
    const user = (await res.json()) as { linked_accounts?: LinkedAccount[] };
    return fromLinkedAccounts(user.linked_accounts ?? []);
  }
}

export function fromLinkedAccounts(accounts: LinkedAccount[]): VerifiedAccounts {
  const emails = new Set<string>();
  const wallets = new Set<string>();
  for (const a of accounts) {
    if (a.type === "email" && a.address) emails.add(a.address.toLowerCase());
    if (a.type === "google_oauth" && a.email) emails.add(a.email.toLowerCase());
    if (a.type === "wallet" && a.address && (a.chain_type ?? "ethereum") === "ethereum") wallets.add(a.address.toLowerCase());
  }
  return { emails: [...emails], wallets: [...wallets] };
}

export function privyLookupFromConfig(cfg: AppConfig): PrivyUserLookup | null {
  return cfg.privy?.appSecret ? new PrivyRestLookup(cfg.privy.appId, cfg.privy.appSecret) : null;
}
