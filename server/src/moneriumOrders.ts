import { eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { users } from "../../shared/db/db.schema.js";

const MONERIUM_API = "https://api.monerium.dev";

type MoneriumData = { userId: string; refreshToken: string; profileId: string };

async function fetchOrdersWithToken(
  moneriumData: MoneriumData,
  persistKey: { seedAddress: string } | { ensSubdomain: string },
): Promise<{ orders: unknown[]; error?: string }> {
  const clientId = process.env.MONERIUM_CLIENT_ID ?? "";
  if (!clientId) {
    return { orders: [], error: "MONERIUM_CLIENT_ID not configured" };
  }

  const tokenRes = await fetch(`${MONERIUM_API}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: moneriumData.refreshToken,
    }),
  });

  if (!tokenRes.ok) {
    return { orders: [], error: `Token refresh failed: ${await tokenRes.text()}` };
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    profile: string;
  };

  const profileId = tokenData.profile || moneriumData.profileId;
  const newData = JSON.stringify({
    ...moneriumData,
    refreshToken: tokenData.refresh_token,
    profileId,
  });

  const db = getDb();
  if ("seedAddress" in persistKey) {
    await db
      .update(users)
      .set({ moneriumData: newData, updatedAt: new Date() })
      .where(eq(users.seedAddress, persistKey.seedAddress.trim().toLowerCase()));
  } else {
    await db
      .update(users)
      .set({ moneriumData: newData, updatedAt: new Date() })
      .where(eq(users.ensSubdomain, persistKey.ensSubdomain.trim().toLowerCase()));
  }

  const ordersRes = await fetch(`${MONERIUM_API}/orders?profile=${profileId}`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.monerium.api-v2+json",
    },
  });

  if (!ordersRes.ok) {
    return { orders: [], error: `Orders GET failed (${ordersRes.status}): ${await ordersRes.text()}` };
  }

  const data = (await ordersRes.json()) as { orders?: unknown[] };
  return { orders: data.orders ?? [] };
}

/**
 * List Monerium orders for the profile tied to a kondor user (by Privy seed address).
 */
export async function listMoneriumOrdersBySeed(seedAddress: string): Promise<{
  orders: unknown[];
  error?: string;
}> {
  const normalized = seedAddress.trim().toLowerCase();
  const userRows = await getDb()
    .select()
    .from(users)
    .where(eq(users.seedAddress, normalized))
    .limit(1);
  const user = userRows[0];
  if (!user?.moneriumData) {
    return { orders: [], error: "No user or monerium_data for this seedAddress" };
  }

  let moneriumData: MoneriumData;
  try {
    moneriumData = JSON.parse(user.moneriumData) as MoneriumData;
  } catch {
    return { orders: [], error: "Malformed monerium_data" };
  }

  return fetchOrdersWithToken(moneriumData, { seedAddress: normalized });
}

/**
 * List Monerium orders for the profile tied to a kondor ENS label (e.g. dronez).
 */
export async function listMoneriumOrdersBySubdomain(ensSubdomain: string): Promise<{
  orders: unknown[];
  error?: string;
}> {
  const sub = ensSubdomain.trim().toLowerCase();
  const userRows = await getDb().select().from(users).where(eq(users.ensSubdomain, sub)).limit(1);
  const user = userRows[0];
  if (!user?.moneriumData) {
    return { orders: [], error: `No user or monerium_data for ensSubdomain ${sub}` };
  }

  let moneriumData: MoneriumData;
  try {
    moneriumData = JSON.parse(user.moneriumData) as MoneriumData;
  } catch {
    return { orders: [], error: "Malformed monerium_data" };
  }

  return fetchOrdersWithToken(moneriumData, { ensSubdomain: sub });
}
