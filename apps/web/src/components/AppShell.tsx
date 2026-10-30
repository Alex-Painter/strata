import type { MeResponse } from "@strata/core/model";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link } from "wouter";
import { api } from "../lib/api";
import { useStored } from "../lib/stored";
import { toggleTheme } from "../lib/theme";
import { Icon, Logo } from "./Icon";

/**
 * The frame every page shares: a quiet sidebar on the chrome, and one inset
 * card holding a 44 px top bar and the page. The sidebar collapses, and the
 * browser keeps that between visits. Below 960 px it becomes a drawer behind
 * the menu button instead.
 */
export function AppShell({
  me,
  navLabel,
  nav,
  top,
  tools,
  children,
}: {
  me?: MeResponse | undefined;
  /** The sidebar's landmark name. */
  navLabel: string;
  /** The sidebar between the workspace row and the footer. */
  nav: ReactNode;
  /** The top bar's left side: a breadcrumb and anything beside it. */
  top: ReactNode;
  /** Icon buttons at the right of the top bar, and in the workspace row. */
  tools?: { top?: ReactNode; side?: ReactNode };
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const [sideOpen, setSideOpen] = useStored("strata-sidebar-open", true);
  return (
    <div className="app" data-side={sideOpen ? "open" : "closed"}>
      <nav aria-label={navLabel} className="side" data-open={drawer}>
        <div className="ws">
          {me ? (
            <Link href="/" className="min-w-0 flex-1">
              <Logo />
              <span className="truncate">Strata</span>
            </Link>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
              <Logo />
              <span className="truncate">Strata</span>
            </span>
          )}
          {tools?.side}
          <button
            type="button"
            className="ib side-hide"
            aria-label="Collapse the sidebar"
            title="Collapse the sidebar"
            onClick={() => setSideOpen(false)}
          >
            <Icon name="panel-left" />
          </button>
        </div>
        {nav}
        <SideFooter me={me} />
      </nav>
      <div className="main">
        <header className="top">
          <button
            type="button"
            className="ib menu"
            aria-label="Menu"
            aria-expanded={drawer}
            onClick={() => setDrawer((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          {!sideOpen && (
            <button
              type="button"
              className="ib side-show"
              aria-label="Expand the sidebar"
              title="Expand the sidebar"
              onClick={() => setSideOpen(true)}
            >
              <Icon name="panel-left" />
            </button>
          )}
          {top}
          <span className="flex-1" />
          {tools?.top}
        </header>
        {children}
      </div>
    </div>
  );
}

function SideFooter({ me }: { me: MeResponse | undefined }) {
  return (
    <div className="side-foot">
      {me ? (
        <>
          {me.avatarUrl && <img src={me.avatarUrl} alt="" className="size-4 rounded-full" />}
          <span className="min-w-0 flex-1 truncate text-muted">{me.login}</span>
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate">The CLI wrote this report</span>
      )}
      <button type="button" className="ib" aria-label="Switch theme" onClick={toggleTheme}>
        <Icon name="theme" />
      </button>
      {me && (
        <button
          type="button"
          className="ib"
          aria-label="Sign out"
          title="Sign out"
          onClick={async () => {
            await api.signOut();
            window.location.assign("/");
          }}
        >
          <Icon name="out" />
        </button>
      )}
    </div>
  );
}

/** "Changes › name", the last part in full weight. */
export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <div className="bc">
      {items.map((item, i) => (
        <span key={item.label} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <Icon name="chev" />}
          {i === items.length - 1 ? (
            <b>{item.label}</b>
          ) : item.href ? (
            <Link href={item.href}>{item.label}</Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/** The sidebar of the pages outside a Change: Changes, then the repos reviewed. */
export function HomeNav({
  current,
  page = "changes",
}: {
  current: string | null;
  page?: "changes" | "settings";
}) {
  const changes = useQuery({ queryKey: ["changes"], queryFn: api.changes });
  const repos = [
    ...new Set([...(current ? [current] : []), ...(changes.data ?? []).map((c) => c.repo)]),
  ];
  return (
    <>
      <Link
        href="/"
        className="nrow"
        aria-current={current === null && page === "changes" ? "page" : undefined}
      >
        <Icon name="review" />
        <span className="nl">Changes</span>
      </Link>
      <Link
        href="/settings"
        className="nrow"
        aria-current={page === "settings" ? "page" : undefined}
      >
        <Icon name="sliders" />
        <span className="nl">Settings</span>
      </Link>
      {repos.length > 0 && (
        <div className="sec">
          <div className="sec-h">Stacks by repo</div>
          {repos.map((repo) => (
            <Link
              key={repo}
              href={`/repos/${repo}`}
              className="nrow pr"
              aria-current={current === repo ? "page" : undefined}
            >
              <Icon name="pr" />
              <span className="nl font-mono text-[13px]">{repo}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
