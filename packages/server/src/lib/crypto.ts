import { createId } from "@paralleldrive/cuid2";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

export function generateId(): string {
  return createId();
}

export function generateApiToken(): {
  token: string;
  hash: string;
  prefix: string;
} {
  const randomBytes = crypto.getRandomValues(new Uint8Array(30));
  const raw = Buffer.from(randomBytes).toString("base64url");
  const token = `pat_${raw}`;
  const prefix = token.slice(0, 8);
  const hash = hashToken(token);
  return { token, hash, prefix };
}

export function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  return hasher.digest("hex");
}

// Share/view-link passwords are hashed with a salted slow KDF (scrypt) and
// stored as a self-describing string: `scrypt$<saltB64>$<hashB64>`. This is
// distinct from API-token hashing (hashToken), which stays a fast SHA-256.
const SCRYPT_KEYLEN = 64;

export function hashSharePassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifySharePassword(
  password: string,
  storedHash: string
): boolean {
  if (storedHash.startsWith("scrypt$")) {
    const [, saltB64, hashB64] = storedHash.split("$");
    if (!saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    let derived: Buffer;
    try {
      derived = scryptSync(password, salt, expected.length);
    } catch {
      return false;
    }
    return (
      expected.length === derived.length && timingSafeEqual(expected, derived)
    );
  }

  // Legacy backward compat: bare single-round SHA-256 hex digest.
  const legacy = Buffer.from(hashToken(password), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  return legacy.length === stored.length && timingSafeEqual(legacy, stored);
}

export function generatePublicToken(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(randomBytes).toString("base64url");
}

export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSecret(encrypted: string, secret: string): string {
  const [ivValue, tagValue, ciphertextValue] = encrypted.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Invalid encrypted secret");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    secretKey(secret),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function secretKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}
