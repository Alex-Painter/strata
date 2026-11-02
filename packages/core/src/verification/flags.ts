/**
 * The flags on one PR's verification: what a reviewer must know before they
 * trust it. Each flag points at the items it is about, so the rule that every
 * claim has evidence holds: a flag about something missing points at the PR.
 */
import type { FileChange } from "../model/change.js";
import type { PrVerification, VerificationFlag, VerificationItem } from "../model/verification.js";

const shortOid = (oid: string) => oid.slice(0, 7);

/** Check names that are about tests, as opposed to lint or deploys. */
const TEST_CHECK = /test|spec|e2e|pytest|vitest|jest/i;

export function verificationFlags(
  verification: Omit<PrVerification, "flags">,
  files: FileChange[] | null,
): VerificationFlag[] {
  const { pr, head, items } = verification;
  const flags: VerificationFlag[] = [];
  const ids = (list: VerificationItem[]) => list.map((item) => item.id);

  const failingTests = items.filter(
    (item) =>
      item.strength === "observed" &&
      item.result === "fail" &&
      ((item.kind === "check" && TEST_CHECK.test(item.title)) || item.kind === "test"),
  );
  const testClaims = items.filter(
    (item) => item.source === "pr-body" && item.kind === "test" && !/\bfail/i.test(item.title),
  );
  if (failingTests.length > 0 && testClaims.length > 0) {
    flags.push({
      kind: "contradiction",
      pr,
      message: `CI reports failing tests on #${pr}. The PR body says that the tests pass.`,
      itemIds: [...ids(failingTests), ...ids(testClaims)],
    });
  }

  const gaps = items.filter((item) => item.kind === "not-run");
  if (gaps.length > 0) {
    flags.push({
      kind: "named-gap",
      pr,
      message:
        gaps.length === 1
          ? `The author of #${pr} did not verify 1 thing.`
          : `The author of #${pr} did not verify ${gaps.length} things.`,
      itemIds: ids(gaps),
    });
  }

  const uiFiles = (files ?? []).filter((file) => file.layer.layer === "ui" && !file.mechanical);
  const uiProof = items.filter((item) => ["screenshot", "recording", "walk"].includes(item.kind));
  if (uiFiles.length > 0 && uiProof.length === 0) {
    flags.push({
      kind: "ui-without-proof",
      pr,
      message: `#${pr} changes ${uiFiles.length === 1 ? "1 UI file" : `${uiFiles.length} UI files`}. It has no screenshot, recording or walk.`,
      itemIds: [],
    });
  }

  const checks = items.filter((item) => item.kind === "check" && item.result !== "skipped");
  if (checks.length === 0) {
    flags.push({
      kind: "no-checks",
      pr,
      message: `GitHub has no CI checks on the head of #${pr}.`,
      itemIds: [],
    });
  }

  const claims = items.filter((item) => item.source === "pr-body");
  const support = items.filter(
    (item) =>
      item.strength !== "claimed" &&
      item.result !== "skipped" &&
      (item.commit === head || item.commit === null),
  );
  if (claims.length > 0 && support.length === 0) {
    flags.push({
      kind: "claimed-only",
      pr,
      message: `The proof for #${pr} is only words in its PR body. No check, preview or file supports it.`,
      itemIds: ids(claims),
    });
  }

  const oldApprovals = items.filter(
    (item) =>
      item.kind === "human-review" &&
      item.result === "pass" &&
      item.commit !== null &&
      item.commit !== head,
  );
  for (const review of oldApprovals) {
    flags.push({
      kind: "stale",
      pr,
      message: `${review.by ?? "A reviewer"} approved #${pr} at ${shortOid(review.commit as string)}. The head is now ${shortOid(head)}.`,
      itemIds: [review.id],
    });
  }
  return flags;
}
