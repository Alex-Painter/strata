import { describe, expect, it } from "vitest";
import {
  approvalBlock,
  approvalState,
  canApprove,
  type LivePr,
  type PrApproval,
  stackApproval,
} from "./approval.js";

const live = (fields: Partial<LivePr> = {}): LivePr => ({
  number: 10,
  url: "https://github.com/acme/app/pull/10",
  state: "open",
  draft: false,
  author: "dev",
  headOid: "h1",
  review: null,
  viewerReview: null,
  ...fields,
});
const approvedAt = (commitOid: string | null) => ({
  state: "approved" as const,
  commitOid,
  url: "https://github.com/acme/app/pull/10#pullrequestreview-1",
  submittedAt: "2026-11-02T10:00:00Z",
});

describe("approvalState", () => {
  it("opens Approve on an open PR whose head Strata analysed", () => {
    expect(approvalState(live(), "h1", "me")).toEqual({ kind: "can-approve" });
  });

  it("shows your approval of the current head", () => {
    expect(approvalState(live({ viewerReview: approvedAt("h1") }), "h1", "me")).toMatchObject({
      kind: "approved",
      at: "2026-11-02T10:00:00Z",
    });
  });

  it("offers Approve again after you approved an earlier commit", () => {
    const state = approvalState(live({ viewerReview: approvedAt("h0") }), "h1", "me");
    expect(state).toMatchObject({ kind: "approved-earlier", commitOid: "h0" });
    expect(canApprove(state)).toBe(true);
  });

  it("blocks Approve when the PR has commits Strata did not analyse", () => {
    const state = approvalState(live({ headOid: "h2" }), "h1", "me");
    expect(state).toEqual({ kind: "head-moved", analysed: "h1", live: "h2" });
    expect(canApprove(state)).toBe(false);
    expect(approvalState(live(), null, "me").kind).toBe("head-moved");
  });

  it("still shows an approval of the current head after the head moved past the report", () => {
    const state = approvalState(
      live({ headOid: "h2", viewerReview: approvedAt("h2") }),
      "h1",
      "me",
    );
    expect(state.kind).toBe("approved");
  });

  it("never opens Approve on your own PR, whatever the case of the login", () => {
    expect(approvalState(live({ author: "Me" }), "h1", "me")).toEqual({ kind: "own" });
  });

  it("does not open Approve on a draft", () => {
    expect(approvalState(live({ draft: true }), "h1", "me")).toEqual({ kind: "draft" });
  });

  it("does not open Approve on a merged or closed PR", () => {
    expect(approvalState(live({ state: "merged" }), "h1", "me")).toEqual({
      kind: "closed",
      state: "merged",
    });
    expect(approvalState(live({ state: "closed" }), "h1", "me").kind).toBe("closed");
  });

  it("treats changes requested or a comment as not approved", () => {
    const review = { ...approvedAt("h1"), state: "changes-requested" as const };
    expect(approvalState(live({ viewerReview: review }), "h1", "me")).toEqual({
      kind: "can-approve",
    });
  });
});

describe("stackApproval", () => {
  const pr = (number: number, state: PrApproval["state"]): PrApproval => ({
    number,
    url: "",
    analysedHead: "h",
    liveHead: "h",
    review: null,
    state,
  });

  it("approves the PRs it can and says why it skips the rest", () => {
    expect(
      stackApproval([
        pr(1, { kind: "closed", state: "merged" }),
        pr(2, { kind: "can-approve" }),
        pr(3, { kind: "approved", url: "", at: null }),
        pr(4, { kind: "approved-earlier", commitOid: "h0", url: "" }),
        pr(5, { kind: "own" }),
        pr(6, { kind: "draft" }),
      ]),
    ).toEqual({
      approve: [2, 4],
      skip: [
        { number: 1, reason: "It is not open." },
        { number: 3, reason: "You approved it." },
        { number: 5, reason: "It is your PR." },
        { number: 6, reason: "It is a draft." },
      ],
      blocked: [],
    });
  });

  it("is blocked while any PR on the path moved", () => {
    const result = stackApproval([
      pr(1, { kind: "can-approve" }),
      pr(2, { kind: "head-moved", analysed: "a", live: "b" }),
    ]);
    expect(result.blocked).toEqual([2]);
  });
});

describe("approvalBlock", () => {
  it("says nothing when Approve is open, and why it is not otherwise", () => {
    expect(approvalBlock({ kind: "can-approve" }, 4)).toBeNull();
    expect(approvalBlock({ kind: "approved-earlier", commitOid: null, url: "" }, 4)).toBeNull();
    expect(approvalBlock({ kind: "head-moved", analysed: "a", live: "b" }, 4)).toBe(
      "#4 has new commits. Run Strata again before you approve it.",
    );
    expect(approvalBlock({ kind: "closed", state: "merged" }, 4)).toBe("#4 is merged.");
  });
});
