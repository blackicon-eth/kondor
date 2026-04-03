import { Request, Response } from "express";
import {
  encodeFunctionResult,
  decodeFunctionData,
  namehash,
  keccak256,
  encodeAbiParameters,
  encodePacked,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db.js";
import { config } from "./config";
import { subdomains, subdomainTextRecords, subdomainAddresses } from "../../shared/db/db.schema.js";

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

// ── Subdomain name from node hash lookup ─────────────────────────────

async function lookupSubdomainByNode(node: Hex): Promise<string | null> {
  // We can't reverse a namehash, so we look up all subdomains and find the match
  const allSubs = await getDb().select({ name: subdomains.name }).from(subdomains);
  for (const sub of allSubs) {
    const fullName = `${sub.name}.${config.ensDomain}`;
    if (namehash(fullName) === node) return sub.name;
  }
  return null;
}

// ── Resolve function ─────────────────────────────────────────────────

async function resolveCall(callData: Hex, name: string): Promise<Hex> {
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

        const addr = record[0]?.address ?? "0x0000000000000000000000000000000000000000";

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

    const result = await resolveCall(innerCallData, name);

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

  return {
    ...sub[0],
    text: textRecords.map((r) => ({ key: r.key, value: r.value })),
    addresses: addressRecords.map((r) => ({ coinType: r.coinType, address: r.address })),
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
    results.push({
      name: sub.name,
      owner: sub.owner,
      text: textRecords.map((r) => ({ key: r.key, value: r.value })),
      addresses: addressRecords.map((r) => ({ coinType: r.coinType, address: r.address })),
    });
  }
  return results;
}

export async function registerSubdomain(
  name: string,
  owner: string,
  textRecords?: Array<{ key: string; value: string }>,
  addresses?: Array<{ coinType: number; address: string }>,
) {
  await getDb().insert(subdomains).values({ name, owner });

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
