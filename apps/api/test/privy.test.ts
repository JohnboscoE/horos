import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import { loadConfig } from "../src/env.js";
import { buildContext } from "../src/bootstrap.js";
import { createApp } from "../src/app.js";
import { defaultName } from "../src/services/freelancers.js";
import { resetPrivyKeyCache } from "../src/services/privyAuth.js";

const APP_ID = "test-privy-app";
let app: ReturnType<typeof createApp>;
let sign: (sub: string, opts?: { aud?: string; iss?: string; expSeconds?: number }) => Promise<string>;
let otherKeySign: (sub: string) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const other = await generateKeyPair("ES256");
  const pem = await exportSPKI(publicKey);
  const token = (key: Parameters<SignJWT["sign"]>[0], sub: string, o: { aud?: string; iss?: string; expSeconds?: number } = {}) =>
    new SignJWT({ sid: "session" })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(sub)
      .setIssuer(o.iss ?? "privy.io")
      .setAudience(o.aud ?? APP_ID)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (o.expSeconds ?? 3600))
      .sign(key as never);
  sign = (sub, o) => token(privateKey, sub, o);
  otherKeySign = (sub) => token(other.privateKey, sub);

  resetPrivyKeyCache();
  const cfg = loadConfig({
    NETWORK: "testnet",
    MOCK_CIRCLE: "true",
    MOCK_AGENT: "true",
    PRIVY_APP_ID: APP_ID,
    PRIVY_VERIFICATION_KEY: pem.replace(/\n/g, "\\n"), // as it would sit on one line in .env
  } as NodeJS.ProcessEnv);
  const ctx = await buildContext(cfg, { memoryDb: true });
  app = createApp(ctx);
}, 60_000);

const login = (token: string, hints: object = {}) =>
  request(app).post("/api/auth/privy").set("authorization", `Bearer ${token}`).send({ hints });

describe("Privy login + onboarding", () => {
  it("first login creates the account with a suggested name and asks for onboarding", async () => {
    const r = await login(await sign("did:privy:ada"), { email: "ada.lovelace+work@example.com" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: true, needsOnboarding: true, suggestedName: "Ada Lovelace" });

    const me = await request(app).get("/api/me").set("authorization", `Bearer ${r.body.token}`);
    expect(me.body.needsOnboarding).toBe(true);
    expect(me.body.freelancer.main_wallet_address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("onboarding sets the chosen name; later logins reuse the same account", async () => {
    const first = await login(await sign("did:privy:ada"));
    expect(first.status).toBe(200);
    const upd = await request(app).put("/api/me/profile").set("authorization", `Bearer ${first.body.token}`).send({ name: "  Ada   L. Studio " });
    expect(upd.body.freelancer.name).toBe("Ada L. Studio");
    expect(upd.body.needsOnboarding).toBe(false);

    const again = await login(await sign("did:privy:ada"));
    expect(again.body).toMatchObject({ created: false, needsOnboarding: false, freelancerId: first.body.freelancerId, suggestedName: "Ada L. Studio" });
  });

  it("the name can be changed again later, with validation", async () => {
    const s = await login(await sign("did:privy:ada"));
    const bad = await request(app).put("/api/me/profile").set("authorization", `Bearer ${s.body.token}`).send({ name: "   " });
    expect(bad.status).toBe(400);
    const ok = await request(app).put("/api/me/profile").set("authorization", `Bearer ${s.body.token}`).send({ name: "Ada Lovelace" });
    expect(ok.body.freelancer.name).toBe("Ada Lovelace");
  });

  it("concurrent first logins create exactly one account", async () => {
    const t = await sign("did:privy:bob");
    const rs = await Promise.all([login(t, { wallet: "0x1234567890abcdef1234567890abcdef12345678" }), login(t), login(t)]);
    expect(new Set(rs.map((r) => r.body.freelancerId)).size).toBe(1);
    expect(rs.filter((r) => r.body.created).length).toBe(1);
  });

  it("rejects bad tokens", async () => {
    expect((await login("not-a-jwt")).status).toBe(401);
    expect((await login(await otherKeySign("did:privy:eve"))).status).toBe(401); // wrong signing key
    expect((await login(await sign("did:privy:eve", { aud: "another-app" }))).status).toBe(401);
    expect((await login(await sign("did:privy:eve", { iss: "evil.io" }))).status).toBe(401);
    expect((await login(await sign("did:privy:eve", { expSeconds: -60 }))).status).toBe(401); // expired
    expect((await login(await sign("not-a-privy-did"))).status).toBe(401);
    expect((await request(app).post("/api/auth/privy").send({})).status).toBe(401);
  });
});

describe("defaultName", () => {
  it("prefers provider name, then email, then wallet", () => {
    expect(defaultName({ name: "Grace Hopper", email: "x@y.z" })).toBe("Grace Hopper");
    expect(defaultName({ email: "john_bosco-amaobi@gmail.com" })).toBe("John Bosco Amaobi");
    expect(defaultName({ email: "12345@numbers.com", wallet: "0xAbCdEf0000000000000000000000000000001234" })).toBe("Freelancer 0xAbCd…1234");
    expect(defaultName({})).toBe("Freelancer");
  });
});
