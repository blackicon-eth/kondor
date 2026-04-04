"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import ky from "ky";

type User = {
  seedAddress: string;
  ensSubdomain: string | null;
  textRecords: string;
  coinType: number;
  queryNonce: number;
  lastQueryAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type UserContextType = {
  user: User | null;
  loading: boolean;
  refetch: () => Promise<void>;
  completedOnboarding: boolean;
  completeOnboarding: () => void;
};

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  refetch: async () => {},
  completedOnboarding: false,
  completeOnboarding: () => {},
});

const ONBOARDING_KEY = "kondor:onboarding";

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user: privyUser, getAccessToken } = usePrivy();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [completedOnboarding, setCompletedOnboarding] = useState(() => {
    if (typeof window === "undefined") return false;
    const value = localStorage.getItem(ONBOARDING_KEY);
    if (value === null) {
      localStorage.setItem(ONBOARDING_KEY, "false");
      return false;
    }
    return value === "true";
  });

  // Complete onboarding and set the state to true
  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setCompletedOnboarding(true);
  }, []);

  // Fetch user from the database if authenticated and privy user is ready
  const fetchUser = useCallback(async () => {
    if (!authenticated || !privyUser) {
      setUser(null);
      setLoading(false);
      return;
    }

    const wallet = privyUser.linkedAccounts.find(
      (a) => a.type === "wallet" && a.walletClientType === "privy"
    );
    if (!wallet || !("address" in wallet)) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const token = await getAccessToken();
      const data = await ky
        .get("/api/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-seed-address": wallet.address,
          },
        })
        .json<User>();
      setUser(data);
    } catch (e) {
      console.error("[user-context] Failed to fetch user:", e);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [authenticated, privyUser, getAccessToken]);

  // Fetch user when privy is ready
  useEffect(() => {
    if (ready) {
      fetchUser();
    }
  }, [ready, fetchUser]);

  return (
    <UserContext.Provider
      value={{ user, loading, refetch: fetchUser, completedOnboarding, completeOnboarding }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
