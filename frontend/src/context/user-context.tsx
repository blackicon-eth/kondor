"use client";

import { createContext, useContext, useEffect, useState } from "react";
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
};

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  refetch: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user: privyUser, getAccessToken } = usePrivy();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchUser() {
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
  }

  useEffect(() => {
    if (ready) {
      fetchUser();
    }
  }, [ready, authenticated]);

  return (
    <UserContext.Provider value={{ user, loading, refetch: fetchUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
