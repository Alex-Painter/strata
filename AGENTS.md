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
- Make Claude write generated text in ASD-STE100 Simplified Technical English, except Ask answers; write UI copy and Ask answers in plain, natural language (see below).

## Preferences

- TypeScript by default; Python is fine for analysis tooling if it's clearly the better fit. Justify the choice in the plan.
- Small, reviewable commits with clear messages.

## Cost

Every plan and every change that adds or changes a Claude call, or adds heavy compute, states its cost before it is built:

- Which calls it adds, the model for each (`DEFAULT_MODELS` in `packages/engine/src/api.ts`), and what triggers them.
- The cache key, and whether a rebase or a restack keeps the cache warm.
- An estimate in tokens and dollars per Change and per month, from the prices in `packages/engine/src/llm.ts`. Check real numbers with `strata usage` where you can.
- Disk and CPU, for indexes, clones and caches.

Defaults: no Claude call on a run that nobody opens; one request per Change, not one per item; the cheapest model that passes a side-by-side check; a new task name in the usage log for every new kind of call.

## UI rules

- Everything clickable (buttons, links, rows that open something, checkboxes, toggles) shows `cursor: pointer`, whatever a UI library or Tailwind's preflight sets by default. A disabled control shows `not-allowed`. The base rule is in `apps/web/src/styles.css`; a new clickable element that it does not match gets `cursor-pointer`.

## Copy and generated text

### UI copy: plain and natural

Text that Strata itself shows (UI copy in `apps/web`, status and progress lines, loading and empty states, errors, server and CLI messages, notes in a report) is written in plain, concise UI language. It is not held to ASD-STE100.

- Status and progress lines are short -ing phrases: "Refreshing report…", "Fetching branches and 9 PR heads from acme/app", "Loading Change…". Do not write them as sentences about Strata ("Strata fetches the branches…").
- Progress steps from the engine and the server have no trailing "…" or full stop; the UI adds the ellipsis.
- Empty states are short: "No report yet.", "Nothing matches your search."
- Do not name Claude as the actor in the UI ("Writing summaries", not "Claude writes the summaries").
- Strata uses British spelling ("analyse", "summarise"). Do not change it.

### Generated text: ASD-STE100

Text that an LLM writes for a person (summaries, the why paragraph, the Guide, layer reasons) is in ASD-STE100 Simplified Technical English (STE). Every such prompt must include `STE_RULE` from `packages/engine/src/llm.ts`.

Ask (chat) answers are the exception: they are plain, natural English and do not include `STE_RULE`. When you change a prompt, increase its `PROMPT_VERSION`. `STE_RULE` holds the rules that Claude follows.

### Tests

Many tests assert on copy. When you change a string, change the test that asserts on it, and also the quoted text in `.claude/skills/verify/features/`.
