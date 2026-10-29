# AGENTS.md

Instructions for all coding agents that work in this repo.

This repo is **Strata**. Use that name for the project, package and UI; the core domain object is a **Change**.

Read `SPEC.md` before doing anything. It is the source of truth for what we're building and why.

## Working rules

- Start in plan mode. Propose a stack and architecture for the "Suggested first milestone" in SPEC.md, list open questions, and wait for approval before writing code.
- Build only the first milestone. Note anything else as a follow-up rather than building it.
- Prefer deterministic analysis (parsers, schema/migration readers, git) over LLM judgement wherever possible; use the LLM for classification, interpretation and annotation.
- Every claim the product makes must link to evidence (hunk, requirement, artifact). No evidence → don't show the claim.
- Treat PR boundaries as hints only. Output must not depend on how code is split (see the shape-invariance benchmark).
- Keep secrets out of the repo. Redact transcripts before storing them.
- Write tests for layer classification and shape invariance from the start.
- Write all user-facing text in ASD-STE100 Simplified Technical English (see below).

## Preferences

- TypeScript by default; Python is fine for analysis tooling if it's clearly the better fit. Justify the choice in the plan.
- Small, reviewable commits with clear messages.

## Write all user-facing text in ASD-STE100

Strata writes all text that a person reads in ASD-STE100 Simplified Technical English (STE). This applies to:

- UI copy in `apps/web`: labels, headings, help text, tooltips, empty states, errors and status lines.
- Messages from the server and the CLI that a person sees: API errors, progress steps, issues, notes and the CLI help.
- Text that the core and the engine put in a report: layer reasons, stack issues, notes and the reasons that GitHub's diff is different.
- Text that an LLM writes for a person. Every prompt whose answer a person reads must include `STE_RULE` from `packages/engine/src/llm.ts`. When you change a prompt, increase its `PROMPT_VERSION`.

### The rules to apply

- Write short sentences. Use 20 words or fewer for an instruction, and 25 words or fewer for a description.
- Put one topic in each sentence, and one instruction in each sentence.
- Use the active voice. Name who or what does the action: "Strata cannot find the commit", not "The commit could not be found".
- Use only the simple tenses: present, simple past and future.
- Use the imperative for instructions: "Try again", "Select a path outside the checkout".
- Use the approved STE words, with their approved meanings. Use one word for one meaning. For example, use "select" (not "choose" or "pick"), "cannot find" (not "can't tell"), and "thus" or a new sentence (not ", so").
- Do not use contractions: "is not", "cannot", "does not".
- Do not use phrasal verbs: "start", not "set up"; "go back", not "back out".
- Do not use -ing forms, except in technical names. For a progress step, write a sentence: "Strata reads the PRs in acme/app", not "Reading acme/app's PRs".
- Use "a", "an" and "the" where English permits them.
- You can use technical names as they are: paths, code symbols, product names, git and GitHub terms (PR, branch, commit, hunk, diff, rebase, restack, force-push, trunk), and Strata's own terms (Change, stack, layer, Guide, whole-stack diff, mechanical).

### Permitted exceptions

- A status or control label of one word can show a state or progress: "Running", "Analysing", "Opening…", "Searching…".
- Strata uses British spelling ("analyse", "summarise"). Do not change it.
- Prompts to an LLM, code comments and test names are not user-facing. STE is not necessary there, but keep them clear.

### Tests

Many tests assert on copy. When you change a string, change the test that asserts on it, and also the quoted text in `.claude/skills/verify/features/`.
