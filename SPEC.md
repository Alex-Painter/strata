# Strata — product spec

**Strata** is the product name: the semantic layers stacked from intent (PRD/design) up through data model, API, UI and tests. Inside Strata, the unit of work is still called a **Change**.

## One-liner
Agents make the code match the intent. This tool helps humans make sure the intent is right, and gives justified confidence to ship without reading code.

## Core assumption
Teams are already close to not reviewing code. Agents will reliably build what they were told. What remains for humans:
1. **Interpretation gap** — did the agent understand what was meant?
2. **Decision gap** — was what was asked for the right thing to build?

Review moves from code to **intent, system change and behaviour change**, backed by evidence.

## The unit of work: the Change
- A **Change** is one feature, modelled like a deal in a CRM. It is the top-level object, not a branch or PR.
- **Inputs:** Notion PRDs, Linear tickets, agent transcripts (Claude Code, Cursor, Codex), design files, screenshots. Slack is out of scope for now.
- **Outputs:** code, as one or many PRs. PRs are an output format; how the code is split doesn't matter for review.
- The Change lives on **after merge** until close-out.

## Semantic layers
- Layers are semantic, not PRs. Example order: PRD/design → data model → API → settings UI → feature UI → tests.
- Each code hunk is assigned to a layer (path/AST rules first, agent judgement second). PR boundaries are a hint, never trusted.
- Lower layers must qualify before upper layers matter.
- A stack is read as PRs whose branches feed into each other, however they were made (by hand, Graphite, Linear or GitHub's native stacked PRs). Strata finds it from the branch links and doesn't depend on any tool's own stack records.
- Later, the tool can generate and own the PR split for a Change (build on existing stacking tools such as `gh-stack`, don't rebuild stacking).

## Traceability graph
`requirement → interpretation → layer → hunk → evidence`, extended after merge with `commit → deploy → flag → errors/metrics`.

Powers: requirement-change propagation, "which layer should this change go in", scope-creep detection, post-merge attribution, and `git blame` → full Change history.

## The three lenses
1. **Intent** — what were we trying to do and why.
2. **System change** — data model, APIs, services, dependencies, config.
3. **Behaviour change** — what the product/system now does differently.

**Cross-check them; every gap is a finding:**
- Behaviour change without intent → unintended side effect.
- Intent without behaviour proof → unverified.
- System change without intent → scope creep / undocumented decision.
- System change larger than intent implies → design question for a human.

## Interpretations ledger
- The agent restates requirements as concrete decisions/assumptions ("'admins' = org admins, not workspace admins").
- Flags ambiguity and conflicts between sources (PRD vs ticket vs transcript) **before** building.
- Humans confirm interpretations — ideally before code exists.
- Significant decisions show alternatives considered and their system consequences, routed to the right reviewer (PM, data owner…).

## Automatic system diagrams
Generated from real artifacts, not LLM reading of code. Always shown as a **diff against main**.
- Data model: ER diagram from ORM schema/migrations, added/changed/removed highlighted.
- API: contract diff from OpenAPI/route definitions.
- Architecture: services, queues, external calls, new dependencies from import/call graph.
- UI: route/component tree, where new settings appear.
The agent may annotate; structure comes from analysis.

## Behaviour verification
- Acceptance criteria → scenarios → agent drives the running app (browser/API client).
- Run each scenario against **main and the Change**; show before/after screenshots/videos side by side (catches unintended changes too).
- Non-UI evidence: request/response traces, job output, logs.
- Every artifact links to the requirement it proves. Re-run when the Change updates (evidence never stale).
- **Prerequisite:** a runnable preview environment per Change (seed data, test accounts, agent-passable auth). Biggest onboarding hurdle.

## Invariant checks (what behaviour can't see)
Security scanning, architecture rules, performance budgets, migration dry-runs on realistic data volumes.

## Inspection by design
Code is never hidden, just not the default. Surface for mandatory human inspection anything that must be right first time:
data models & migrations, indexes & constraints, public API contracts, auth/permissions, data deletion/retention, infrastructure. Teams can add rules (e.g. anything under `billing/`).
- Start from the diagram (click entity → model + migration).
- Indexes come with the queries that use them and query plans on realistic data.
- Migrations come with lock behaviour, backfill time estimate, reversibility.
- Agent annotates the lines that matter rather than summarising.

## Change qualification (from Airspeed's deal qualification)
A matrix of **layers × dimensions**, each cell backed by evidence and an owner:
intent, traceability, interpretations confirmed, design sign-off, bot review, human review, tests (per requirement), CI, risk/blast radius, rollout, freshness — plus post-merge columns (rollout, validation).
- **Gates** (CI green, migration inspected, rollback plan, ships behind a flag) are separate from weighted signals. Never average a gate.
- Lead with the weakest cell, not a single number.
- **Decay:** approvals go amber when inputs change (PRD edited after sign-off, commits after approval).
- **Next best action:** the agent names the single most useful next step.
- A **separate grader agent** (no access to the authoring session) scores qualitative dimensions, so the score can't be gamed.

## Graduated autonomy
Each area earns "verification sufficient" vs "human required" from its **escape rate** (bugs that reached production despite passing verification). Verify the verifier with seeded faults / mutation testing.

## Progressive disclosure (everywhere)
1. **Verdict** — one line + status.
2. **Summary** — requirement, reasoning, confidence.
3. **Evidence** — recording, schema diff, test run, hunk.
4. **Raw** — transcript, logs, full diff.
Rules: every claim must expand to evidence (no evidence → don't show the claim); low-confidence items auto-expand; users can mark a link/evidence as wrong right there, feeding back into the graph.

## After merge
Rollout → validation (did intent's metric move?) → stabilisation (bugs/tickets attached to the Change) → follow-ups (review trade-offs become scheduled checks) → close-out (flag removed, dead code gone, docs match reality; team-defined exit criteria).
Inputs: deploys, feature flags, errors (Sentry), metrics/traces, product analytics, support tickets. Fixes land as new layers on the same Change.

## Agent capabilities
- Chat to one agent about the whole Change, in one workspace containing all layers.
- Requirement changes → agent proposes (not auto-applies) a stack-wide update starting at the right layer.
- Reviewer notes anchored to layers/requirements, surviving rewrites.

## Integration notes (researched Oct 2026)
- **GitHub:** green. GitHub App, PR webhooks, per-installation rate limits. Native stacked PRs in public preview (Jul 2026) + `gh-stack`.
- **Linear:** green. GraphQL, OAuth, webhooks, 5,000 req/hr per user for OAuth apps.
- **Notion:** amber. Public connection (OAuth); sees nothing until pages are shared; authorization is per user; 600 req/min (Business/Enterprise) or 180 elsewhere plus a shared per-workspace limit; API version header `2026-03-11`. Ask users to share one top-level specs page.
- **Transcripts:** amber.
  - Claude Code: hooks give `transcript_path`; HTTP hooks can POST directly. SessionEnd async work gets killed — upload on `Stop` or detach a process.
  - Cursor: `~/.cursor/hooks.json`; stop hook gives `transcript_path`; transcripts at `~/.cursor/projects/*/agent-transcripts/*.jsonl`; thin schema (no token usage).
  - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; hooks need `codex_hooks = true`; no subagent hooks; files can be GBs.
  - Cloud agents (Claude Code web, Codex cloud, Cursor background) not covered by local hooks. Redact secrets before upload.

## Competitive landscape
- **Aviator Verify** — closest: intent capture via MCP, acceptance criteria, end-to-end verification in previews with evidence. Study it.
- **GitHub stacked PRs, Graphite (Cursor)** — PR-centric, stop at merge.
- **Entire** — agent session ↔ commit/PR capture.
- **Warp, Jam, Tidewave** — proof screenshots/videos on PRs.
- **Kiro, Spec Kit, OpenSpec, Tessl** — spec-driven, upstream in the IDE.
- **CodeRabbit, Qodo, Greptile** — diff review.

**Differentiation:** the Change as a long-lived, multi-layer, multi-source object carried from plan to production; works from existing PRDs/tickets; diagrams; propagation; qualification; post-merge lifecycle; graduated autonomy.

## Benchmarks / acceptance tests
1. **Shape invariance:** the same feature as one 50,000-line PR and as a 30-PR stack must produce near-identical output (layers, diagrams, interpretations, findings, matrix). Any difference is a bug. Run as an automated regression test.
   - Requires separating mechanical changes (lockfiles, generated code, codemods, renames, snapshots — verified mechanically and collapsed) from meaningful ones, and detecting tangled PRs with multiple intents.
2. **Understand & approve:** time to confident approval, reviewer confidence, post-review quiz on data model changes and trade-offs, vs GitHub/Graphite baseline.
3. **Propagation:** change one PRD requirement touching several layers; time to correct updated stack, PRs touched by hand, misses.
4. **Seeded faults:** missing auth check, bad index, out-of-spec behaviour change — catch rate vs baseline.

Note: deploy risk stays shape-dependent; the tool may recommend a split for rollout even when review is split-agnostic.

## Open decisions
- Does the tool own all PR creation for a Change, or must it adopt hand-opened PRs? (Leaning: own it.)
- Default close-out criteria (e.g. flag at 100% and removed + N days without regressions) vs per-team.

## Suggested first milestone (spike)
Prove the core loop on one real repo, read-only:
1. Input: a GitHub PR **or** a stack of PRs **or** a commit range, plus an optional linked Linear ticket / Notion page.
2. Build the Change: classify hunks into semantic layers; separate mechanical vs meaningful.
3. Generate a before/after data-model diagram from schema/migrations.
4. Produce the intent ledger (requirements + interpretations) and the three-lens cross-check findings.
5. Render a single page with verdict → summary → evidence → raw disclosure.
6. Pass the shape-invariance test on one real feature split two ways.

Out of scope for the spike: behaviour recordings, post-merge, writing PRs, propagation.
