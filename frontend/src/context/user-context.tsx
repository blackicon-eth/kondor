"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth";
import ky from "ky";
import { decryptPolicy, ENCRYPTION_SIGN_MESSAGE } from "@/lib/policies/encrypt";
import type { PolicyJson } from "@/lib/policies/utils";

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
  userPolicies: PolicyJson | null;
  userZkAddress: string | null;
  userForwardTo: string | null;
};

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  refetch: async () => {},
  completedOnboarding: false,
  completeOnboarding: () => {},
  userPolicies: null,
  userZkAddress: null,
  userForwardTo: null,
});

const ONBOARDING_KEY = "kondor:onboarding";

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user: privyUser, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [cachedSignature, setCachedSignature] = useState<string | null>(null);
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
      // loading stays true until signature is cached
    } catch (e) {
      console.error("[user-context] Failed to fetch user:", e);
      setUser(null);
      setLoading(false);
    }
  }, [authenticated, privyUser, getAccessToken]);

  // Fetch user when privy is ready
  useEffect(() => {
    const asyncFetchUser = async () => {
      if (ready) {
        await fetchUser();
      }
    };
    asyncFetchUser();
  }, [ready, fetchUser]);

  // Sign once to derive the encryption key when wallet is available
  useEffect(() => {
    if (!authenticated || cachedSignature) return;
    const wallet = wallets.find((w) => w.walletClientType === "privy");
    if (!wallet) return;

    wallet
      .sign(ENCRYPTION_SIGN_MESSAGE)
      .then((sig) => {
        setCachedSignature(sig);
        setLoading(false);
      })
      .catch((e) => {
        console.error("[user-context] Failed to sign for key derivation:", e);
        setLoading(false);
      });
  }, [authenticated, wallets, cachedSignature]);

  // If not authenticated, loading is done after user fetch (no signature needed)
  useEffect(() => {
    if (ready && !authenticated) {
      setTimeout(() => {
        setLoading(false);
      }, 0);
    }
  }, [ready, authenticated]);

  // Decrypt user policies whenever user data or signature changes
  const { userPolicies, userZkAddress, userForwardTo } = useMemo<{
    userPolicies: PolicyJson | null;
    userZkAddress: string | null;
    userForwardTo: string | null;
  }>(() => {
    if (!user || !cachedSignature)
      return { userPolicies: null, userZkAddress: null, userForwardTo: null };

    try {
      const textRecords = JSON.parse(user.textRecords || "{}");
      const policyStr = textRecords["kondor-policy"];
      if (!policyStr) return { userPolicies: null, userZkAddress: null, userForwardTo: null };

      const encrypted = JSON.parse(policyStr);
      const crePublicKey = process.env.NEXT_PUBLIC_CRE_PUBLIC_KEY;
      if (!crePublicKey) return { userPolicies: null, userZkAddress: null, userForwardTo: null };

      const decryptedTokens = decryptPolicy(encrypted.tokens, cachedSignature, crePublicKey);

      const railgunAddress = textRecords.railgunAddress;

      return {
        userPolicies: {
          destinationChain: encrypted.destinationChain,
          isRailgun: encrypted.isRailgun,
          isOfframp: encrypted.isOfframp,
          forwardTo: encrypted.forwardTo,
          tokens: decryptedTokens,
        },
        userZkAddress: railgunAddress,
        userForwardTo: encrypted.forwardTo || null,
      };
    } catch (e) {
      console.error("[user-context] Failed to decrypt policies:", e);
      return { userPolicies: null, userZkAddress: null, userForwardTo: null };
    }
  }, [user, cachedSignature]);

  return (
    <UserContext.Provider
      value={{
        user,
        loading,
        refetch: fetchUser,
        completedOnboarding,
        completeOnboarding,
        userPolicies,
        userZkAddress,
        userForwardTo,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
