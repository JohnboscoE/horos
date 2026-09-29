import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { api, auth as session, clientAuth } from "@/api";

/**
 * Sign-in. With VITE_PRIVY_APP_ID set, people sign in with Privy (email, Google or wallet) and the
 * Privy session is exchanged for a Horos session:
 *   freelancer → POST /api/auth/privy         (creates the freelancer account on first login)
 *   client     → POST /api/client/auth/privy  (identities read from Privy's server; never creates a freelancer)
 * The chosen role is remembered so a reload never turns a client into a freelancer.
 * Without Privy, the dev fallback (email signup / pasted token; wallet sign-in for clients) is used.
 */

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
const ROLE_KEY = "horos_privy_role";
type Role = "freelancer" | "client";
const getRole = (): Role => (localStorage.getItem(ROLE_KEY) === "client" ? "client" : "freelancer");

interface AuthApi {
  mode: "privy" | "dev";
  /** Opens Privy's login (privy mode). No-op in dev mode, where the signup forms are used. */
  startSignIn: (role?: Role) => void;
  signOut: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

const Ctx = createContext<AuthApi>({ mode: "dev", startSignIn: () => {}, signOut: async () => session.clear(), busy: false, error: null });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <DevAuth>{children}</DevAuth>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: { theme: "dark", accentColor: "#00C2A8", landingHeader: "Sign in to Horos", showWalletLoginFirst: false },
        // Horos gives each freelancer a Circle wallet; Privy only handles identity.
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
      }}
    >
      <PrivyAuth>{children}</PrivyAuth>
    </PrivyProvider>
  );
}

function DevAuth({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const signOut = useCallback(async () => {
    session.clear();
    clientAuth.clear();
    nav("/");
  }, [nav]);
  return <Ctx.Provider value={{ mode: "dev", startSignIn: () => {}, signOut, busy: false, error: null }}>{children}</Ctx.Provider>;
}

function PrivyAuth({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exchanging = useRef(false);

  // Privy session present but no Horos session for the chosen role → exchange it.
  useEffect(() => {
    const role = getRole();
    const hasSession = role === "client" ? clientAuth.get() : session.get();
    if (!ready || !authenticated || hasSession || exchanging.current) return;
    exchanging.current = true;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        const privyToken = await getAccessToken();
        if (!privyToken) throw new Error("Privy session expired, please sign in again");
        const base = import.meta.env.VITE_API_URL ?? "";
        if (role === "client") {
          // Identities are read server-side from Privy; nothing from the browser is trusted.
          const res = await fetch(`${base}/api/client/auth/privy`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${privyToken}` }, body: "{}" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Sign-in failed");
          clientAuth.set(data.token);
          nav("/client/dashboard");
          return;
        }
        const hints = {
          name: user?.google?.name ?? undefined,
          email: user?.email?.address ?? user?.google?.email ?? undefined,
          wallet: user?.wallet?.address ?? undefined,
        };
        const res = await fetch(`${base}/api/auth/privy`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${privyToken}` },
          body: JSON.stringify({ hints }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Sign-in failed");
        session.set(data.token);
        nav(data.needsOnboarding ? "/onboarding" : "/dashboard");
      } catch (e) {
        setError((e as Error).message);
        await logout().catch(() => {});
      } finally {
        exchanging.current = false;
        setBusy(false);
      }
    })();
  }, [ready, authenticated, user, getAccessToken, logout, nav]);

  const startSignIn = useCallback(
    (role: Role = "freelancer") => {
      setError(null);
      localStorage.setItem(ROLE_KEY, role);
      if (role === "client" && clientAuth.get()) return nav("/client/dashboard");
      if (role === "freelancer" && session.get()) return nav("/dashboard");
      // Already signed in to Privy under the other role: log out first so the new role takes effect.
      if (authenticated) void logout().then(() => login());
      else login();
    },
    [authenticated, login, logout, nav],
  );

  const signOut = useCallback(async () => {
    session.clear();
    clientAuth.clear();
    localStorage.removeItem(ROLE_KEY);
    await logout().catch(() => {});
    nav("/");
  }, [logout, nav]);

  return <Ctx.Provider value={{ mode: "privy", startSignIn, signOut, busy, error }}>{children}</Ctx.Provider>;
}

/** Loads /api/me and sends users who haven't finished onboarding to /onboarding. */
export function useOnboardingGuard() {
  const nav = useNavigate();
  useEffect(() => {
    if (!session.get()) return;
    api("/api/me")
      .then((me) => {
        if (me.needsOnboarding) nav("/onboarding", { replace: true });
      })
      .catch(() => {});
  }, [nav]);
}
