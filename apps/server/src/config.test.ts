import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const PRODUCTION = {
  NODE_ENV: "production",
  PUBLIC_URL: "https://strata.example.com",
  SESSION_SECRET: "x".repeat(32),
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  ALLOWED_GITHUB_LOGINS: "Alex-Painter, someone",
};

describe("loadConfig", () => {
  it("accepts a complete production config", () => {
    const config = loadConfig(PRODUCTION);
    expect(config.dataDir).toBe("/data");
    expect([...config.allowedLogins]).toEqual(["alex-painter", "someone"]);
    expect(config.devBypass).toBeNull();
  });

  it("lists every production problem at once", () => {
    const error = (() => {
      try {
        loadConfig({ NODE_ENV: "production" });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).problems).toHaveLength(3);
  });

  it("never enables the dev bypass in production", () => {
    const config = loadConfig({
      ...PRODUCTION,
      DEV_AUTH_BYPASS: "1",
      DEV_GITHUB_LOGIN: "intruder",
    });
    expect(config.devBypass).toBeNull();
    expect(config.warnings).toContain("DEV_AUTH_BYPASS is ignored in production.");
  });

  it("runs locally with only the dev bypass", () => {
    const config = loadConfig({ DEV_AUTH_BYPASS: "1", DEV_GITHUB_LOGIN: "alex" });
    expect(config.devBypass).toEqual({ login: "alex", githubToken: null });
    expect(config.github).toBeNull();
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });
});
