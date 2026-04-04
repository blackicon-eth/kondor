import { db } from "@/lib/db";
import { users } from "@kondor/shared/db/db.schema";
import { eq, sql } from "drizzle-orm";

export async function POST(request: Request) {
  const seedAddress = request.headers.get("x-seed-address");
  if (!seedAddress) {
    return Response.json({ error: "Missing seed address" }, { status: 400 });
  }

  const body = await request.json();
  const { ensSubdomain } = body as { ensSubdomain: string };

  if (!ensSubdomain || typeof ensSubdomain !== "string" || !ensSubdomain.trim()) {
    return Response.json({ error: "Missing ENS subdomain" }, { status: 400 });
  }

  const subdomain = ensSubdomain.trim().toLowerCase();

  // Check if subdomain is already taken (case-insensitive)
  const existing = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.ensSubdomain})`, subdomain))
    .get();

  if (existing) {
    return Response.json(
      { error: `${subdomain}.kondor.eth is already taken` },
      { status: 409 }
    );
  }

  // Update the user's ENS subdomain
  await db
    .update(users)
    .set({ ensSubdomain: subdomain, updatedAt: new Date() })
    .where(eq(users.seedAddress, seedAddress));

  const updated = await db
    .select()
    .from(users)
    .where(eq(users.seedAddress, seedAddress))
    .get();

  return Response.json(updated);
}
