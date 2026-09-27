import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { api, auth as session } from "@/api";

/**
 * Sign-in. With VITE_PRIVY_APP_ID set, freelancers sign in with Privy (email, Google or wallet) and the
 * Privy session is exchanged for a Horos session (POST /api/auth/privy). Without it, the dev fallback
 * (email signup / pasted access token) is used.
 */

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

interface AuthApi {
  mode: "privy" | "dev";
  /** Opens Privy's login (privy mode). No-op in dev mode, where the signup form is used. */
  startSignIn: () => void;
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

  // Privy session present but no Horos session → exchange (first login creates the account).
  useEffect(() => {
    if (!ready || !authenticated || session.get() || exchanging.current) return;
    exchanging.current = true;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        const privyToken = await getAccessToken();
        if (!privyToken) throw new Error("Privy session expired, please sign in again");
        const hints = {
          name: user?.google?.name ?? undefined,
          email: user?.email?.address ?? user?.google?.email ?? undefined,
          wallet: user?.wallet?.address ?? undefined,
        };
        const res = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/auth/privy`, {
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

  const startSignIn = useCallback(() => {
    setError(null);
    if (authenticated && session.get()) nav("/dashboard");
    else login();
  }, [authenticated, login, nav]);

  const signOut = useCallback(async () => {
    session.clear();
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
