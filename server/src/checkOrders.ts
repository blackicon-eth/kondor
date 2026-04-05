import "./env";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { users } from "../../shared/db/db.schema.js";

const ACCOUNT = "0x3D70E4b21A953a27d5a16833C660DB2Ee717FD2c";
const AMOUNT = "0.1";
const API = "https://api.monerium.dev";

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client);
  const all = await db.select().from(users);
  const u = all.find((x) => x.moneriumData);
  if (!u) throw new Error("No user with moneriumData");
  const d = JSON.parse(u.moneriumData!) as { profileId: string; refreshToken: string };

  // ── Refresh token ──────────────────────────────────────────────────────────
  const tokenRes = await fetch(`${API}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.MONERIUM_CLIENT_ID!,
      refresh_token: d.refreshToken,
    }),
  });
  const td = await tokenRes.json() as { access_token: string; refresh_token: string; profile: string };
  if (!tokenRes.ok) { console.error("token fail:", td); process.exit(1); }
  await db.update(users).set({ moneriumData: JSON.stringify({ ...d, refreshToken: td.refresh_token }) });
  const at = td.access_token;
  const profileId = td.profile || d.profileId;
  const h = { Authorization: `Bearer ${at}`, Accept: "application/vnd.monerium.api-v2+json" };

  // ── Get IBAN ───────────────────────────────────────────────────────────────
  const ibansRes = await fetch(`${API}/ibans?profile=${profileId}`, { headers: h });
  const ibansData = await ibansRes.json() as { ibans: { iban: string; state: string }[] };
  const iban = ibansData.ibans.find((i) => i.state === "approved")!.iban;
  console.log("IBAN:", iban);

  // ── Place order ────────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace("Z", "+00:00");
  console.log("================================================");
  console.log("timestamp:", timestamp);
  console.log("date:", new Date(timestamp));
  console.log("date:", new Date(timestamp).toISOString());
  console.log("date:", new Date(timestamp).toISOString().replace("Z", "+00:00"));
  console.log("date:", new Date(timestamp).toISOString().replace("Z", "+00:00").replace("T", " "));
  console.log("date:", new Date(timestamp).toISOString().replace("Z", "+00:00").replace("T", " ").replace(":", ""));
  console.log("date:", new Date(timestamp).toISOString().replace("Z", "+00:00").replace("T", " ").replace(":", "").replace(".", ""));
  console.log("date:", new Date(timestamp).toISOString().replace("Z", "+00:00").replace("T", " ").replace(":", "").replace(".", "").replace(" ", ""));
  console.log("date:", new Date(timestamp).toISOString().replace("Z", "+00:00").replace("T", " ").replace(":", "").replace(".", "").replace(" ", "").replace(":", ""));
  console.log("================================================");

  const message = `Send EUR ${AMOUNT} to ${iban} at ${timestamp}`;

  const orderRes = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "redeem",
      address: ACCOUNT,
      chain: "sepolia",
      network: "sepolia",
      amount: AMOUNT,
      currency: "eur",
      signature: "0x",
      message,
      counterpart: {
        identifier: { standard: "iban", iban },
        details: { firstName: "Kondor", lastName: "User" },
      },
    }),
  });
  const orderBody = await orderRes.text();
  console.log(`\nPOST /orders (${orderRes.status}):`, orderBody);

  // ── Immediately check GET /orders ──────────────────────────────────────────
  console.log("\nChecking GET /orders immediately after...");
  const check = await fetch(`${API}/orders?profile=${profileId}`, { headers: h });
  console.log(`GET /orders (${check.status}):`, await check.text());

  // ── Also try by address ────────────────────────────────────────────────────
  const byAddr = await fetch(`${API}/orders?address=${ACCOUNT}`, { headers: h });
  console.log(`GET /orders?address (${byAddr.status}):`, await byAddr.text());
}

main().catch((e) => { console.error(e); process.exit(1); });
