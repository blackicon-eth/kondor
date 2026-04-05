"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { MoneriumProvider } from "@monerium/sdk-react-provider";
import { useUser } from "@/context/user-context";

const LS_KEY = "kondor:monerium_token";

const ClearMoneriumContext = createContext<(() => void) | null>(null);

export function useClearMoneriumSession() {
  const fn = useContext(ClearMoneriumContext);
  if (!fn) throw new Error("useClearMoneriumSession must be used inside MoneriumWrapper");
  return fn;
}

export function MoneriumWrapper({ children }: { children: React.ReactNode }) {
  const { user } = useUser();

  const [refreshToken, setRefreshToken] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return localStorage.getItem(LS_KEY) ?? undefined;
  });

  const [mountKey, setMountKey] = useState(0);

  // Hydrate from DB once user loads (fallback when localStorage is empty)
  useEffect(() => {
    if (!user || refreshToken) return;
    try {
      const stored = user.moneriumData
        ? (JSON.parse(user.moneriumData) as { refreshToken?: string }).refreshToken
        : undefined;
      if (stored) {
        setRefreshToken(stored);
        localStorage.setItem(LS_KEY, stored);
      }
    } catch {
      // ignore malformed moneriumData
    }
  }, [user, refreshToken]);

  const handleRefreshTokenUpdate = useCallback((token: string) => {
    setRefreshToken(token);
    localStorage.setItem(LS_KEY, token);
  }, []);

  const clearStoredSession = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    setRefreshToken(undefined);
    setMountKey((k) => k + 1);
  }, []);

  return (
    <ClearMoneriumContext.Provider value={clearStoredSession}>
      <MoneriumProvider
        key={mountKey}
        clientId={process.env.NEXT_PUBLIC_MONERIUM_CLIENT_ID!}
        redirectUri={process.env.NEXT_PUBLIC_MONERIUM_REDIRECT_URI!}
        environment="sandbox"
        refreshToken={refreshToken}
        onRefreshTokenUpdate={handleRefreshTokenUpdate}
      >
        {children}
      </MoneriumProvider>
    </ClearMoneriumContext.Provider>
  );
}
