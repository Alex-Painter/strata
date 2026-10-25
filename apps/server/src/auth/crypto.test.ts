import { describe, expect, it } from "vitest";
import { createTokenCipher, hashToken, newId, newSessionToken } from "./crypto.js";

describe("token cipher", () => {
  const cipher = createTokenCipher("a".repeat(32));

  it("round-trips and never stores plaintext", () => {
    const sealed = cipher.encrypt("gho_example");
    expect(sealed).not.toContain("gho_example");
    expect(cipher.decrypt(sealed)).toBe("gho_example");
    // A fresh IV each time.
    expect(cipher.encrypt("gho_example")).not.toBe(sealed);
  });

  it("rejects tampered values and values from another secret", () => {
    const sealed = cipher.encrypt("gho_example");
    const parts = sealed.split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(() => cipher.decrypt(parts.join("."))).toThrow();
    expect(() => createTokenCipher("b".repeat(32)).decrypt(sealed)).toThrow();
    expect(() => cipher.decrypt("not-a-token")).toThrow();
  });
});

describe("ids and session tokens", () => {
  it("are random and prefixed", () => {
    expect(newId("usr")).toMatch(/^usr_[A-Za-z0-9_-]{16}$/);
    expect(newSessionToken()).not.toBe(newSessionToken());
    expect(hashToken("t")).toHaveLength(64);
  });
});
