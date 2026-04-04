import { Request, Response } from "express";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  encodePacked,
  getAddress,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "./db.js";
import { config } from "./config";
import { stealthAddresses, users } from "../../shared/db/db.schema.js";

const STALE_STEALTH_WINDOW_MS = 20 * 60 * 1000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type GatewayDeps = {
  onStealthAddressGenerated?: (address: string, subdomainName: string) => Promise<void>;
};

let gatewayDeps: GatewayDeps = {};

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

export function configureGatewayDeps(deps: GatewayDeps): void {
  gatewayDeps = deps;
}

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

function extractSubdomain(name: string): string {
  return name.replace(`.${config.ensDomain}`, "").split(".")[0] ?? "";
}

function parseTextRecordJson(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function deriveHash(seedAddress: string, queryNonce: number): Hex {
  return keccak256(encodePacked(["address", "uint256"], [seedAddress as Hex, BigInt(queryNonce)]));
}

function deriveStealthAddress(seedAddress: string, queryNonce: number): `0x${string}` {
  const hash = deriveHash(seedAddress, queryNonce);
  return getAddress(`0x${hash.slice(-40)}` as Hex) as `0x${string}`;
}

async function resolveStealthAddress(subdomainName: string): Promise<`0x${string}` | null> {
  const rows = await getDb()
    .select({ seedAddress: users.seedAddress, queryNonce: users.queryNonce })
    .from(users)
    .where(eq(users.ensSubdomain, subdomainName))
    .limit(1);
  const user = rows[0];
  if (!user?.seedAddress) return null;

  const nextNonce = Number(user.queryNonce ?? 0) + 1;
  const hash = deriveHash(user.seedAddress, nextNonce);
  const stealthAddress = deriveStealthAddress(user.seedAddress, nextNonce);
  const stealthAddressLower = stealthAddress.toLowerCase();

  await getDb()
    .update(users)
    .set({
      queryNonce: nextNonce,
      lastQueryAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.seedAddress, user.seedAddress));

  await getDb()
    .insert(stealthAddresses)
    .values({
      address: stealthAddressLower,
      ensSubdomain: subdomainName,
      salt: hash,
      triggered: false,
    })
    .onConflictDoUpdate({
      target: stealthAddresses.address,
      set: {
        ensSubdomain: subdomainName,
        salt: hash,
        triggered: false,
      },
    });

  if (gatewayDeps.onStealthAddressGenerated) {
    await gatewayDeps.onStealthAddressGenerated(stealthAddressLower, subdomainName);
  }

  return stealthAddress;
}

async function resolveCall(callData: Hex, name: string): Promise<Hex> {
  const subdomainName = extractSubdomain(name);

  for (const abiItem of resolverAbi) {
    try {
      const decoded = decodeFunctionData({ abi: [abiItem], data: callData });

      if (decoded.functionName === "text") {
        const [, key] = decoded.args as [Hex, string];
        const rows = await getDb()
          .select({ textRecords: users.textRecords })
          .from(users)
          .where(eq(users.ensSubdomain, subdomainName))
          .limit(1);
        const records = parseTextRecordJson(rows[0]?.textRecords);
        return encodeFunctionResult({ abi: [abiItem], functionName: "text", result: records[key] ?? "" });
      }

      if (decoded.functionName === "addr") {
        const args = decoded.args as [Hex] | [Hex, bigint];
        const coinType = args.length === 2 ? Number(args[1]) : 60;
        let addr = ZERO_ADDRESS;

        if (coinType === 60) {
          const stealthAddress = await resolveStealthAddress(subdomainName);
          if (stealthAddress) addr = stealthAddress;
        }

        if (coinType === 60 && args.length === 1) {
          return encodeFunctionResult({ abi: [abiItem], functionName: "addr", result: addr as `0x${string}` });
        }
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
      // Try next abi item.
    }
  }

  return "0x";
}

export async function handleGatewayRequest(req: Request, res: Response): Promise<void> {
  try {
    const { sender, data } = req.params;
    const callData = data.replace(/\.json$/, "") as Hex;

    if (!config.gatewaySignerPrivateKey) {
      res.status(503).json({ ok: false, error: "Gateway signer not configured" });
      return;
    }

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
    if (!name.endsWith(`.${config.ensDomain}`)) {
      res.status(404).json({ ok: false, error: `Name ${name} is not under ${config.ensDomain}` });
      return;
    }

    const result = await resolveCall(innerCallData, name);
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 300);
    const account = privateKeyToAccount(config.gatewaySignerPrivateKey as Hex);
    const requestHash = keccak256(callData);
    const messageHash = keccak256(
      encodePacked(
        ["bytes", "address", "uint64", "bytes32"],
        [result, sender as Hex, validUntil, requestHash]
      )
    );
    const signature = await account.signMessage({ message: { raw: messageHash } });
    const responseData = encodeAbiParameters(
      [
        { type: "bytes" },
        { type: "uint64" },
        { type: "bytes" },
      ],
      [result, validUntil, signature]
    );

    res.json({ data: responseData });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: message });
  }
}

export async function getSubdomainWithRecords(name: string) {
  const rows = await getDb().select().from(users).where(eq(users.ensSubdomain, name)).limit(1);
  const user = rows[0];
  if (!user) return null;

  const stealth = await getDb()
    .select()
    .from(stealthAddresses)
    .where(eq(stealthAddresses.ensSubdomain, name));

  return {
    name,
    ensSubdomain: user.ensSubdomain,
    seedAddress: user.seedAddress,
    coinType: user.coinType,
    queryNonce: user.queryNonce,
    lastQueryAt: user.lastQueryAt,
    text: Object.entries(parseTextRecordJson(user.textRecords)).map(([key, value]) => ({ key, value })),
    stealth: stealth.map((row: (typeof stealth)[number]) => ({
      address: row.address,
      salt: row.salt,
      triggered: row.triggered,
      createdAt: row.createdAt,
      lastTriggeredAt: row.lastTriggeredAt,
    })),
  };
}

export async function getAllSubdomains() {
  const rows = await getDb().select().from(users).where(isNotNull(users.ensSubdomain));
  const result = [];
  for (const row of rows) {
    if (!row.ensSubdomain) continue;
    const full = await getSubdomainWithRecords(row.ensSubdomain);
    if (full) result.push(full);
  }
  return result;
}

export async function registerSubdomain(
  name: string,
  _owner: string,
  seedAddress?: string,
  textRecords?: Array<{ key: string; value: string }>,
  addresses?: Array<{ coinType: number; address: string }>,
) {
  if (!seedAddress) throw new Error("seedAddress is required");

  const textJson = JSON.stringify(Object.fromEntries((textRecords ?? []).map((r) => [r.key, r.value])));
  await getDb()
    .insert(users)
    .values({
      seedAddress: seedAddress.toLowerCase(),
      ensSubdomain: name,
      textRecords: textJson,
      coinType: addresses?.[0]?.coinType ?? 60,
      queryNonce: 0,
    })
    .onConflictDoUpdate({
      target: users.seedAddress,
      set: {
        ensSubdomain: name,
        textRecords: textJson,
        coinType: addresses?.[0]?.coinType ?? 60,
        updatedAt: new Date(),
      },
    });
}

export async function getSubdomainByStealthAddress(address: string) {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return null;

  const rows = await getDb()
    .select()
    .from(stealthAddresses)
    .where(eq(stealthAddresses.address, normalized))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const sub = await getSubdomainWithRecords(row.ensSubdomain);
  if (!sub) return null;

  return {
    address: row.address,
    ensSubdomain: row.ensSubdomain,
    salt: row.salt,
    triggered: row.triggered,
    createdAt: row.createdAt,
    lastTriggeredAt: row.lastTriggeredAt,
    subdomain: sub,
  };
}

export async function getSubdomainBySeed(seedAddress: string) {
  const rows = await getDb()
    .select()
    .from(users)
    .where(eq(users.seedAddress, seedAddress.trim().toLowerCase()))
    .limit(1);
  const user = rows[0];
  if (!user?.ensSubdomain) return null;
  return getSubdomainWithRecords(user.ensSubdomain);
}

export async function markStealthAddressTriggered(address: string): Promise<void> {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return;

  await getDb()
    .update(stealthAddresses)
    .set({
      triggered: true,
      lastTriggeredAt: new Date(),
    })
    .where(eq(stealthAddresses.address, normalized));
}

export async function pruneStaleStealthAddresses(): Promise<number> {
  const cutoff = Date.now() - STALE_STEALTH_WINDOW_MS;
  const rows = await getDb().select().from(stealthAddresses);
  let removed = 0;
  for (const row of rows) {
    const createdAtMs = row.createdAt?.getTime() ?? 0;
    const triggeredAtMs = row.lastTriggeredAt?.getTime() ?? 0;
    if (createdAtMs >= cutoff || triggeredAtMs >= cutoff) continue;
    await getDb().delete(stealthAddresses).where(eq(stealthAddresses.address, row.address));
    removed += 1;
  }
  return removed;
}

export async function updateSubdomainTextRecords(
  name: string,
  textRecords: Array<{ key: string; value: string }>,
) {
  const rows = await getDb()
    .select({
      seedAddress: users.seedAddress,
      textRecords: users.textRecords,
    })
    .from(users)
    .where(eq(users.ensSubdomain, name))
    .limit(1);
  const user = rows[0];
  if (!user) return;

  const current = parseTextRecordJson(user.textRecords);
  for (const record of textRecords) {
    current[record.key] = record.value;
  }

  await getDb()
    .update(users)
    .set({
      textRecords: JSON.stringify(current),
      updatedAt: new Date(),
    })
    .where(eq(users.seedAddress, user.seedAddress));
}
