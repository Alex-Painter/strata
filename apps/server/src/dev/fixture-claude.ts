/**
 * A stand-in for the Anthropic Messages API, served by the fixture GitHub at
 * POST /v1/messages, so the summaries and the Guide can be driven with no key,
 * cost or network. It reads Strata's own prompts and answers from them, the
 * same way every time:
 *
 * - Layer questions: every file is logic.
 * - The whole stack: one sentence per group (four at most), plus one citing a
 *   hunk that doesn't exist, which Strata must drop. The Guide reads the logic
 *   groups first, then the data model; the other groups are left for Strata
 *   to place.
 * - One PR: a sentence per file, three at most.
 */

interface MessageBody {
  model: string;
  system: string;
  messages: Array<{ content: string }>;
}

interface Group {
  label: string;
  title: string;
  paths: string[];
  hunks: string[];
}

export function fixtureClaude(body: MessageBody): unknown {
  const prompt = body.messages[0]?.content ?? "";
  const answer = body.system.includes("sort the files of a code change")
    ? { files: sorted(prompt) }
    : body.system.includes("one pull request")
      ? { summary: partSummary(prompt) }
      : wholeStack(prompt);
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: body.model,
    content: [{ type: "text", text: JSON.stringify(answer), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function sorted(prompt: string) {
  return [...prompt.matchAll(/^### (\S+) \(/gm)].map((match) => ({
    path: match[1],
    layer: "logic",
    reason: "The fixture Claude calls every file logic",
  }));
}

function wholeStack(prompt: string) {
  const groups = parseGroups(prompt.slice(0, prompt.indexOf("\n\nThe hunks:")));
  const cited = groups.filter((group) => group.hunks.length > 0);
  const summary = [
    ...cited.slice(0, 4).map((group) => ({
      text: `${group.title} changes ${group.paths.join(", ")}.`,
      hunks: group.hunks,
    })),
    { text: "This sentence cites a hunk that doesn't exist.", hunks: ["h999"] },
  ];
  const named = (prefix: string) => cited.filter((group) => group.title.startsWith(prefix));
  const sections = [
    { title: "Read first: the logic", groups: named("Logic") },
    { title: "Then the storage", groups: named("Data model") },
  ]
    .filter((section) => section.groups.length > 0)
    .map((section) => ({
      title: section.title,
      groups: section.groups.map((group) => group.label),
      about: [
        {
          text: `Covers ${section.groups.flatMap((group) => group.paths).join(", ")}.`,
          hunks: section.groups.flatMap((group) => group.hunks.slice(0, 1)),
        },
      ],
    }));
  return { summary, sections };
}

function partSummary(prompt: string) {
  const files = [...prompt.matchAll(/^ {2}(\S+) \(.*\): (h\d+(?: h\d+)*)$/gm)];
  return files.slice(0, 3).map((match) => ({
    text: `Changes ${match[1]}.`,
    hunks: (match[2] as string).split(" "),
  }));
}

/** Strata's groups as its prompt lists them: `g1 Title`, then a line per file ending in hunk labels. */
function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  for (const line of text.split("\n")) {
    const group = /^(g\d+) (.+)$/.exec(line);
    if (group) {
      groups.push({ label: group[1] as string, title: group[2] as string, paths: [], hunks: [] });
      continue;
    }
    const file = /^ {2}(\S+) \(.*\): (.+)$/.exec(line);
    const current = groups[groups.length - 1];
    if (!file || !current) continue;
    current.paths.push(file[1] as string);
    current.hunks.push(...(file[2] as string).split(" ").filter((label) => /^h\d+$/.test(label)));
  }
  return groups;
}
