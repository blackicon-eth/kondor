/**
 * Quick test: place a Monerium redeem order from a known address.
 * Usage:  cd server && npx tsx src/testOfframp.ts
 *
 * This bypasses the stealthAddresses lookup and directly calls the Monerium
 * API using whatever refresh token is currently in the DB for the user.
 */
import "./env";
import { hashMessage, encodeFunctionData, erc20Abi, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { users } from "../../shared/db/db.schema.js";

const ACCOUNT = "0x3D70E4b21A953a27d5a16833C660DB2Ee717FD2c";
const AMOUNT = "0.1";
const MONERIUM_API = "https://api.monerium.dev";
const MONERIUM_CLIENT_ID = process.env.MONERIUM_CLIENT_ID!;
const EURE_SEPOLIA = "0x67b34b93ac295c985e856E5B8A20D83026b580Eb" as Hex;
const MONERIUM_CONTROLLER = "0x5e0a62e88fa3fbf15c2a14a7cdf3a6d625b1e58f" as Hex;

const DUMMY_SIGNER = privateKeyToAccount(keccak256(toBytes("kondor-monerium-dummy-link-signer")) as Hex);

async function main() {
  // ── Get refresh token from DB ──────────────────────────────────────────────
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client);
  const allUsers = await db.select().from(users);
  const userWithMonerium = allUsers.find((u) => u.moneriumData);
  if (!userWithMonerium) throw new Error("No user with moneriumData in DB. Reconnect via UI.");

  const moneriumData = JSON.parse(userWithMonerium.moneriumData!) as {
    userId: string;
    refreshToken: string;
    profileId: string;
  };
  console.log("User:", userWithMonerium.ensSubdomain);
  console.log("ProfileId:", moneriumData.profileId);
  console.log("RefreshToken (first 8):", moneriumData.refreshToken.slice(0, 8) + "...");

  // ── Refresh access token ───────────────────────────────────────────────────
  const tokenRes = await fetch(`${MONERIUM_API}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: MONERIUM_CLIENT_ID,
      refresh_token: moneriumData.refreshToken,
    }),
  });

  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    throw new Error(`Token refresh failed (${tokenRes.status}): ${t}`);
  }
  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    profile: string;
  };
  console.log("New refresh token (first 8):", tokenData.refresh_token.slice(0, 8) + "...");

  // Persist rotated token
  const newData = { ...moneriumData, refreshToken: tokenData.refresh_token };
  await db.update(users).set({ moneriumData: JSON.stringify(newData) });
  console.log("Token updated in DB ✓");

  const accessToken = tokenData.access_token;
  const profileId = tokenData.profile || moneriumData.profileId;

  // ── Fetch IBANs ────────────────────────────────────────────────────────────
  const ibansRes = await fetch(`${MONERIUM_API}/ibans?profile=${profileId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.monerium.api-v2+json",
    },
  });
  if (!ibansRes.ok) throw new Error(`GET /ibans failed: ${await ibansRes.text()}`);
  const ibansData = await ibansRes.json() as { ibans: { iban: string; address: string; state: string }[] };

  console.log("\nIBANs:");
  ibansData.ibans.forEach((i) => console.log(` ${i.iban} → ${i.address} [${i.state}]`));

  const approvedIban = ibansData.ibans.find((i) => i.state === "approved");
  if (!approvedIban) throw new Error("No approved IBAN found");
  console.log("\nUsing IBAN:", approvedIban.iban);

  // ── Build order message ────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace("Z", "+00:00");
  const message = `Send EUR ${AMOUNT} to ${approvedIban.iban} at ${timestamp}`;
  console.log("Message:", message);

  // ── Place order ────────────────────────────────────────────────────────────
  // Offchain ERC-1271: dummy sig → isValidSignature → magic value → 200 OK (no SignMsg needed)
  const signature = await DUMMY_SIGNER.signMessage({ message });
  const orderPayload = {
    kind: "redeem",
    address: ACCOUNT,
    chain: "sepolia",
    network: "sepolia",
    amount: AMOUNT,
    currency: "eur",
    signature,
    message,
    counterpart: {
      identifier: { standard: "iban", iban: approvedIban.iban },
      details: { firstName: "Kondor", lastName: "User" },
    },
  };
  console.log("\nOrder payload:", JSON.stringify(orderPayload, null, 2));

  const orderRes = await fetch(`${MONERIUM_API}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.monerium.api-v2+json",
    },
    body: JSON.stringify(orderPayload),
  });

  const orderBody = await orderRes.text();
  console.log(`\nOrder response (${orderRes.status}):`, orderBody);

  if (!orderRes.ok) return;

  const order = JSON.parse(orderBody) as { id: string };
  console.log("\nOrder ID:", order.id);

  // ── Compute on-chain calldata ──────────────────────────────────────────────
  // Only approve needed — offchain ERC-1271 means no SignMsg on-chain
  const msgHash = hashMessage(message);
  console.log("msgHash (for reference):", msgHash);

  const approveCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [MONERIUM_CONTROLLER, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
  });

  console.log("\n=== CRE batch calldata ===");
  console.log("targets:", [EURE_SEPOLIA]);
  console.log("values: [0]");
  console.log("calldatas[0] (approve):", approveCalldata);
}

main().catch((e) => { console.error(e); process.exit(1); });
