import type { ApprovalState, PrApproval } from "@strata/core/model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { type ApprovalsView, ApproveStack, PrApprove, RowApprove } from "./Approve";

const pr = (number: number, state: ApprovalState): PrApproval => ({
  number,
  url: `https://github.com/acme/app/pull/${number}`,
  analysedHead: `${number}`.repeat(40),
  liveHead: `${number}`.repeat(40),
  review: null,
  state,
});

function view(prs: PrApproval[], sent: [PrApproval[], "stack" | number][] = []): ApprovalsView {
  return {
    data: { viewer: "alex", prs },
    error: null,
    sending: [],
    results: [],
    sendError: null,
    approve: (list, from) => sent.push([list, from]),
  };
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});
function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
const click = (element: Element | undefined) => {
  if (!element) throw new Error("No such element");
  act(() => (element as HTMLElement).click());
};

it("sends nothing on the first click, and one approval on Approve on GitHub", () => {
  const sent: [PrApproval[], "stack" | number][] = [];
  mount(<PrApprove approvals={view([pr(4, { kind: "can-approve" })], sent)} pr={4} />);
  click(button("Approve"));
  expect(sent).toEqual([]);
  const dialog = document.querySelector("[role=dialog]");
  expect(dialog?.getAttribute("aria-label")).toBe("Approve #4 on GitHub?");
  expect(dialog?.textContent).toContain("Strata sends an approval as alex.");
  expect(dialog?.textContent).toContain("#4 at 4444444");
  // Cancel has the focus, so Enter does not approve.
  expect(document.activeElement?.textContent).toBe("Cancel");
  click(button("Approve on GitHub"));
  expect(sent.map(([prs, from]) => [prs.map((p) => p.number), from])).toEqual([[[4], 4]]);
  expect(document.querySelector("[role=dialog]")).toBeNull();
});

it("sends nothing on Cancel or Escape", () => {
  const sent: [PrApproval[], "stack" | number][] = [];
  mount(<PrApprove approvals={view([pr(4, { kind: "can-approve" })], sent)} pr={4} />);
  click(button("Approve"));
  click(button("Cancel"));
  expect(document.querySelector("[role=dialog]")).toBeNull();
  click(button("Approve"));
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(document.querySelector("[role=dialog]")).toBeNull();
  expect(sent).toEqual([]);
});

it("shows each state of a PR in its pane", () => {
  const approved = { kind: "approved" as const, url: "https://example.com/r", at: null };
  const container = mount(
    <>
      <PrApprove approvals={view([pr(1, approved)])} pr={1} />
      <PrApprove approvals={view([pr(2, { kind: "own" })])} pr={2} />
      <PrApprove
        approvals={view([pr(3, { kind: "head-moved", analysed: "a", live: "b" })])}
        pr={3}
      />
      <PrApprove
        approvals={view([pr(5, { kind: "approved-earlier", commitOid: "abcdef12", url: "u" })])}
        pr={5}
      />
    </>,
  );
  expect(container.textContent).toContain("Approved by you");
  const moved = button("Approve");
  expect(moved?.disabled).toBe(true);
  expect(moved?.title).toBe("#3 has new commits. Run Strata again before you approve it.");
  expect(container.textContent).toContain("You approved abcdef1");
  expect(button("Approve again")?.disabled).toBe(false);
});

it("approves the stack in one confirm step, and lists the PRs it skips", () => {
  const sent: [PrApproval[], "stack" | number][] = [];
  const prs = [
    pr(1, { kind: "closed", state: "merged" }),
    pr(2, { kind: "can-approve" }),
    pr(3, { kind: "approved-earlier", commitOid: null, url: "" }),
    pr(4, { kind: "own" }),
  ];
  mount(<ApproveStack approvals={view(prs, sent)} />);
  click(button("Approve stack"));
  const dialog = document.querySelector("[role=dialog]");
  expect(dialog?.getAttribute("aria-label")).toBe("Approve 2 PRs on GitHub?");
  expect(dialog?.textContent).toContain("Strata does not approve these PRs:");
  expect(dialog?.textContent).toContain("#1 It is not open.");
  expect(dialog?.textContent).toContain("#4 It is your PR.");
  expect(sent).toEqual([]);
  click(button("Approve on GitHub"));
  expect(sent.map(([list, from]) => [list.map((p) => p.number), from])).toEqual([
    [[2, 3], "stack"],
  ]);
});

it("blocks Approve stack while a PR on the path has new commits", () => {
  mount(
    <ApproveStack
      approvals={view([
        pr(2, { kind: "can-approve" }),
        pr(3, { kind: "head-moved", analysed: "a", live: "b" }),
      ])}
    />,
  );
  const stack = button("Approve stack");
  expect(stack?.disabled).toBe(true);
  expect(stack?.title).toBe("#3 has new commits. Run Strata again before you approve the stack.");
});

it("marks an approved row and offers Approve on an open one", () => {
  const container = mount(
    <ul>
      <li>
        <RowApprove
          approvals={view([pr(2, { kind: "approved", url: "", at: null })])}
          pr={2}
          title="PR 2"
        />
      </li>
      <li>
        <RowApprove approvals={view([pr(3, { kind: "can-approve" })])} pr={3} title="PR 3" />
      </li>
      <li>
        <RowApprove approvals={view([pr(4, { kind: "draft" })])} pr={4} title="PR 4" />
      </li>
    </ul>,
  );
  expect(container.querySelector("[title='Approved by you']")).not.toBeNull();
  const rowButtons = container.querySelectorAll("button");
  expect([...rowButtons].map((b) => b.getAttribute("aria-label"))).toEqual(["Approve #3 PR 3"]);
});
