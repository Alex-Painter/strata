import type { MeResponse } from "@strata/core/model";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { Info } from "../components/Info";
import { api } from "../lib/api";
import { REVIEWED_DAYS, reviewedChanges } from "../lib/reviewed";
import { ChangeList, SearchBox, SearchContext } from "./ChangesPage";

/**
 * Stacks that you reviewed before, or that you were on before, and that do
 * not wait on you now. It reads the Changes only when you open it, and shows
 * the last REVIEWED_DAYS days first.
 */
export function ReviewedPage({ me }: { me: MeResponse }) {
  const changes = useQuery({
    queryKey: ["changes"],
    queryFn: api.changes,
    refetchInterval: 30_000,
  });
  const [query, setQuery] = useState("");
  const [showOlder, setShowOlder] = useState(false);
  const split = changes.data ? reviewedChanges(changes.data, new Date()) : null;
  const shown = split && (showOlder ? [...split.recent, ...split.older] : split.recent);
  return (
    <AppShell
      me={me}
      navLabel="Strata"
      nav={<HomeNav current={null} page="reviewed" />}
      top={<Breadcrumb items={[{ label: "Reviewed" }]} />}
    >
      <main className="page">
        <div className="page-in wide">
          <SearchBox query={query} onChange={setQuery} />
          <SearchContext.Provider value={query}>
            <section className="grid gap-3" aria-labelledby="reviewed-h">
              <h2 id="reviewed-h" className="h2">
                Reviewed
                <Info
                  text={`Stacks that you reviewed before, or that you were on before. They do not wait on you. This list shows the last ${REVIEWED_DAYS} days first.`}
                />
              </h2>
              <ChangeList
                changes={shown ?? undefined}
                error={changes.error?.message ?? null}
                empty={`You were not on a stack in the last ${REVIEWED_DAYS} days.`}
              />
              {split && split.older.length > 0 && (
                <button
                  type="button"
                  className="btn h-8 justify-self-start"
                  onClick={() => setShowOlder(!showOlder)}
                >
                  {showOlder ? "Hide older stacks" : `Show ${split.older.length} older`}
                </button>
              )}
            </section>
          </SearchContext.Provider>
        </div>
      </main>
    </AppShell>
  );
}
