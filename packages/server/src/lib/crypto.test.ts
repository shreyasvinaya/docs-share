import { describe, expect, test } from "bun:test";
import { decryptSecret, encryptSecret } from "./crypto.js";

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
