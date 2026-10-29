import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadRepoSettings,
  SettingsError,
  saveSendCodeToAnthropic,
  settingsPath,
} from "./settings.js";

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "strata-settings-"));
});
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function write(value: unknown) {
  const path = settingsPath(dataDir, "acme/app");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

describe("repo settings", () => {
  it("live in the data folder, and default to off", async () => {
    expect(settingsPath(dataDir, "acme/app")).toBe(join(dataDir, "settings", "acme", "app.json"));
    expect(await loadRepoSettings(dataDir, "acme/app")).toEqual({
      layerRules: [],
      sendCodeToAnthropic: false,
    });
  });

  it("read layer rules and the Anthropic opt-in", async () => {
    const rule = { id: "billing", layer: "data-model", paths: ["billing/**"], reason: "Money" };
    await write({ layerRules: [rule], sendCodeToAnthropic: true });
    expect(await loadRepoSettings(dataDir, "acme/app")).toEqual({
      layerRules: [rule],
      sendCodeToAnthropic: true,
    });
  });

  it("turn the Anthropic opt-in on and off, and keep the rest of the file", async () => {
    // With no file, Strata makes one.
    await saveSendCodeToAnthropic(dataDir, "acme/app", true);
    expect(await loadRepoSettings(dataDir, "acme/app")).toEqual({
      layerRules: [],
      sendCodeToAnthropic: true,
    });

    const rule = { id: "billing", layer: "data-model", paths: ["billing/**"], reason: "Money" };
    const path = await write({ layerRules: [rule], sendCodeToAnthropic: true });
    expect(await saveSendCodeToAnthropic(dataDir, "acme/app", false)).toEqual({
      layerRules: [rule],
      sendCodeToAnthropic: false,
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      layerRules: [rule],
      sendCodeToAnthropic: false,
    });

    // A file someone broke by hand stays as it is.
    await write("{ not json");
    await expect(saveSendCodeToAnthropic(dataDir, "acme/app", true)).rejects.toThrow(SettingsError);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it("say what's wrong with a bad file", async () => {
    const path = await write({ layerRules: [{ id: "x", layer: "db", paths: ["*"], reason: "r" }] });
    await expect(loadRepoSettings(dataDir, "acme/app")).rejects.toThrow(
      new SettingsError(
        `${path}: layerRules[0].layer must be one of data-model, api, logic, ui, tests, config, docs, other.`,
      ),
    );
    await write({ sendCodeToAnthropic: "yes" });
    await expect(loadRepoSettings(dataDir, "acme/app")).rejects.toThrow(
      "sendCodeToAnthropic must be true or false.",
    );
    await write({ layerRule: [] });
    await expect(loadRepoSettings(dataDir, "acme/app")).rejects.toThrow(
      'unknown setting "layerRule".',
    );
    await write("{ nope");
    await expect(loadRepoSettings(dataDir, "acme/app")).rejects.toThrow("is not valid JSON");
  });
});
