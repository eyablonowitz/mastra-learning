import type {
  AgentControllerMessage,
  AgentControllerThread,
} from "@mastra/core/agent-controller";
import type { ThreadSummary } from "@/lib/chat-types";

export const THREAD_PREVIEW_MAX_LENGTH = 80;
export const EMPTY_THREAD_PREVIEW = "New conversation";
export const THREAD_PREVIEW_METADATA_KEY =
  "mastra-learning:first-user-preview";

interface ThreadSummarySession {
  identity: {
    getResourceId(): string;
  };
  thread: {
    getId(): string | null;
    list(): Promise<AgentControllerThread[]>;
    firstUserMessages(input: {
      threadIds: string[];
    }): Promise<Map<string, AgentControllerMessage>>;
  };
}

interface ActiveThreadPreviewSession {
  thread: {
    getSetting(input: { key: string }): Promise<unknown>;
    setSetting(input: { key: string; value: unknown }): Promise<void>;
    listActiveMessages(): Promise<AgentControllerMessage[]>;
  };
}

function messageText(message: AgentControllerMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

export function toThreadPreviewFromText(text: string): string {
  const normalized = text
    .replace(/\s+/gu, " ")
    .trim();

  if (!normalized) return EMPTY_THREAD_PREVIEW;

  const characters = [...normalized];

  if (characters.length <= THREAD_PREVIEW_MAX_LENGTH) return normalized;

  return `${characters
    .slice(0, THREAD_PREVIEW_MAX_LENGTH - 1)
    .join("")}…`;
}

export function toThreadPreview(
  message: AgentControllerMessage | undefined,
): string {
  return message
    ? toThreadPreviewFromText(messageText(message))
    : EMPTY_THREAD_PREVIEW;
}

function storedThreadPreview(thread: AgentControllerThread): string | null {
  const value = thread.metadata?.[THREAD_PREVIEW_METADATA_KEY];

  return typeof value === "string" && value.trim()
    ? toThreadPreviewFromText(value)
    : null;
}

export function toThreadSummary(
  thread: AgentControllerThread,
  firstUserMessage: AgentControllerMessage | undefined,
  activeThreadId: string | null,
): ThreadSummary {
  return {
    id: thread.id,
    preview:
      firstUserMessage !== undefined
        ? toThreadPreview(firstUserMessage)
        : storedThreadPreview(thread) ?? EMPTY_THREAD_PREVIEW,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    isActive: thread.id === activeThreadId,
  };
}

export async function ensureActiveThreadPreview(
  session: ActiveThreadPreviewSession,
  fallbackText?: string,
): Promise<void> {
  const existing = await session.thread.getSetting({
    key: THREAD_PREVIEW_METADATA_KEY,
  });

  if (typeof existing === "string" && existing.trim()) return;

  const firstUserMessage = (await session.thread.listActiveMessages()).find(
    (message) => message.role === "user",
  );
  const preview = toThreadPreviewFromText(
    firstUserMessage ? messageText(firstUserMessage) : fallbackText ?? "",
  );

  if (preview === EMPTY_THREAD_PREVIEW) return;

  await session.thread.setSetting({
    key: THREAD_PREVIEW_METADATA_KEY,
    value: preview,
  });
}

export async function listThreadSummaries(
  session: ThreadSummarySession,
): Promise<ThreadSummary[]> {
  const resourceId = session.identity.getResourceId();
  const threads = (await session.thread.list()).filter(
    (thread) => thread.resourceId === resourceId,
  );
  const firstUserMessages =
    threads.length > 0
      ? await session.thread.firstUserMessages({
          threadIds: threads.map((thread) => thread.id),
        })
      : new Map<string, AgentControllerMessage>();
  const activeThreadId = session.thread.getId();

  return threads
    .map((thread) =>
      toThreadSummary(
        thread,
        firstUserMessages.get(thread.id),
        activeThreadId,
      ),
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime() ||
        left.id.localeCompare(right.id),
    );
}
