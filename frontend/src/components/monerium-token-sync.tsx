"use client";

import { useEffect, useRef } from "react";
import { useAuth, useAuthContext } from "@monerium/sdk-react-provider";
import { usePrivy } from "@privy-io/react-auth";

const LS_KEY = "kondor:monerium_token";

/**
 * Invisible component rendered inside MoneriumProvider.
 * Syncs the Monerium refresh token into the users.monerium_data column (private DB column).
 */
export function MoneriumTokenSync() {
  const { isAuthorized } = useAuth();
  const { data: authCtx } = useAuthContext({});
  const { user: privyUser, getAccessToken } = usePrivy();

  const syncedForUser = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthorized) {
      syncedForUser.current = null;
      return;
    }
    if (!authCtx) return;

    const moneriumUserId = authCtx.userId;
    if (syncedForUser.current === moneriumUserId) return;

    const refreshToken = localStorage.getItem(LS_KEY);
    if (!refreshToken) return;

    const wallet = privyUser?.linkedAccounts.find(
      (a) =>
        a.type === "wallet" &&
        (a.walletClientType === "privy" || a.walletClientType === "privy-v2")
    );
    if (!wallet || !("address" in wallet)) return;

    syncedForUser.current = moneriumUserId;

    (async () => {
      try {
        const token = await getAccessToken();
        await fetch("/api/monerium", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-seed-address": wallet.address,
          },
          body: JSON.stringify({
            userId: moneriumUserId,
            refreshToken,
            profileId: authCtx.defaultProfile,
          }),
        });
      } catch (err) {
        console.error("[monerium-token-sync] Failed to persist token:", err);
        syncedForUser.current = null;
      }
    })();
  }, [isAuthorized, authCtx, privyUser, getAccessToken]);

  return null;
}
