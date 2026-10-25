# CLAUDE.md

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

## Preferences
- TypeScript by default; Python is fine for analysis tooling if it's clearly the better fit. Justify the choice in the plan.
- Small, reviewable commits with clear messages.
