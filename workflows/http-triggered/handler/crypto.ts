import { ed25519 } from "@noble/curves/ed25519";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { gcm } from "@noble/ciphers/aes";

const PAYLOAD_VERSION = 1;
const ENCRYPTED_PREFIX = "rns:enc:";

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, "");
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    bytes[i / 2] = parseInt(h.substring(i, i + 2), 16);
  }
  return bytes;
}

export function ed25519PrivToX25519(priv: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomeryPriv(priv);
}

function b64Decode(s: string): Uint8Array {
  let base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) base64 += "=".repeat(4 - pad);

  if (typeof atob !== "undefined") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function fromStorageFormat(value: string): string {
  return value.startsWith(ENCRYPTED_PREFIX) ? value : ENCRYPTED_PREFIX + value;
}

function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

function deriveAesKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, undefined, undefined, 16);
}

export function decrypt(
  encryptedPayload: string,
  privateKey: Uint8Array,
  otherPartyPublicKey?: Uint8Array,
): string {
  const payload = fromStorageFormat(encryptedPayload);
  const raw = payload.startsWith(ENCRYPTED_PREFIX)
    ? payload.slice(ENCRYPTED_PREFIX.length)
    : payload;

  const parsed = JSON.parse(new TextDecoder().decode(b64Decode(raw)));
  if (parsed.v !== PAYLOAD_VERSION || !parsed.ct) {
    throw new Error("Unsupported payload version or missing ciphertext");
  }

  const ctBytes = b64Decode(parsed.ct);
  const iv = ctBytes.slice(0, 12);
  const ciphertext = ctBytes.slice(12);

  const pubKey = otherPartyPublicKey ?? (parsed.pub ? b64Decode(parsed.pub) : null);
  if (!pubKey) throw new Error("Missing other party public key");

  const sharedSecret = computeSharedSecret(privateKey, pubKey);
  const aesKey = deriveAesKey(sharedSecret);
  const cipher = gcm(aesKey, iv);
  const plainBytes = cipher.decrypt(ciphertext);
  return new TextDecoder().decode(plainBytes);
}

export function isEncrypted(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.startsWith(ENCRYPTED_PREFIX)) return true;
  return value.startsWith("eyJ") && value.length > 50;
}
