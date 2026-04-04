import { x25519, edwardsToMontgomeryPub } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { gcm } from "@noble/ciphers/aes";
import type { PolicyJson, PolicyToken } from "./utils";

// x25519 accepts any 32-byte value as a private key (it applies clamping internally),
// so we derive the key by hashing the wallet signature with SHA-256.

// ─── Constants ───────────────────────────────────────────────────────────────

const PAYLOAD_VERSION = 1;
const ENCRYPTED_PREFIX = "x25519:enc:";
const SIGN_MESSAGE = "kondor:derive-encryption-key";

// ─── Byte helpers ────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
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

// ─── Key derivation ──────────────────────────────────────────────────────────

/**
 * Derives an x25519 private key from a wallet signature.
 *
 * 1. Sign the fixed message → hex signature
 * 2. SHA-256 the signature bytes → 32 bytes
 * 3. Use directly as x25519 private key (x25519 clamps internally)
 */
export function deriveX25519PrivateKey(signatureHex: string): Uint8Array {
  const sigBytes = hexToBytes(signatureHex);
  return sha256(sigBytes);
}

/**
 * Converts a CRE Ed25519 public key (hex) to x25519.
 */
export function crePublicKeyToX25519(crePublicKeyHex: string): Uint8Array {
  const edPub = hexToBytes(crePublicKeyHex);
  return edwardsToMontgomeryPub(edPub);
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

function encryptString(
  plaintext: string,
  senderPrivX25519: Uint8Array,
  recipientPubX25519: Uint8Array
): string {
  const sharedSecret = x25519.getSharedSecret(senderPrivX25519, recipientPubX25519);
  const aesKey = hkdf(sha256, sharedSecret, undefined, undefined, 16);

  const iv = randomBytes(12);
  const cipher = gcm(aesKey, iv);
  const ciphertext = cipher.encrypt(new TextEncoder().encode(plaintext));

  // iv || ciphertext (includes GCM auth tag)
  const ct = new Uint8Array(iv.length + ciphertext.length);
  ct.set(iv, 0);
  ct.set(ciphertext, iv.length);

  const senderPub = x25519.getPublicKey(senderPrivX25519);

  const payload = {
    v: PAYLOAD_VERSION,
    pub: b64Encode(senderPub),
    ct: b64Encode(ct),
  };

  return ENCRYPTED_PREFIX + b64Encode(new TextEncoder().encode(JSON.stringify(payload)));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * The fixed message to sign for key derivation.
 */
export const ENCRYPTION_SIGN_MESSAGE = SIGN_MESSAGE;

/**
 * Encrypts a policy's token entries client-side.
 *
 * Each token's `conditions` and `elseActions` are encrypted into a ciphertext field.
 * The output format matches what the CRE expects: `x25519:enc:<base64 payload>`.
 *
 * @param policy - The plaintext policy from the flow builder
 * @param signatureHex - The hex signature from signing ENCRYPTION_SIGN_MESSAGE
 * @param crePublicKeyHex - The CRE's Ed25519 public key (hex)
 * @returns The policy with encrypted token entries ready for storage
 */
// ─── Decrypt ─────────────────────────────────────────────────────────────────

function decryptString(
  encryptedPayload: string,
  recipientPrivX25519: Uint8Array,
  senderPubX25519?: Uint8Array,
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

  const pubKey = senderPubX25519 ?? (parsed.pub ? b64Decode(parsed.pub) : null);
  if (!pubKey) throw new Error("Missing sender public key");

  const sharedSecret = x25519.getSharedSecret(recipientPrivX25519, pubKey);
  const aesKey = hkdf(sha256, sharedSecret, undefined, undefined, 16);
  const cipher = gcm(aesKey, iv);
  const plainBytes = cipher.decrypt(ciphertext);
  return new TextDecoder().decode(plainBytes);
}

/**
 * Decrypts a policy's encrypted token entries client-side.
 *
 * The user re-derives the same x25519 key by signing the same message,
 * then uses ECDH with the CRE's public key (same shared secret as encryption).
 *
 * @param encryptedTokens - The encrypted token entries from the text record
 * @param signatureHex - The hex signature from signing ENCRYPTION_SIGN_MESSAGE
 * @param crePublicKeyHex - The CRE's Ed25519 public key (hex)
 * @returns Decrypted policy tokens with plaintext conditions and elseActions
 */
export function decryptPolicy(
  encryptedTokens: { inputToken: string; inputDecimals: number; ciphertext: string }[],
  signatureHex: string,
  crePublicKeyHex: string,
): PolicyToken[] {
  const userPrivX = deriveX25519PrivateKey(signatureHex);
  const crePubX = crePublicKeyToX25519(crePublicKeyHex);

  return encryptedTokens.map((token) => {
    const decrypted = JSON.parse(
      decryptString(token.ciphertext, userPrivX, crePubX)
    ) as { conditions: PolicyToken["conditions"]; elseActions: PolicyToken["elseActions"] };

    return {
      inputToken: token.inputToken,
      inputDecimals: token.inputDecimals,
      conditions: decrypted.conditions,
      elseActions: decrypted.elseActions,
    };
  });
}

export function encryptPolicy(
  policy: PolicyJson,
  signatureHex: string,
  crePublicKeyHex: string
): {
  destinationChain: string;
  isRailgun: boolean;
  isOfframp: boolean;
  forwardTo: string;
  tokens: { inputToken: string; inputDecimals: number; ciphertext: string }[];
} {
  const senderPrivX = deriveX25519PrivateKey(signatureHex);
  const recipientPubX = crePublicKeyToX25519(crePublicKeyHex);

  const encryptedTokens = policy.tokens.map((token: PolicyToken) => {
    const plaintext = JSON.stringify({
      conditions: token.conditions,
      elseActions: token.elseActions,
    });

    return {
      inputToken: token.inputToken,
      inputDecimals: token.inputDecimals,
      ciphertext: encryptString(plaintext, senderPrivX, recipientPubX),
    };
  });

  return {
    destinationChain: policy.destinationChain,
    isRailgun: policy.isRailgun,
    isOfframp: policy.isOfframp,
    forwardTo: policy.forwardTo,
    tokens: encryptedTokens,
  };
}
