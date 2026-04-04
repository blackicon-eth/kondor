import { ed25519 } from "@noble/curves/ed25519";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { gcm } from "@noble/ciphers/aes";

const PAYLOAD_VERSION = 1;
const ENCRYPTED_PREFIX = "x25519:enc:";

// ---------------------------------------------------------------------------
// Byte / hex helpers
// ---------------------------------------------------------------------------

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, "");
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    bytes[i / 2] = parseInt(h.substring(i, i + 2), 16);
  }
  return bytes;
}

function b64Encode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64Decode(s: string): Uint8Array {
  let base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) base64 += "=".repeat(4 - pad);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Key conversion
// ---------------------------------------------------------------------------

export function ed25519PubToX25519(pub: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomery(pub);
}

export function ed25519PrivToX25519(priv: Uint8Array): Uint8Array {
  // @noble/curves ≥1.9.6 renamed this to `toMontgomeryPriv`
  const utils = ed25519.utils as Record<string, unknown>;
  const fn = (utils.toMontgomeryPriv ?? utils.toMontgomerySecret) as (
    k: Uint8Array,
  ) => Uint8Array;
  return fn(priv);
}

// ---------------------------------------------------------------------------
// Shared secret + key derivation
// ---------------------------------------------------------------------------

function computeSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

function deriveAesKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, undefined, undefined, 16);
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

export function encrypt(
  plaintext: string,
  senderPrivateKeyX25519: Uint8Array,
  recipientPublicKeyX25519: Uint8Array,
): string {
  const sharedSecret = computeSharedSecret(
    senderPrivateKeyX25519,
    recipientPublicKeyX25519,
  );
  const aesKey = deriveAesKey(sharedSecret);

  const iv = randomBytes(12);
  const cipher = gcm(aesKey, iv);
  const plainBytes = new TextEncoder().encode(plaintext);
  const ciphertext = cipher.encrypt(plainBytes);

  // iv || ciphertext (includes GCM auth tag)
  const ct = new Uint8Array(iv.length + ciphertext.length);
  ct.set(iv, 0);
  ct.set(ciphertext, iv.length);

  const senderPub = x25519.getPublicKey(senderPrivateKeyX25519);

  const payload = {
    v: PAYLOAD_VERSION,
    pub: b64Encode(senderPub),
    ct: b64Encode(ct),
  };

  return (
    ENCRYPTED_PREFIX +
    b64Encode(new TextEncoder().encode(JSON.stringify(payload)))
  );
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

export function decrypt(
  encryptedPayload: string,
  privateKey: Uint8Array,
  otherPartyPublicKey?: Uint8Array,
): string {
  const raw = encryptedPayload.startsWith(ENCRYPTED_PREFIX)
    ? encryptedPayload.slice(ENCRYPTED_PREFIX.length)
    : encryptedPayload;

  const parsed = JSON.parse(new TextDecoder().decode(b64Decode(raw)));
  if (parsed.v !== PAYLOAD_VERSION || !parsed.ct) {
    throw new Error("Unsupported payload version or missing ciphertext");
  }

  const ctBytes = b64Decode(parsed.ct);
  const iv = ctBytes.slice(0, 12);
  const ciphertext = ctBytes.slice(12);

  const pubKey =
    otherPartyPublicKey ?? (parsed.pub ? b64Decode(parsed.pub) : null);
  if (!pubKey) throw new Error("Missing other party public key");

  const sharedSecret = computeSharedSecret(privateKey, pubKey);
  const aesKey = deriveAesKey(sharedSecret);
  const cipher = gcm(aesKey, iv);
  const plainBytes = cipher.decrypt(ciphertext);
  return new TextDecoder().decode(plainBytes);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isEncrypted(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.startsWith(ENCRYPTED_PREFIX)) return true;
  return value.startsWith("eyJ") && value.length > 50;
}
