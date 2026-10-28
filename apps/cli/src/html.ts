/**
 * The review page: the static build of the web app with a report in it,
 * following the contract in apps/web/src/lib/static-report.ts. Pages and
 * JSON go to Strata's data folder unless told otherwise, and never into a
 * git checkout, so a page of work code can't be committed by accident.
 */
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangeReport } from "@strata/core";

/** The web app's one-file build, which `pnpm --filter @strata/web build` writes. */
export const TEMPLATE = fileURLToPath(new URL("../../web/dist-static/index.html", import.meta.url));

export class OutputError extends Error {}

export async function readTemplate(file: string = TEMPLATE): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    throw new OutputError(
      `Strata makes the review page from the web app, but ${file} is not there. ` +
        "Build it with pnpm --filter @strata/web build.",
    );
  }
}

export function injectReport(template: string, report: ChangeReport): string {
  const at = template.indexOf("</head>");
  if (at === -1)
    throw new Error("The web app's static build does not have </head>. Build it again.");
  // Escaping "<" means report text can never close the script tag or open a
  // comment; U+2028/2029 are escaped for older JavaScript parsers.
  const json = JSON.stringify(report)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const tag = `<script id="strata-report" type="application/json">${json}</script>`;
  return template.slice(0, at) + tag + template.slice(at);
}

/** Where reports go when no path is given. */
export function reportsDir(dataDir: string): string {
  return path.join(path.resolve(dataDir), "reports");
}

/**
 * The page and JSON paths for a report: `--out` and `--json` when given,
 * otherwise reports/<owner>/<name>/<change id>.html in the data folder, with
 * the JSON next to the page.
 */
export function reportPaths(
  dataDir: string,
  report: ChangeReport,
  options: { out?: string; json?: string } = {},
): { page: string; json: string } {
  const { repo } = report.change;
  const folder =
    repo.kind === "github"
      ? path.join(reportsDir(dataDir), repo.owner, repo.name)
      : path.join(reportsDir(dataDir), "local", path.basename(repo.path));
  const page = path.resolve(options.out ?? path.join(folder, `${report.change.id}.html`));
  const json = path.resolve(options.json ?? `${page.replace(/\.html?$/i, "")}.json`);
  return { page, json };
}

/** The checkout `file` is in, or would be once written: the nearest folder above it with a .git. */
export async function checkoutAround(file: string): Promise<string | null> {
  let dir = await nearestReal(path.resolve(file));
  for (;;) {
    if (await exists(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Throws unless every file is outside every checkout. */
export async function refuseCheckouts(files: string[]): Promise<void> {
  for (const file of files) {
    const checkout = await checkoutAround(file);
    if (checkout) {
      throw new OutputError(
        `Strata does not write to ${path.resolve(file)}. It is in the git checkout ${checkout}, ` +
          "where somebody can commit it by accident. Select a path outside the checkout.",
      );
    }
  }
}

/** Writes a file, making its folder; call refuseCheckouts first. */
export async function writeOutput(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/**
 * `file` with symlinks resolved, or its nearest folder that exists: a folder
 * that doesn't exist yet can't hold a .git, but one it would be made in can.
 */
async function nearestReal(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch {
    const up = path.dirname(file);
    return up === file ? file : nearestReal(up);
  }
}

function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}
