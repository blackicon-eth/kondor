import { db } from "@/lib/db";
import { users } from "@kondor/shared/db/db.schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  const seedAddress = request.headers.get("x-seed-address");
  if (!seedAddress) {
    return Response.json({ error: "Missing seed address" }, { status: 400 });
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.seedAddress, seedAddress))
    .get();

  if (!user) {
    // Create user row on first login
    const newUser = { seedAddress, ensSubdomain: null };
    await db.insert(users).values(newUser);
    return Response.json(newUser);
  }

  return Response.json(user);
}
