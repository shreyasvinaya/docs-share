import { createId } from "@paralleldrive/cuid2";

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
  const token = `ds_${raw}`;
  const prefix = token.slice(0, 8);
  const hash = hashToken(token);
  return { token, hash, prefix };
}

export function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  return hasher.digest("hex");
}

export function generatePublicToken(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(randomBytes).toString("base64url");
}
