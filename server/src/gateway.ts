import { Request, Response } from "express";
import {
  encodeFunctionResult,
  decodeFunctionData,
  keccak256,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db.js";
import { config } from "./config";
import {
  subdomains,
  subdomainTextRecords,
  subdomainAddresses,
  stealthAddresses,
} from "../../shared/db/db.schema.js";

// ── ABI fragments for the resolver functions we handle ───────────────

const resolverAbi = [
  {
    name: "addr",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "addr",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "contenthash",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

const QUERY_WINDOW_MS = 10_000;
const STALE_STEALTH_WINDOW_MS = 20 * 60 * 1000;

type GatewayDeps = {
  onStealthAddressGenerated?: (address: string, subdomainName: string) => Promise<void>;
};

let gatewayDeps: GatewayDeps = {};

const recentStealthByClient = new Map<
  string,
  { address: `0x${string}`; expiresAt: number }
>();

export function configureGatewayDeps(deps: GatewayDeps): void {
  gatewayDeps = deps;
}

// ── DNS-encoded name decoder ─────────────────────────────────────────

function decodeDnsName(data: Hex): string {
  const bytes = Buffer.from(data.slice(2), "hex");
  const labels: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const len = bytes[offset];
    if (len === 0) break;
    offset += 1;
    labels.push(bytes.subarray(offset, offset + len).toString("utf8"));
    offset += len;
  }
  return labels.join(".");
}

function deriveStealthAddress(seedAddress: string, queryNonce: number): `0x${string}` {
  const hash = keccak256(
    encodePacked(["address", "uint256"], [seedAddress as Hex, BigInt(queryNonce)])
  );
  return getAddress(`0x${hash.slice(-40)}` as Hex) as `0x${string}`;
}

function getClientKey(req: Request): string {
  const forwarded = req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim().toLowerCase() ?? "unknown";
  }
  return (req.ip || "unknown").toLowerCase();
}

async function resolveStealthAddress(
  subdomainName: string,
  clientKey: string
): Promise<`0x${string}` | null> {
  const sub = await getDb()
    .select({
      seedAddress: subdomains.seedAddress,
      queryNonce: subdomains.queryNonce,
    })
    .from(subdomains)
    .where(eq(subdomains.name, subdomainName))
    .limit(1);

  const seedAddress = sub[0]?.seedAddress;
  if (!seedAddress) return null;

  const cacheKey = `${subdomainName.toLowerCase()}::${clientKey}`;
  const cached = recentStealthByClient.get(cacheKey);
  const now = Date.now();
  if (cached && now < cached.expiresAt) {
    return cached.address;
  }

  const nextNonce = Number(sub[0]?.queryNonce ?? 0) + 1;
  const stealthAddress = deriveStealthAddress(seedAddress, nextNonce);
  const stealthAddressLower = stealthAddress.toLowerCase();

  await getDb()
    .update(subdomains)
    .set({
      queryNonce: nextNonce,
      lastQueryAt: new Date(),
      triggered: false,
    })
    .where(eq(subdomains.name, subdomainName));

  await getDb()
    .insert(stealthAddresses)
    .values({
      address: stealthAddressLower,
      subdomainName,
      seedAddress,
      queryNonce: nextNonce,
      triggered: false,
    })
    .onConflictDoNothing();

  recentStealthByClient.set(cacheKey, {
    address: stealthAddress,
    expiresAt: now + QUERY_WINDOW_MS,
  });

  if (gatewayDeps.onStealthAddressGenerated) {
    try {
      await gatewayDeps.onStealthAddressGenerated(stealthAddressLower, subdomainName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[gateway] failed to push stealth address to webhook list: ${message}`);
    }
  }

  return stealthAddress;
}

// ── Resolve function ─────────────────────────────────────────────────

async function resolveCall(
  callData: Hex,
  name: string,
  clientKey: string
): Promise<Hex> {
  const subdomainName = name.replace(`.${config.ensDomain}`, "").split(".")[0];

  // Try to decode which resolver function was called
  for (const abiItem of resolverAbi) {
    try {
      const decoded = decodeFunctionData({
        abi: [abiItem],
        data: callData,
      });

      if (decoded.functionName === "text") {
        const [, key] = decoded.args as [Hex, string];
        const record = await getDb()
          .select()
          .from(subdomainTextRecords)
          .where(
            and(
              eq(subdomainTextRecords.subdomainName, subdomainName),
              eq(subdomainTextRecords.key, key)
            )
          )
          .limit(1);

        const value = record[0]?.value ?? "";
        return encodeFunctionResult({ abi: [abiItem], functionName: "text", result: value });
      }

      if (decoded.functionName === "addr") {
        const args = decoded.args as [Hex] | [Hex, bigint];
        const coinType = args.length === 2 ? Number(args[1]) : 60;
        let addr = "0x0000000000000000000000000000000000000000";

        if (coinType === 60) {
          const stealthAddress = await resolveStealthAddress(subdomainName, clientKey);
          if (stealthAddress) {
            addr = stealthAddress;
          } else {
            const record = await getDb()
              .select()
              .from(subdomainAddresses)
              .where(
                and(
                  eq(subdomainAddresses.subdomainName, subdomainName),
                  eq(subdomainAddresses.coinType, coinType)
                )
              )
              .limit(1);
            addr = record[0]?.address ?? addr;
          }
        } else {
          const record = await getDb()
            .select()
            .from(subdomainAddresses)
            .where(
              and(
                eq(subdomainAddresses.subdomainName, subdomainName),
                eq(subdomainAddresses.coinType, coinType)
              )
            )
            .limit(1);
          addr = record[0]?.address ?? addr;
        }

        if (coinType === 60 && args.length === 1) {
          return encodeFunctionResult({ abi: [abiItem], functionName: "addr", result: addr as `0x${string}` });
        }
        // Multi-coin addr returns bytes
        return encodeFunctionResult({
          abi: [abiItem],
          functionName: "addr",
          result: (addr.startsWith("0x") ? addr : `0x${addr}`) as Hex,
        });
      }

      if (decoded.functionName === "contenthash") {
        return encodeFunctionResult({ abi: [abiItem], functionName: "contenthash", result: "0x" });
      }
    } catch {
      // Not this function, try next
    }
  }

  // Unknown function - return empty
  return "0x";
}

// ── Gateway request handler ──────────────────────────────────────────
// Handles: GET /{sender}/{data}.json  (ERC-3668 CCIP-Read)
//
// Must match the contract's resolveWithProof signature verification:
//   requestHash  = keccak256(extraData)
//   messageHash  = keccak256(abi.encodePacked(result, address(this), expires, requestHash))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + messageHash)
//   ecrecover(ethSignedHash, sig) == signer

export async function handleGatewayRequest(req: Request, res: Response): Promise<void> {
  try {
    const { sender, data } = req.params;
    const callData = data.replace(/\.json$/, "") as Hex;

    console.log(`[gateway] request sender=${sender} dataLen=${callData.length}`);

    if (!config.gatewaySignerPrivateKey) {
      res.status(503).json({ ok: false, error: "Gateway signer not configured" });
      return;
    }

    // The callData encodes: resolve(bytes dnsEncodedName, bytes innerCallData)
    const resolveAbi = [
      {
        name: "resolve",
        type: "function",
        stateMutability: "view",
        inputs: [
          { name: "name", type: "bytes" },
          { name: "data", type: "bytes" },
        ],
        outputs: [{ name: "", type: "bytes" }],
      },
    ] as const;

    let dnsName: Hex;
    let innerCallData: Hex;

    try {
      const decoded = decodeFunctionData({ abi: resolveAbi, data: callData });
      [dnsName, innerCallData] = decoded.args as [Hex, Hex];
    } catch {
      res.status(400).json({ ok: false, error: "Could not decode resolve() calldata" });
      return;
    }

    const name = decodeDnsName(dnsName);
    console.log(`[gateway] resolved name="${name}" for inner call`);

    if (!name.endsWith(`.${config.ensDomain}`)) {
      res.status(404).json({ ok: false, error: `Name ${name} is not under ${config.ensDomain}` });
      return;
    }

    const clientKey = getClientKey(req);
    const result = await resolveCall(innerCallData, name, clientKey);

    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min TTL
    const signerKey = config.gatewaySignerPrivateKey as Hex;
    const account = privateKeyToAccount(signerKey);

    // extraData in the contract is the same callData the gateway received
    // Contract does: requestHash = keccak256(extraData)
    const requestHash = keccak256(callData);

    // Contract does: messageHash = keccak256(abi.encodePacked(result, address(this), expires, requestHash))
    const messageHash = keccak256(
      encodePacked(
        ["bytes", "address", "uint64", "bytes32"],
        [result, sender as Hex, validUntil, requestHash]
      )
    );

    // Contract then wraps in EIP-191 personal_sign before ecrecover.
    // viem's signMessage does this automatically (prepends "\x19Ethereum Signed Message:\n32").
    const signature = await account.signMessage({ message: { raw: messageHash } });

    // Return abi.encode(bytes result, uint64 expires, bytes sig)
    const responseData = encodeAbiParameters(
      [
        { type: "bytes" },
        { type: "uint64" },
        { type: "bytes" },
      ],
      [result, validUntil, signature]
    );

    console.log(`[gateway] responding for "${name}" validUntil=${validUntil}`);
    res.json({ data: responseData });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[gateway] Error:", message);
    res.status(500).json({ ok: false, error: message });
  }
}

// ── Subdomain CRUD helpers (used by registration/update endpoints) ───

export async function getSubdomainWithRecords(name: string) {
  const sub = await getDb().select().from(subdomains).where(eq(subdomains.name, name)).limit(1);
  if (!sub[0]) return null;

  const textRecords = await getDb()
    .select()
    .from(subdomainTextRecords)
    .where(eq(subdomainTextRecords.subdomainName, name));

  const addressRecords = await getDb()
    .select()
    .from(subdomainAddresses)
    .where(eq(subdomainAddresses.subdomainName, name));

  const stealthRecords = await getDb()
    .select()
    .from(stealthAddresses)
    .where(eq(stealthAddresses.subdomainName, name));

  return {
    ...sub[0],
    text: textRecords.map((r) => ({ key: r.key, value: r.value })),
    addresses: addressRecords.map((r) => ({ coinType: r.coinType, address: r.address })),
    stealth: stealthRecords.map((r) => ({
      address: r.address,
      queryNonce: r.queryNonce,
      triggered: r.triggered,
      createdAt: r.createdAt,
      lastTriggeredAt: r.lastTriggeredAt,
    })),
  };
}

export async function getAllSubdomains() {
  const allSubs = await getDb().select().from(subdomains);
  const results = [];
  for (const sub of allSubs) {
    const textRecords = await getDb()
      .select()
      .from(subdomainTextRecords)
      .where(eq(subdomainTextRecords.subdomainName, sub.name));
    const addressRecords = await getDb()
      .select()
      .from(subdomainAddresses)
      .where(eq(subdomainAddresses.subdomainName, sub.name));
    const stealthRecords = await getDb()
      .select()
      .from(stealthAddresses)
      .where(eq(stealthAddresses.subdomainName, sub.name));
    results.push({
      name: sub.name,
      owner: sub.owner,
      seedAddress: sub.seedAddress,
      queryNonce: sub.queryNonce,
      triggered: sub.triggered,
      lastQueryAt: sub.lastQueryAt,
      lastTriggeredAt: sub.lastTriggeredAt,
      text: textRecords.map((r) => ({ key: r.key, value: r.value })),
      addresses: addressRecords.map((r) => ({ coinType: r.coinType, address: r.address })),
      stealth: stealthRecords.map((r) => ({
        address: r.address,
        queryNonce: r.queryNonce,
        triggered: r.triggered,
        createdAt: r.createdAt,
        lastTriggeredAt: r.lastTriggeredAt,
      })),
    });
  }
  return results;
}

export async function registerSubdomain(
  name: string,
  owner: string,
  seedAddress?: string,
  textRecords?: Array<{ key: string; value: string }>,
  addresses?: Array<{ coinType: number; address: string }>,
) {
  await getDb().insert(subdomains).values({
    name,
    owner,
    seedAddress: seedAddress?.toLowerCase(),
    queryNonce: 0,
    triggered: false,
  });

  if (textRecords && textRecords.length > 0) {
    await getDb().insert(subdomainTextRecords).values(
      textRecords.map((r) => ({ subdomainName: name, key: r.key, value: r.value }))
    );
  }

  if (addresses && addresses.length > 0) {
    await getDb().insert(subdomainAddresses).values(
      addresses.map((r) => ({ subdomainName: name, coinType: r.coinType, address: r.address }))
    );
  }
}

export async function getSubdomainByStealthAddress(address: string) {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return null;

  const row = await getDb()
    .select()
    .from(stealthAddresses)
    .where(eq(stealthAddresses.address, normalized))
    .limit(1);

  if (!row[0]) return null;
  const sub = await getSubdomainWithRecords(row[0].subdomainName);
  if (!sub) return null;

  return {
    address: normalized,
    subdomainName: row[0].subdomainName,
    seedAddress: row[0].seedAddress,
    queryNonce: row[0].queryNonce,
    triggered: row[0].triggered,
    createdAt: row[0].createdAt,
    lastTriggeredAt: row[0].lastTriggeredAt,
    subdomain: sub,
  };
}

export async function getSubdomainBySeed(seedAddress: string) {
  const normalized = seedAddress.trim().toLowerCase();
  if (!normalized) return null;

  const sub = await getDb()
    .select()
    .from(subdomains)
    .where(eq(subdomains.seedAddress, normalized))
    .limit(1);

  if (!sub[0]) return null;
  return getSubdomainWithRecords(sub[0].name);
}

export async function markStealthAddressTriggered(address: string): Promise<void> {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return;

  const existing = await getDb()
    .select({
      subdomainName: stealthAddresses.subdomainName,
    })
    .from(stealthAddresses)
    .where(eq(stealthAddresses.address, normalized))
    .limit(1);

  if (!existing[0]) return;

  const now = new Date();
  await getDb()
    .update(stealthAddresses)
    .set({
      triggered: true,
      lastTriggeredAt: now,
    })
    .where(eq(stealthAddresses.address, normalized));

  await getDb()
    .update(subdomains)
    .set({
      triggered: true,
      lastTriggeredAt: now,
    })
    .where(eq(subdomains.name, existing[0].subdomainName));
}

export async function pruneStaleStealthAddresses(): Promise<number> {
  const cutoff = Date.now() - STALE_STEALTH_WINDOW_MS;
  const rows = await getDb().select().from(stealthAddresses);
  let removed = 0;

  for (const row of rows) {
    const createdAtMs = row.createdAt?.getTime() ?? 0;
    const triggeredAtMs = row.lastTriggeredAt?.getTime() ?? 0;
    const isFresh = createdAtMs >= cutoff || triggeredAtMs >= cutoff;
    if (isFresh) continue;

    await getDb().delete(stealthAddresses).where(eq(stealthAddresses.address, row.address));
    removed += 1;
  }

  return removed;
}

export async function updateSubdomainTextRecords(
  name: string,
  textRecords: Array<{ key: string; value: string }>,
) {
  // Upsert: delete existing keys that are being updated, then insert
  for (const record of textRecords) {
    await getDb()
      .delete(subdomainTextRecords)
      .where(
        and(
          eq(subdomainTextRecords.subdomainName, name),
          eq(subdomainTextRecords.key, record.key)
        )
      );
  }
  if (textRecords.length > 0) {
    await getDb().insert(subdomainTextRecords).values(
      textRecords.map((r) => ({ subdomainName: name, key: r.key, value: r.value }))
    );
  }
}
