import { describe, expect, test } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
  hashSharePassword,
  hashToken,
  verifySharePassword,
} from "./crypto.js";

describe("secret encryption", () => {
  test("round-trips encrypted secrets without storing plaintext", () => {
    const encrypted = encryptSecret("ghp_user_secret", "dev-secret-for-tests");

    expect(encrypted).not.toContain("ghp_user_secret");
    expect(decryptSecret(encrypted, "dev-secret-for-tests")).toBe(
      "ghp_user_secret"
    );
  });

  test("rejects secrets encrypted with a different key", () => {
    const encrypted = encryptSecret("ghp_user_secret", "dev-secret-for-tests");

    expect(() => decryptSecret(encrypted, "different-secret")).toThrow();
  });
});

describe("share password hashing", () => {
  test("hashes with a salted scrypt KDF, not bare SHA-256", () => {
    const hash = hashSharePassword("hunter2");

    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toBe(hashToken("hunter2"));
    expect(hash.split("$")).toHaveLength(3);
  });

  test("uses a random per-password salt", () => {
    expect(hashSharePassword("hunter2")).not.toBe(hashSharePassword("hunter2"));
  });

  test("verifies the correct password and rejects the wrong one", () => {
    const hash = hashSharePassword("hunter2");

    expect(verifySharePassword("hunter2", hash)).toBe(true);
    expect(verifySharePassword("wrong", hash)).toBe(false);
  });

  test("accepts legacy bare-sha256 hashes for backward compat", () => {
    const legacy = hashToken("legacy-pass");

    expect(verifySharePassword("legacy-pass", legacy)).toBe(true);
    expect(verifySharePassword("nope", legacy)).toBe(false);
  });

  test("rejects malformed scrypt-prefixed hashes", () => {
    expect(verifySharePassword("anything", "scrypt$onlyonepart")).toBe(false);
  });
});
