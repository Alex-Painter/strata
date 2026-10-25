import type { MeResponse } from "@strata/core/model";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { api } from "../lib/api";

export function TopBar({ me, children }: { me?: MeResponse; children?: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <Link href="/" className="font-semibold tracking-tight">
        Strata
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      {me && (
        <div className="flex items-center gap-2 text-muted">
          {me.avatarUrl && <img src={me.avatarUrl} alt="" className="size-5 rounded-full" />}
          <span>{me.login}</span>
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-raised"
            onClick={async () => {
              await api.signOut();
              window.location.assign("/");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
