/**
 * A repo's own Strata settings, kept in Strata's data folder and never in the
 * repo itself: `<dataDir>/settings/<owner>/<name>.json`. With no file, every
 * setting is off or empty.
 *
 *   {
 *     "layerRules": [
 *       { "id": "billing", "layer": "data-model", "paths": ["billing/**"],
 *         "reason": "Billing is always inspected" }
 *     ],
 *     "sendCodeToAnthropic": true
 *   }
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LAYER_IDS, type LayerId, type LayerRule } from "@strata/core";

export interface RepoSettings {
  /** Run before Strata's default layer rules. */
  layerRules: LayerRule[];
  /** Whether this repo's code may go to the Anthropic API. Off unless the file says so. */
  sendCodeToAnthropic: boolean;
}

export class SettingsError extends Error {}

export function settingsPath(dataDir: string, repo: string): string {
  const [owner, name] = repo.split("/") as [string, string];
  return join(dataDir, "settings", owner, `${name}.json`);
}

export async function loadRepoSettings(dataDir: string, repo: string): Promise<RepoSettings> {
  const path = settingsPath(dataDir, repo);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { layerRules: [], sendCodeToAnthropic: false };
    }
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new SettingsError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseSettings(raw, path);
}

export function parseSettings(raw: unknown, path: string): RepoSettings {
  const fail = (what: string): never => {
    throw new SettingsError(`${path}: ${what}`);
  };
  if (!isObject(raw)) return fail("expected an object.");
  const unknown = Object.keys(raw).filter(
    (key) => key !== "layerRules" && key !== "sendCodeToAnthropic",
  );
  if (unknown.length > 0) fail(`unknown setting ${unknown.map((key) => `"${key}"`).join(", ")}.`);

  const rules = raw.layerRules ?? [];
  if (!Array.isArray(rules)) fail("layerRules must be a list.");
  const layerRules = (rules as unknown[]).map((rule, i): LayerRule => {
    const at = `layerRules[${i}]`;
    if (!isObject(rule)) return fail(`${at} must be an object.`);
    const { id, layer, paths, reason } = rule;
    if (typeof id !== "string" || id === "") fail(`${at}.id must be a name.`);
    if (!LAYER_IDS.includes(layer as LayerId)) {
      fail(`${at}.layer must be one of ${LAYER_IDS.join(", ")}.`);
    }
    if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === "string")) {
      fail(`${at}.paths must be a list of globs.`);
    }
    if (typeof reason !== "string" || reason === "") fail(`${at}.reason must say why.`);
    return {
      id: id as string,
      layer: layer as LayerId,
      paths: paths as string[],
      reason: reason as string,
    };
  });

  const send = raw.sendCodeToAnthropic ?? false;
  if (typeof send !== "boolean") fail("sendCodeToAnthropic must be true or false.");
  return { layerRules, sendCodeToAnthropic: send as boolean };
}

/**
 * Turns sending this repo's code to the Anthropic API on or off, keeping the
 * rest of the file as it is. A file Strata cannot parse stays untouched.
 */
export async function saveSendCodeToAnthropic(
  dataDir: string,
  repo: string,
  send: boolean,
): Promise<RepoSettings> {
  const path = settingsPath(dataDir, repo);
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    parseSettings(parsed, path);
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof SettingsError) throw error;
      throw new SettingsError(`${path} is not valid JSON: ${(error as Error).message}`);
    }
  }
  const next = { ...raw, sendCodeToAnthropic: send };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return parseSettings(next, path);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
