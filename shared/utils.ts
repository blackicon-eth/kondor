import crypto from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3";

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** EIP-55 mixed-case checksum for an Ethereum address. */
export function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, "");
  const hashBytes = keccak_256(new TextEncoder().encode(addr));
  const hash = Buffer.from(hashBytes).toString("hex");
  let checksummed = "0x";
  for (let i = 0; i < addr.length; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return checksummed;
}

export function dedupeNormalized(addresses: string[]): string[] {
  return [...new Set(addresses.map(normalizeAddress))];
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function verifyAlchemySignature(
  rawBody: Buffer,
  signatureHex: string,
  signingKey: string
): boolean {
  const expected = crypto.createHmac("sha256", signingKey).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signatureHex, "hex"));
}
