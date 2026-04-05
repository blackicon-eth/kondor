import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, erc20Abi, getAddress, hashMessage, keccak256, toBytes, type Hex } from "viem";
import { getDb } from "./db.js";
import { stealthAddresses, users } from "../../shared/db/db.schema.js";

const MONERIUM_API = "https://api.monerium.dev";
const MONERIUM_CLIENT_ID = process.env.MONERIUM_CLIENT_ID ?? process.env.NEXT_PUBLIC_MONERIUM_CLIENT_ID ?? "";

// EURe contract on Sepolia (from CRE workflow constants)
const EURE_SEPOLIA = "0x67b34b93ac295c985e856E5B8A20D83026b580Eb" as Hex;
// Monerium's controller contract on Sepolia (owner of EURe, authorized to burnFrom)
// Verified: eth_getCode confirms this is a contract at this address
const MONERIUM_CONTROLLER_SEPOLIA = (
  process.env.MONERIUM_CONTROLLER_SEPOLIA ?? "0x5e0a62e88fa3fbf15c2a14a7cdf3a6d625b1e58f"
) as Hex;

// ── Monerium API helpers ─────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  profile: string;
  userId: string;
}

interface MoneriumToken {
  address: string;
  chain: string;
  currency: string;
}

interface MoneriumIban {
  iban: string;
  address: string;
  chain: string;
  state: string;
}

interface MoneriumOrder {
  [key: string]: unknown;
  id: string;
  amount: string;
  currency: string;
  address: string;
  chain: string;
  state: string;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  if (!MONERIUM_CLIENT_ID) throw new Error("MONERIUM_CLIENT_ID env var not set");

  const res = await fetch(`${MONERIUM_API}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: MONERIUM_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Monerium token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

async function moneriumGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${MONERIUM_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.monerium.api-v2+json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Monerium GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function moneriumPost<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  const res = await fetch(`${MONERIUM_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.monerium.api-v2+json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Monerium POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function moneriumPostDetailed(
  path: string,
  accessToken: string,
  body: unknown,
): Promise<{ status: number; rawBody: string; json: unknown }> {
  const res = await fetch(`${MONERIUM_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.monerium.api-v2+json",
    },
    body: JSON.stringify(body),
  });
  const rawBody = await res.text();
  if (!res.ok) {
    throw new Error(`Monerium POST ${path} failed (${res.status}): ${rawBody}`);
  }

  let json: unknown = rawBody;
  try {
    json = JSON.parse(rawBody);
  } catch {
    // Keep raw string if body is not JSON.
  }

  return { status: res.status, rawBody, json };
}

// signMsg ABI — matches SimpleAccount.signMsg(bytes32)
const SIGN_MSG_ABI = [
  {
    name: "signMsg",
    type: "function",
    inputs: [{ name: "msgHash", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// ── Order message builder ─────────────────────────────────────────────────────
// Monerium validates the `at {timestamp}` part: it must be a **recent** RFC3339 time.
// A bogus past date (e.g. 1970 from a zero-padded salt) returns "timestamp is expired".
//
// - Default: start of **current UTC minute** on the server (curl / single caller).
// - Optional `messageAt`: ISO string from the client (CRE should send the same value on
//   every node, e.g. floor(now/60s)*60s, so consensus + Monerium both stay happy).
function formatMoneriumOrderTimestamp(ms: number): string {
  const floored = Math.floor(ms / 60_000) * 60_000;
  return new Date(floored).toISOString().replace("Z", "+00:00");
}

/** Monerium link-address API requires this exact personal_sign message for EOAs; SCAs use signature `0x` + on-chain SignMsg. */
export const MONERIUM_LINK_ADDRESS_MESSAGE = "I hereby declare that I am the address owner.";
/**
 * Non-secret throwaway signer used only to produce a syntactically valid 65-byte signature for
 * Monerium's offchain ERC-1271 link flow. Our contract currently returns the magic value for any
 * recovered signer, so the signer identity here does not grant authority.
 */
const DUMMY_LINK_SIGNER = privateKeyToAccount(
  keccak256(toBytes("kondor-monerium-dummy-link-signer")) as Hex,
);

type MoneriumAccessError = { ok: false; error: string };
type MoneriumAccessOk = {
  ok: true;
  accessToken: string;
  profileId: string;
  resolvedSubdomain: string;
  /** Lowercase 0x-prefixed address */
  normalizedAccount: string;
};

/**
 * Resolve kondor user (by ensSubdomain or stealth_addresses) and return a fresh Monerium access token.
 */
export async function resolveMoneriumAccess(
  account: string,
  ensSubdomain?: string,
): Promise<MoneriumAccessError | MoneriumAccessOk> {
  const db = getDb();
  const normalized = account.trim().toLowerCase();
  const subdomain = ensSubdomain?.trim().toLowerCase();

  let user: typeof users.$inferSelect | undefined;
  let resolvedSubdomain: string;

  if (subdomain) {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.ensSubdomain, subdomain))
      .limit(1);
    user = userRows[0];
    if (!user) {
      return { ok: false, error: `No user found for ensSubdomain ${subdomain}` };
    }
    resolvedSubdomain = subdomain;
  } else {
    const saRows = await db
      .select()
      .from(stealthAddresses)
      .where(eq(stealthAddresses.address, normalized))
      .limit(1);

    const sa = saRows[0];
    if (!sa) {
      return { ok: false, error: `No stealth address found for account ${account}` };
    }

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.ensSubdomain, sa.ensSubdomain))
      .limit(1);

    user = userRows[0];
    if (!user) {
      return { ok: false, error: `No user found for ensSubdomain ${sa.ensSubdomain}` };
    }
    resolvedSubdomain = sa.ensSubdomain;
  }

  if (!user.moneriumData) {
    return {
      ok: false,
      error: `User ${resolvedSubdomain} has not connected Monerium`,
    };
  }

  let moneriumData: { userId: string; refreshToken: string; profileId: string };
  try {
    moneriumData = JSON.parse(user.moneriumData) as typeof moneriumData;
  } catch {
    return { ok: false, error: "Malformed moneriumData in DB" };
  }

  let tokenResp: TokenResponse;
  try {
    tokenResp = await refreshAccessToken(moneriumData.refreshToken);
  } catch (err) {
    return {
      ok: false,
      error: `Monerium token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const newMoneriumData = {
    ...moneriumData,
    refreshToken: tokenResp.refresh_token,
    profileId: tokenResp.profile || moneriumData.profileId,
  };
  await db
    .update(users)
    .set({ moneriumData: JSON.stringify(newMoneriumData), updatedAt: new Date() })
    .where(eq(users.ensSubdomain, resolvedSubdomain));

  const accessToken = tokenResp.access_token;
  const profileId = tokenResp.profile || moneriumData.profileId;

  return {
    ok: true,
    accessToken,
    profileId,
    resolvedSubdomain,
    normalizedAccount: normalized,
  };
}

function buildOrderMessage(amount: string, iban: string, messageAt?: string): string {
  let ms: number;
  if (messageAt?.trim()) {
    const parsed = Date.parse(messageAt.trim());
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid messageAt (expected ISO 8601): ${messageAt}`);
    }
    ms = parsed;
  } else {
    ms = Date.now();
  }
  const ts = formatMoneriumOrderTimestamp(ms);
  return `Send EUR ${amount} to ${iban} at ${ts}`;
}

// ── Core offramp logic ────────────────────────────────────────────────────────

export interface OfframpResult {
  ok: true;
  orderId: string;
  orderHttpStatus: number;
  orderRawBody: string;
  message: string;
  messageHash: Hex;
  iban: string;
  amount: string;
  orderResponse: unknown;
  /** ERC-20 approve calldata for the CRE to execute on-chain so Monerium can burnFrom */
  targets: Hex[];
  values: string[];
  calldatas: Hex[];
}

/** Batch to finish Monerium link after POST /addresses returned 202 (self-call signMsg on the SCA). */
export type CompleteLinkOnChain = {
  message: string;
  targets: Hex[];
  values: string[];
  calldatas: Hex[];
};

export interface OfframpError {
  ok: false;
  error: string;
  /** Human-readable next step when Monerium rejected the order. */
  hint?: string;
  /** Present when Monerium says the SCA is not linked yet — run this via batchExecute, then retry redeem. */
  completeLinkOnChain?: CompleteLinkOnChain;
}

function buildLinkAddressSignMsgBatch(normalizedLower: string): CompleteLinkOnChain {
  const message = MONERIUM_LINK_ADDRESS_MESSAGE;
  const msgHash = keccak256(toBytes(message));
  const signMsgCalldata = encodeFunctionData({
    abi: SIGN_MSG_ABI,
    functionName: "signMsg",
    args: [msgHash as Hex],
  });
  const address = getAddress(normalizedLower) as Hex;
  return {
    message,
    targets: [address],
    values: ["0"],
    calldatas: [signMsgCalldata],
  };
}

/**
 * Given a stealth account address and an EURe amount:
 * 1. Resolves the user via stealthAddresses → users.moneriumData
 * 2. Exchanges refresh token for access token (and persists the new one)
 * 3. Fetches the user's first approved IBAN
 * 4. Places a Monerium redeem order with a dummy signature (isValidSignature always returns true)
 * 5. Returns the approve calldata for the CRE to execute on-chain
 *
 * @param ensSubdomain - Optional (e.g. "dronez"). When set, loads Monerium session from that user instead
 *                       of requiring `account` to exist in `stealth_addresses`. Use when `account` is the
 *                       SimpleAccount contract address while tokens live on the user's Monerium profile.
 * @param messageAt - Optional ISO 8601 time for the order message (CRE: pass identical value on all nodes).
 */
export async function executeOfframp(
  account: string,
  amount: string,
  _salt?: string,
  ensSubdomain?: string,
  messageAt?: string,
): Promise<OfframpResult | OfframpError> {
  const access = await resolveMoneriumAccess(account, ensSubdomain);
  if (!access.ok) {
    return access;
  }
  const { accessToken, profileId, normalizedAccount: normalized } = access;

  // ── Fetch IBANs to find destination ──────────────────────────────────
  const ibansResp = await moneriumGet<{ ibans: MoneriumIban[] }>(
    `/ibans?profile=${profileId}`,
    accessToken
  );

  const approvedIban = ibansResp.ibans.find((i) => i.state === "approved");
  if (!approvedIban) {
    return {
      ok: false,
      error: `No approved IBAN found for profile ${profileId}. Request an IBAN in the Monerium dashboard first.`,
    };
  }

  // ── 4. Place redeem order (empty sig — isValidSignature always returns 0x1626ba7e) ──
  let message: string;
  try {
    message = buildOrderMessage(amount, approvedIban.iban, messageAt);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Offchain ERC-1271: sign the order message with the dummy signer.
  // Monerium sees our SCA has code → calls isValidSignature(hashMessage(msg), sig) → magic value → 200 OK.
  // This avoids the 202/SignMsg on-chain round-trip entirely.
  const orderSignature = await DUMMY_LINK_SIGNER.signMessage({ message });

  let order: unknown;
  let orderHttpStatus: number;
  let orderRawBody: string;
  try {
    const orderResp = await moneriumPostDetailed("/orders", accessToken, {
      kind: "redeem",
      address: getAddress(normalized), // smart account (SCA) that holds EURe / signs via EIP-1271
      chain: "sepolia",
      network: "sepolia",
      amount,
      currency: "eur",
      signature: orderSignature, // offchain ERC-1271: dummy sig → isValidSignature → magic value → 200
      message,
      counterpart: {
        identifier: {
          standard: "iban",
          iban: approvedIban.iban,
        },
        details: {
          firstName: "Kondor",
          lastName: "User",
        },
      },
    });
    order = orderResp.json;
    orderHttpStatus = orderResp.status;
    orderRawBody = orderResp.rawBody;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const full = `Monerium placeOrder failed: ${raw}`;
    const notLinked = /not linked/i.test(raw);
    if (notLinked) {
      return {
        ok: false,
        error: full,
        hint:
          "POST /addresses returned 202 until Monerium sees SignMsg for the link message on this SCA. Execute completeLinkOnChain via registry→batchExecute (or owner), wait for the tx to confirm, then call redeem again.",
        completeLinkOnChain: buildLinkAddressSignMsgBatch(normalized),
      };
    }
    return { ok: false, error: full };
  }

  // ── 5. Build on-chain calldata for the CRE batch ─────────────────────────
  // Offchain ERC-1271 succeeded → Monerium already accepted the order (200 OK, has order id).
  // The only on-chain action needed is EURe.approve(moneriumController, maxUint) so Monerium can burnFrom.
  // No SignMsg event needed.
  const approveCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [MONERIUM_CONTROLLER_SEPOLIA, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
  });

  const msgHash = hashMessage(message); // kept for logging

  return {
    ok: true,
    orderId: typeof (order as { id?: unknown })?.id === "string" ? (order as { id: string }).id : "",
    orderHttpStatus,
    orderRawBody,
    message,
    messageHash: msgHash as Hex,
    iban: approvedIban.iban,
    amount,
    orderResponse: order,
    // CRE executes a single on-chain call: EURe.approve(moneriumController, maxUint)
    // Monerium will burnFrom once it confirms the offchain ERC-1271 order signature.
    targets: [EURE_SEPOLIA],
    values: ["0"],
    calldatas: [approveCalldata],
  };
}

// ── Link blockchain address to Monerium profile (POST /addresses) ───────────

export type LinkMoneriumAddressResult =
  | {
      ok: true;
      moneriumHttpStatus: 200 | 201;
      state: "linked";
      profileId: string;
      address: Hex;
      chain: string;
      message: string;
    }
  | {
      ok: true;
      moneriumHttpStatus: 202;
      state: "pending_onchain_sign";
      profileId: string;
      address: Hex;
      chain: string;
      message: string;
      /** Execute via SimpleAccount.batchExecute — self-call signMsg(msgHash) so Monerium sees SignMsg. */
      targets: Hex[];
      values: string[];
      calldatas: Hex[];
    };

/**
 * Link `account` (SCA) to the user's Monerium profile (same user resolution as redeem).
 * Uses offchain ERC-1271 validation with a syntactically valid dummy signature; because the
 * current SimpleAccount returns the magic value for any valid signature blob, Monerium can
 * mark the address as linked immediately (observed as HTTP 200/201 with state=linked).
 */
export async function linkMoneriumAddress(
  account: string,
  ensSubdomain?: string,
  chain: string = "sepolia",
): Promise<LinkMoneriumAddressResult | OfframpError> {
  const access = await resolveMoneriumAccess(account, ensSubdomain);
  if (!access.ok) {
    return access;
  }

  const { accessToken, profileId, normalizedAccount } = access;
  const address = getAddress(normalizedAccount) as Hex;
  const message = MONERIUM_LINK_ADDRESS_MESSAGE;
  const signature = await DUMMY_LINK_SIGNER.signMessage({ message });

  const res = await fetch(`${MONERIUM_API}/addresses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.monerium.api-v2+json",
    },
    body: JSON.stringify({
      profile: profileId,
      address,
      chain,
      message,
      // Offchain ERC-1271 path: Monerium static-calls isValidSignature(hash, signature).
      // Our current SimpleAccount returns the magic value for any validly encoded signature.
      signature,
    }),
  });

  const bodyText = await res.text();
  let parsedBody: { state?: string } | undefined;
  try {
    parsedBody = JSON.parse(bodyText) as { state?: string };
  } catch {
    // Ignore non-JSON response bodies below.
  }

  if ((res.status === 200 || res.status === 201) && parsedBody?.state === "linked") {
    return {
      ok: true,
      moneriumHttpStatus: res.status as 200 | 201,
      state: "linked",
      profileId,
      address,
      chain,
      message,
    };
  }

  if (res.status === 202) {
    const batch = buildLinkAddressSignMsgBatch(normalizedAccount);
    return {
      ok: true,
      moneriumHttpStatus: 202,
      state: "pending_onchain_sign",
      profileId,
      address,
      chain,
      message,
      targets: batch.targets,
      values: batch.values,
      calldatas: batch.calldatas,
    };
  }

  return {
    ok: false,
    error: `Monerium link address failed (${res.status}): ${bodyText}`,
  };
}
