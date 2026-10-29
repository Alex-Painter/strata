/**
 * Chat about a Change: its threads, their messages, and a streamed answer.
 *
 * Posting a message saves it, then answers with a text/event-stream of
 * ChatStreamEvent: `status` while Claude reads code, `delta` for each piece
 * of text, then `done` with the saved answer (its citations checked) or
 * `error`. The question is asked against the Change's latest report.
 */
import {
  type Anchor,
  type ChangeReport,
  type ChatMessage,
  type ChatStreamEvent,
  type ChatThread,
  type PostChatMessageRequest,
  REPORT_SCHEMA_VERSION,
} from "@strata/core/model";
import { checkCitations, loadRepoSettings } from "@strata/engine";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { newId } from "../auth/crypto.js";
import {
  type ChatMessageRow,
  type ChatThreadRow,
  changes,
  chatMessages,
  chatThreads,
  reports,
} from "../db/schema.js";
import type { AppDeps, AppEnv } from "../types.js";

/** Characters of the first question kept as the thread's title. */
const TITLE_CHARS = 80;
/** Characters of one question. */
const TEXT_CHARS = 8_000;
const MAX_ANCHORS = 10;

export function chatRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono<AppEnv>();

  app.get("/changes/:id/threads", (c) => {
    const change = ownedChange(c);
    if (!change) return c.json({ error: "Strata cannot find this Change." }, 404);
    const rows = db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.changeId, change.id))
      .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.id))
      .all();
    return c.json<ChatThread[]>(rows.map(threadOf));
  });

  app.post("/changes/:id/threads", (c) => {
    const change = ownedChange(c);
    if (!change) return c.json({ error: "Strata cannot find this Change." }, 404);
    const now = new Date();
    const row = {
      id: newId("thr"),
      changeId: change.id,
      title: "",
      createdAt: now,
      updatedAt: now,
    };
    db.insert(chatThreads).values(row).run();
    return c.json<ChatThread>(threadOf(row), 201);
  });

  app.get("/threads/:id/messages", (c) => {
    const thread = ownedThread(c);
    if (!thread) return c.json({ error: "Strata cannot find this thread." }, 404);
    return c.json<ChatMessage[]>(messagesOf(thread.id));
  });

  app.post("/threads/:id/messages", async (c) => {
    const thread = ownedThread(c);
    if (!thread) return c.json({ error: "Strata cannot find this thread." }, 404);
    const body = (await c.req.json().catch(() => null)) as Partial<PostChatMessageRequest> | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return c.json({ error: "Write a question." }, 400);
    if (text.length > TEXT_CHARS) {
      return c.json({ error: `Write a question of ${TEXT_CHARS} characters or fewer.` }, 400);
    }
    const anchors = Array.isArray(body?.anchors) ? (body.anchors as Anchor[]) : [];
    if (anchors.length > MAX_ANCHORS || !anchors.every(isAnchor)) {
      return c.json({ error: `Send ${MAX_ANCHORS} highlights or fewer.` }, 400);
    }

    const report = latestReport(thread.changeId);
    if (!report) {
      return c.json(
        { error: "Strata did not analyse this Change yet. Try again when it is done." },
        409,
      );
    }
    const repo = report.change.repo;
    const name = repo.kind === "github" ? `${repo.owner}/${repo.name}` : null;
    if (!name) return c.json({ error: "Chat is available only for GitHub repos." }, 501);
    if (!deps.config.anthropicApiKey) {
      return c.json({ error: "Strata does not have an Anthropic API key." }, 403);
    }
    const settings = await loadRepoSettings(deps.config.dataDir, name).catch(() => null);
    if (!settings?.sendCodeToAnthropic) {
      return c.json(
        { error: `Turn on "Send the code in ${name} to Claude" in Settings to ask Claude.` },
        403,
      );
    }

    const history = messagesOf(thread.id);
    const analysedAt = report.analysis.startedAt;
    const now = new Date();
    db.insert(chatMessages)
      .values({
        id: newId("msg"),
        threadId: thread.id,
        role: "user",
        text,
        anchors: JSON.stringify(anchors),
        analysedAt,
        createdAt: now,
      })
      .run();
    db.update(chatThreads)
      .set({ updatedAt: now, ...(thread.title ? {} : { title: titleOf(text) }) })
      .where(eq(chatThreads.id, thread.id))
      .run();

    const engine = deps.engineFor(c.get("user").id);
    const signal = c.req.raw.signal;
    return streamSSE(c, async (stream) => {
      const send = (event: ChatStreamEvent) =>
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      let answer = "";
      try {
        for await (const chunk of engine.chat({ report, history, text, anchors, signal })) {
          if (chunk.type === "text") {
            answer += chunk.text;
            await send({ type: "delta", text: chunk.text });
          } else {
            await send({ type: "status", text: chunk.text });
          }
        }
        const row = {
          id: newId("msg"),
          threadId: thread.id,
          role: "assistant" as const,
          text: checkCitations(report, answer).trim(),
          anchors: "[]",
          analysedAt,
          createdAt: new Date(),
        };
        db.insert(chatMessages).values(row).run();
        db.update(chatThreads)
          .set({ updatedAt: row.createdAt })
          .where(eq(chatThreads.id, thread.id))
          .run();
        await send({ type: "done", message: messageOf(row) });
      } catch (error) {
        if (signal.aborted) return;
        console.error("[strata] chat failed", error);
        await send({
          type: "error",
          message: `Claude did not answer: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  });

  function ownedChange(c: Context<AppEnv>) {
    return db
      .select()
      .from(changes)
      .where(
        and(eq(changes.id, c.req.param("id") as string), eq(changes.ownerId, c.get("user").id)),
      )
      .get();
  }

  function ownedThread(c: Context<AppEnv>): ChatThreadRow | undefined {
    const row = db
      .select({ thread: chatThreads })
      .from(chatThreads)
      .innerJoin(changes, eq(changes.id, chatThreads.changeId))
      .where(
        and(eq(chatThreads.id, c.req.param("id") as string), eq(changes.ownerId, c.get("user").id)),
      )
      .get();
    return row?.thread;
  }

  function messagesOf(threadId: string): ChatMessage[] {
    return db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
      .all()
      .map(messageOf);
  }

  function latestReport(changeId: string): ChangeReport | null {
    const row = db
      .select()
      .from(reports)
      .where(and(eq(reports.changeId, changeId), eq(reports.schemaVersion, REPORT_SCHEMA_VERSION)))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .get();
    return row ? (JSON.parse(row.body) as ChangeReport) : null;
  }

  return app;
}

function threadOf(row: ChatThreadRow): ChatThread {
  return {
    id: row.id,
    changeId: row.changeId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
  };
}

function messageOf(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    text: row.text,
    anchors: JSON.parse(row.anchors) as Anchor[],
    analysedAt: row.analysedAt,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The first line of the first question, cut at a word. */
function titleOf(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  if (line.length <= TITLE_CHARS) return line;
  const cut = line.slice(0, TITLE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), TITLE_CHARS / 2))}…`;
}

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== "object" || value === null) return false;
  const source = (value as { source?: { kind?: unknown } }).source;
  return typeof source?.kind === "string";
}
