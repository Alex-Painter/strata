/**
 * Small crypto helpers for sessions and stored GitHub tokens.
 *
 * Session tokens are random and only their SHA-256 is stored, so a leaked
 * database can't be replayed as cookies. GitHub tokens are needed again later
 * (to fetch PRs and clone), so they are encrypted rather than hashed, with a
 * key derived from SESSION_SECRET. Rotating that secret signs everyone out and
 * makes stored tokens unreadable, which forces a fresh sign-in: acceptable.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface TokenCipher {
  encrypt(plaintext: string): string;
  /** Throws if the value was tampered with or encrypted under another secret. */
  decrypt(value: string): string;
}

const VERSION = "v1";

export function createTokenCipher(secret: string): TokenCipher {
  const key = Buffer.from(hkdfSync("sha256", secret, "strata", "github-token-encryption", 32));
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv, body, tag]
        .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
        .join(".");
    },
    decrypt(value) {
      const [version, iv, body, tag] = value.split(".");
      if (version !== VERSION || !iv || body === undefined || !tag) {
        throw new Error("Unrecognised encrypted token format");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
