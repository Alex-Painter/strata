import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import type { Display } from "./model";

/** The Display popover: the secondary options, each a switch with its key. */
export function DisplayPopover({
  display,
  onChange,
  onClose,
  matrixAvailable,
}: {
  display: Display;
  onChange: (display: Display) => void;
  onClose: () => void;
  /** The matrix needs PRs: a range has none. */
  matrixAvailable: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=switch]")?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!ref.current?.contains(target) && !target.closest?.("[data-display-toggle]")) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);
  const row = (key: keyof Display, label: string, hint: string, kbd?: string, disabled = false) => (
    <button
      type="button"
      role="switch"
      aria-checked={display[key]}
      disabled={disabled}
      onClick={() => onChange({ ...display, [key]: !display[key] })}
      className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-hover disabled:opacity-45"
    >
      <span className="grid min-w-0 flex-1">
        <span>{label}</span>
        <span className="text-[12px] leading-snug text-faint">{hint}</span>
      </span>
      {kbd && <kbd>{kbd}</kbd>}
      <span className="sw" />
    </button>
  );
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Display"
      className="pop top-10 right-2 grid w-[300px] gap-0.5 p-1.5"
    >
      {row(
        "matrix",
        "Layers by PR",
        "Shows on the overview which PR changes which layer.",
        "M",
        !matrixAvailable,
      )}
      {row(
        "seams",
        "PR seams",
        "Shows the PR that each hunk came from, or the PR that revised it.",
        "S",
      )}
      {row(
        "fold",
        "Fold mechanical files",
        "Lockfiles, generated files and other mechanical files.",
      )}
    </div>
  );
}

export interface Command {
  id: string;
  group: string;
  label: string;
  icon: IconName;
  /** Shown at the right, such as a line count or a key. */
  hint?: string;
  run: () => void;
}

/** ⌘K: jump to a layer, a PR or a file, or change a display option. */
export function CommandMenu({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = commands.filter((command) => {
      const text = `${command.group} ${command.label}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    // Files are many; keep the menu quick by showing the first few of them.
    let files = 0;
    return matches.filter((command) => command.group !== "Files" || files++ < 40);
  }, [commands, query]);
  const current = Math.min(index, Math.max(0, shown.length - 1));
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [current]);
  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };
  let group = "";
  return (
    <div
      className="overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Command menu" className="sheet cmdk">
        <input
          // biome-ignore lint/a11y/noAutofocus: the menu exists to be typed into.
          autoFocus
          aria-label="Search layers, PRs and files"
          aria-controls="cmdk-list"
          aria-activedescendant={shown[current] ? `cmdk-${shown[current].id}` : undefined}
          placeholder="Jump to a layer, PR or file…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex(Math.min(current + 1, shown.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex(Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(shown[current]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div id="cmdk-list" ref={listRef} role="listbox" aria-label="Results" className="cl">
          {shown.length === 0 && <p className="px-3 py-4 text-faint">No item matches.</p>}
          {shown.map((command, i) => {
            const heading = command.group !== group;
            group = command.group;
            return (
              <div key={command.id}>
                {heading && <div className="cg">{command.group}</div>}
                <div
                  id={`cmdk-${command.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === current}
                  data-index={i}
                  className="ci cursor-pointer"
                  onPointerMove={() => setIndex(i)}
                  onClick={() => run(command)}
                  onKeyDown={() => {}}
                >
                  <Icon name={command.icon} />
                  <span className="ct">{command.label}</span>
                  {command.hint && <span className="text-[12px] text-faint">{command.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const KEYS: Array<[keys: string[], action: string]> = [
  [["⌘", "K"], "Command menu"],
  [["?"], "Keyboard shortcuts"],
  [["J", "K"], "Next or previous item"],
  [["↓", "↑"], "Next or previous layer"],
  [["O"], "Overview"],
  [["V"], "Display options"],
  [["S"], "PR seams"],
  [["M"], "Layers by PR"],
  [["\\"], "Show or hide the side panel"],
  [["Esc"], "Go back one step"],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="keys-heading" className="sheet">
        <div className="sheet-h">
          <h2 id="keys-heading">Keyboard shortcuts</h2>
          <span className="flex-1" />
          <button
            type="button"
            className="ib"
            aria-label="Close"
            // biome-ignore lint/a11y/noAutofocus: a dialog takes focus when it opens.
            autoFocus
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        <dl className="keys">
          {KEYS.map(([keys, action]) => (
            <div key={action}>
              <dt>{action}</dt>
              <dd>
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="px-[18px] pb-4 text-[12px] text-faint">
          Single keys do not operate while you type.
        </p>
      </div>
    </div>
  );
}
