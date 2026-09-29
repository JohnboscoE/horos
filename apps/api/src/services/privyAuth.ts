import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey } from "jose";

type KeyLike = Awaited<ReturnType<typeof importSPKI>>;
import type { AppConfig } from "../env.js";
import { HttpError } from "../errors.js";

/**
 * Verifies a Privy access token (ES256 JWT) without calling Privy: issuer "privy.io", audience = our
 * app id, subject = the Privy user id (did:privy:…). The key is the dashboard verification key if set,
 * otherwise Privy's JWKS for the app (cached by jose).
 */
let cachedKey: { appId: string; key: KeyLike | JWTVerifyGetKey } | null = null;

async function key(cfg: NonNullable<AppConfig["privy"]>): Promise<KeyLike | JWTVerifyGetKey> {
  if (cachedKey?.appId === cfg.appId) return cachedKey.key;
  const k = cfg.verificationKey ? await importSPKI(cfg.verificationKey, "ES256") : createRemoteJWKSet(new URL(cfg.jwksUrl));
  cachedKey = { appId: cfg.appId, key: k };
  return k;
}

export async function verifyPrivyToken(cfg: AppConfig, token: string): Promise<{ privyUserId: string }> {
  if (!cfg.privy) throw new HttpError(404, "Privy login is not enabled");
  try {
    const { payload } = await jwtVerify(token, (await key(cfg.privy)) as never, {
      issuer: "privy.io",
      audience: cfg.privy.appId,
      algorithms: ["ES256"],
    });
    if (!payload.sub?.startsWith("did:privy:")) throw new Error("unexpected subject");
    return { privyUserId: payload.sub };
  } catch {
    throw new HttpError(401, "Invalid or expired Privy session");
  }
}

/** Test hook: forget the cached key (tests rotate keys). */
export function resetPrivyKeyCache() {
  cachedKey = null;
}
