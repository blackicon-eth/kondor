import { db } from "@/lib/db";
import { users } from "@kondor/shared/db/db.schema";
import { eq } from "drizzle-orm";

export async function PUT(request: Request) {
  const seedAddress = request.headers.get("x-seed-address");
  if (!seedAddress) {
    return Response.json({ error: "Missing seed address" }, { status: 400 });
  }

  const body = await request.json();
  const { textRecords } = body as { textRecords: Record<string, unknown> };

  if (!textRecords || typeof textRecords !== "object") {
    return Response.json({ error: "Missing text records" }, { status: 400 });
  }

  // Read existing text records and merge
  const user = await db
    .select()
    .from(users)
    .where(eq(users.seedAddress, seedAddress))
    .get();

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const existing = JSON.parse(user.textRecords || "{}");
  const merged = { ...existing, ...textRecords };

  await db
    .update(users)
    .set({ textRecords: JSON.stringify(merged), updatedAt: new Date() })
    .where(eq(users.seedAddress, seedAddress));

  return Response.json({ textRecords: merged });
}
