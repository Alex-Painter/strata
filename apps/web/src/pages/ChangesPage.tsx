import type { MeResponse } from "@strata/core/model";
import { TopBar } from "../components/TopBar";

/** The list of Changes. Creating and listing them arrives with milestone 1. */
export function ChangesPage({ me }: { me: MeResponse }) {
  return (
    <div className="flex h-full flex-col">
      <TopBar me={me} />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <h1 className="mb-4 text-base font-semibold">Changes</h1>
        <div className="rounded-lg border border-dashed border-line p-8 text-center text-muted">
          No changes yet. Point Strata at a PR, a stack of PRs or a commit range to review one.
        </div>
      </main>
    </div>
  );
}
