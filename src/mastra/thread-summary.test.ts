import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentControllerMessage,
  AgentControllerThread,
} from "@mastra/core/agent-controller";
import {
  EMPTY_THREAD_PREVIEW,
  ensureActiveThreadPreview,
  listThreadSummaries,
  THREAD_PREVIEW_METADATA_KEY,
  THREAD_PREVIEW_MAX_LENGTH,
  toThreadPreview,
} from "./thread-summary.ts";

function thread(
  id: string,
  resourceId: string,
  updatedAt: string,
): AgentControllerThread {
  return {
    id,
    resourceId,
    createdAt: new Date("2026-07-20T12:00:00.000Z"),
    updatedAt: new Date(updatedAt),
  };
}

function userMessage(
  id: string,
  parts: string[],
): AgentControllerMessage {
  return {
    id,
    role: "user",
    content: parts.map((text) => ({ type: "text" as const, text })),
    createdAt: new Date("2026-07-20T12:01:00.000Z"),
  };
}

test("lists only current-resource threads with one batched preview read", async () => {
  const batchCalls: string[][] = [];
  const summaries = await listThreadSummaries({
    identity: {
      getResourceId: () => "resource-a",
    },
    thread: {
      getId: () => "thread-2",
      list: async () => [
        thread("thread-1", "resource-a", "2026-07-21T12:00:00.000Z"),
        thread("foreign", "resource-b", "2026-07-23T12:00:00.000Z"),
        thread("thread-2", "resource-a", "2026-07-22T12:00:00.000Z"),
      ],
      firstUserMessages: async ({ threadIds }) => {
        batchCalls.push(threadIds);
        return new Map([
          [
            "thread-1",
            userMessage("message-1", ["  First\n\n conversation  "]),
          ],
          ["thread-2", userMessage("message-2", [])],
          ["foreign", userMessage("message-3", ["Must not leak"])],
        ]);
      },
    },
  });

  assert.deepEqual(batchCalls, [["thread-1", "thread-2"]]);
  assert.deepEqual(
    summaries.map(({ id, preview, isActive }) => ({
      id,
      preview,
      isActive,
    })),
    [
      {
        id: "thread-2",
        preview: EMPTY_THREAD_PREVIEW,
        isActive: true,
      },
      {
        id: "thread-1",
        preview: "First conversation",
        isActive: false,
      },
    ],
  );
});

test("normalizes, bounds, and Unicode-safely truncates previews", () => {
  const longText = `  ${"🙂".repeat(THREAD_PREVIEW_MAX_LENGTH)} tail  `;
  const preview = toThreadPreview(userMessage("message-1", [longText]));

  assert.equal([...preview].length, THREAD_PREVIEW_MAX_LENGTH);
  assert.equal(preview.endsWith("…"), true);
  assert.equal(preview.includes("\n"), false);
  assert.equal(toThreadPreview(undefined), EMPTY_THREAD_PREVIEW);
});

test("uses thread ID as a deterministic secondary sort key", async () => {
  const summaries = await listThreadSummaries({
    identity: {
      getResourceId: () => "resource-a",
    },
    thread: {
      getId: () => null,
      list: async () => [
        thread("thread-z", "resource-a", "2026-07-22T12:00:00.000Z"),
        thread("thread-a", "resource-a", "2026-07-22T12:00:00.000Z"),
      ],
      firstUserMessages: async () => new Map(),
    },
  });

  assert.deepEqual(
    summaries.map((summary) => summary.id),
    ["thread-a", "thread-z"],
  );
  assert.equal(summaries.some((summary) => summary.isActive), false);
});

test("falls back to app-owned preview metadata without one query per thread", async () => {
  const storedThread = {
    ...thread("thread-1", "resource-a", "2026-07-22T12:00:00.000Z"),
    metadata: {
      [THREAD_PREVIEW_METADATA_KEY]: "Stored first message",
    },
  };
  const summaries = await listThreadSummaries({
    identity: {
      getResourceId: () => "resource-a",
    },
    thread: {
      getId: () => "thread-1",
      list: async () => [storedThread],
      firstUserMessages: async () => new Map(),
    },
  });

  assert.equal(summaries[0]?.preview, "Stored first message");
});

test("persists the first active user preview once", async () => {
  const writes: unknown[] = [];
  let setting: unknown;
  const session = {
    thread: {
      getSetting: async () => setting,
      setSetting: async ({ value }: { key: string; value: unknown }) => {
        setting = value;
        writes.push(value);
      },
      listActiveMessages: async () => [
        userMessage("message-1", ["  Actual\nfirst message  "]),
        userMessage("message-2", ["Later message"]),
      ],
    },
  };

  await ensureActiveThreadPreview(session, "Fallback message");
  await ensureActiveThreadPreview(session, "Ignored later fallback");

  assert.deepEqual(writes, ["Actual first message"]);
});
