import { CITATION_PATTERN } from "@strata/core/model";
import type { ReactNode } from "react";

/**
 * A small Markdown renderer for Claude's answers: paragraphs, bullet and
 * numbered lists, fenced code, `code`, **bold**, and citations such as
 * [hunk_0123456789abcdef], which become buttons. No HTML is ever injected.
 */
export function Markdown({
  text,
  onCite,
  citeLabel = () => "hunk",
}: {
  text: string;
  onCite: (id: string) => void;
  /** The words on a citation's button, such as the file's name. */
  citeLabel?: (id: string) => string;
}) {
  const cite = { onCite, citeLabel };
  return <div className="md">{blocks(text).map((block, i) => render(block, i, cite))}</div>;
}

interface Cite {
  onCite: (id: string) => void;
  citeLabel: (id: string) => string;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) out.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```"); i++) {
        code.push(lines[i] ?? "");
      }
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const last = out.at(-1);
      if (last && last.kind === kind) last.items.push(item[1] ?? "");
      else out.push({ kind, items: [item[1] ?? ""] });
      continue;
    }
    if (line.trim() === "") flush();
    else {
      // A line under a list item, indented, continues it.
      const last = out.at(-1);
      if (
        para.length === 0 &&
        /^\s+\S/.test(line) &&
        last &&
        last.kind !== "p" &&
        last.kind !== "code"
      ) {
        last.items[last.items.length - 1] += ` ${line.trim()}`;
      } else para.push(line.replace(/^#+\s+/, ""));
    }
  }
  flush();
  return out;
}

function render(block: Block, key: number, cite: Cite): ReactNode {
  switch (block.kind) {
    case "p":
      return <p key={key}>{inline(block.text, cite)}</p>;
    case "code":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case "ul":
    case "ol": {
      const List = block.kind;
      return (
        <List key={key}>
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items have no ids and never move.
            <li key={i}>{inline(item, cite)}</li>
          ))}
        </List>
      );
    }
  }
}

const INLINE = new RegExp(`(\`[^\`]+\`)|(\\*\\*[^*]+\\*\\*)|${CITATION_PATTERN.source}`, "g");

function inline(text: string, { onCite, citeLabel }: Cite): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > at) out.push(text.slice(at, start));
    const [whole, code, bold, id] = match;
    if (code) out.push(<code key={start}>{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={start}>{bold.slice(2, -2)}</strong>);
    else if (id) {
      out.push(
        <button
          key={start}
          type="button"
          className="cite"
          title={`Show ${id}`}
          onClick={() => onCite(id)}
        >
          {citeLabel(id)}
        </button>,
      );
    }
    at = start + whole.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
