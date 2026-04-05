import { db } from "@/lib/db";
import { users } from "@kondor/shared/db/db.schema";
import { eq } from "drizzle-orm";
import { verifyAuth } from "@/lib/privy";

const MONERIUM_API = "https://api.monerium.dev";
const MONERIUM_CLIENT_ID = process.env.NEXT_PUBLIC_MONERIUM_CLIENT_ID ?? "";

type MoneriumData = {
  userId: string;
  refreshToken: string;
  profileId: string;
};

async function getAccessToken(refreshToken: string): Promise<{ accessToken: string; newRefreshToken: string; profile: string }> {
  const res = await fetch(`${MONERIUM_API}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: MONERIUM_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json() as { access_token: string; refresh_token: string; profile: string };
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token, profile: data.profile };
}

// GET /api/monerium — returns orders from Monerium using DB token
// Requires: Authorization: Bearer <privy-token>, x-seed-address header
export async function GET(request: Request) {
  const userId = await verifyAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const seedAddress = request.headers.get("x-seed-address");
  if (!seedAddress) return Response.json({ error: "Missing seed address" }, { status: 400 });

  const user = await db.select().from(users).where(eq(users.seedAddress, seedAddress)).get();
  if (!user?.moneriumData) return Response.json({ orders: [] });

  let moneriumData: MoneriumData;
  try {
    moneriumData = JSON.parse(user.moneriumData) as MoneriumData;
  } catch {
    return Response.json({ orders: [] });
  }

  try {
    const { accessToken, newRefreshToken, profile } = await getAccessToken(moneriumData.refreshToken);

    // Persist rotated token
    const profileId = profile || moneriumData.profileId;
    await db
      .update(users)
      .set({ moneriumData: JSON.stringify({ ...moneriumData, refreshToken: newRefreshToken, profileId }), updatedAt: new Date() })
      .where(eq(users.seedAddress, seedAddress));

    const ordersRes = await fetch(`${MONERIUM_API}/orders?profile=${profileId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.monerium.api-v2+json",
      },
    });
    if (!ordersRes.ok) return Response.json({ orders: [] });
    const data = await ordersRes.json() as { orders?: unknown[] };
    return Response.json({ orders: data.orders ?? [] });
  } catch {
    return Response.json({ orders: [] });
  }
}

export async function PUT(request: Request) {
  const seedAddress = request.headers.get("x-seed-address");
  if (!seedAddress) {
    return Response.json({ error: "Missing seed address" }, { status: 400 });
  }

  const body = await request.json();
  const { userId, refreshToken, profileId } = body as Partial<MoneriumData>;

  if (!userId || !refreshToken || !profileId) {
    return Response.json({ error: "Missing userId, refreshToken, or profileId" }, { status: 400 });
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.seedAddress, seedAddress))
    .get();

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  await db
    .update(users)
    .set({
      moneriumData: JSON.stringify({ userId, refreshToken, profileId }),
      updatedAt: new Date(),
    })
    .where(eq(users.seedAddress, seedAddress));

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const seedAddress = request.headers.get("x-seed-address");
  if (!seedAddress) {
    return Response.json({ error: "Missing seed address" }, { status: 400 });
  }

  await db
    .update(users)
    .set({ moneriumData: null, updatedAt: new Date() })
    .where(eq(users.seedAddress, seedAddress));

  return Response.json({ ok: true });
}
