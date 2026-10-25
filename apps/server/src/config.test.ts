import os from "node:os";
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

  it("reads GitHub stand-ins locally and ignores them in production", () => {
    const standIns = {
      DEV_GITHUB_GRAPHQL_URL: "http://localhost:9000/graphql",
      DEV_GIT_REMOTE: "/tmp/fixture/{repo}",
    };
    expect(loadConfig({ DEV_AUTH_BYPASS: "1", ...standIns }).devGitHub).toEqual({
      graphqlUrl: "http://localhost:9000/graphql",
      gitRemote: "/tmp/fixture/{repo}",
    });
    expect(loadConfig({ DEV_AUTH_BYPASS: "1" }).devGitHub).toBeNull();
    const production = loadConfig({ ...PRODUCTION, ...standIns });
    expect(production.devGitHub).toBeNull();
    expect(production.warnings).toContain(
      "DEV_GITHUB_GRAPHQL_URL and DEV_GIT_REMOTE are ignored in production.",
    );
  });

  it("runs locally with only the dev bypass", () => {
    const config = loadConfig({ DEV_AUTH_BYPASS: "1", DEV_GITHUB_LOGIN: "alex" });
    expect(config.devBypass).toEqual({ login: "alex", githubToken: null });
    expect(config.github).toBeNull();
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("reads local checkouts, expanding ~", () => {
    const config = loadConfig({
      ...PRODUCTION,
      STRATA_CHECKOUTS: "GlyphicAI/maverick-backend=~/workspace/maverick-backend, a/b=/srv/b/",
    });
    expect(config.checkouts).toEqual({
      "GlyphicAI/maverick-backend": `${os.homedir()}/workspace/maverick-backend`,
      "a/b": "/srv/b/",
    });
  });

  it("rejects checkouts it can't read", () => {
    expect(() => loadConfig({ ...PRODUCTION, STRATA_CHECKOUTS: "maverick=/x" })).toThrow(
      /owner\/name=\/path/,
    );
    expect(() => loadConfig({ ...PRODUCTION, STRATA_CHECKOUTS: "a/b=relative/x" })).toThrow(
      /must be absolute/,
    );
  });
});
