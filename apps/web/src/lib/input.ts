/**
 * What Strata will do with the text in the input box, said back before it's
 * sent, so a typo shows up before the server spends time on it.
 */
import { type ChangeInput, ChangeInputError, parseChangeInput } from "@strata/core/model";

export type InputHint =
  | { ok: true; input: ChangeInput; text: string }
  | { ok: false; text: string };

export function inputHint(raw: string): InputHint | null {
  if (!raw.trim()) return null;
  let input: ChangeInput;
  try {
    input = parseChangeInput(raw);
  } catch (error) {
    if (error instanceof ChangeInputError) {
      return { ok: false, text: "Use a PR URL, owner/repo#123 or owner/repo:branch." };
    }
    throw error;
  }
  const repo = input.repo.kind === "github" ? `${input.repo.owner}/${input.repo.name}` : "";
  switch (input.kind) {
    case "stack-of":
      return {
        ok: true,
        input,
        text:
          "pr" in input.seed
            ? `The stack around #${input.seed.pr} in ${repo}.`
            : `The stack around the PR for ${input.seed.branch} in ${repo}.`,
      };
    case "stack":
      return {
        ok: true,
        input,
        text: `The chain ${input.numbers.map((n) => `#${n}`).join(" → ")} in ${repo}.`,
      };
    case "range":
      return { ok: false, text: "Commit ranges aren't supported yet. Give a PR or a branch." };
  }
}
