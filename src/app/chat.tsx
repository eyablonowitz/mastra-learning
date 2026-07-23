"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { LearningSpace } from "@/app-data/learning-spaces";
import type {
  ChatState,
  ChatToolActivity,
  ChatToolStatus,
  PendingToolApproval,
  ThreadSummary,
} from "@/lib/chat-types";

const TOOL_LABELS: Record<string, string> = {
  list_learning_items: "List learning items",
  get_learning_item: "Get learning item",
  mark_learning_item_started: "Mark learning item started",
  mark_learning_item_complete: "Mark learning item complete",
};

const TOOL_STATUS_LABELS: Record<ChatToolStatus, string> = {
  streaming_input: "Preparing input",
  running: "Running",
  completed: "Completed",
  error: "Error",
};

const initialState: ChatState = {
  threadId: null,
  modelId: "us.anthropic.claude-sonnet-5",
  isRunning: false,
  messages: [],
  tokenUsage: {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  },
  toolActivity: [],
  pendingApproval: null,
  error: null,
};

function toolLabel(name: string): string {
  return (
    TOOL_LABELS[name] ??
    name
      .split("_")
      .filter(Boolean)
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" ")
  );
}

function formatToolData(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function ToolActivityPanel({
  tools,
  pendingApproval,
  approvalSubmission,
  onApprovalDecision,
}: {
  tools: ChatToolActivity[];
  pendingApproval: PendingToolApproval | null;
  approvalSubmission: {
    toolCallId: string;
    decision: "approve" | "decline";
  } | null;
  onApprovalDecision: (decision: "approve" | "decline") => void;
}) {
  if (tools.length === 0 && !pendingApproval) return null;

  const visibleTools = pendingApproval
    ? tools.filter((tool) => tool.toolCallId !== pendingApproval.toolCallId)
    : tools;

  return (
    <section className="tool-activity" aria-label="Agent tool activity">
      <div className="tool-activity-heading">
        <p>Agent activity</p>
        <span>Current or most recent run</span>
      </div>

      {visibleTools.map((tool) => {
        const status = tool.isError ? "error" : tool.status;

        return (
          <details className={`tool-card ${status}`} key={tool.toolCallId} open>
            <summary>
              <span className="tool-name">{toolLabel(tool.name)}</span>
              <span className="tool-status">{TOOL_STATUS_LABELS[status]}</span>
            </summary>
            <div className="tool-data">
              <p>Input</p>
              <pre>{formatToolData(tool.args)}</pre>
              {tool.result !== undefined ? (
                <>
                  <p>Result</p>
                  <pre>{formatToolData(tool.result)}</pre>
                </>
              ) : status === "error" ? (
                <p className="tool-waiting">No result was returned.</p>
              ) : (
                <p className="tool-waiting">Waiting for a result…</p>
              )}
            </div>
          </details>
        );
      })}

      {pendingApproval ? (
        <details className="approval-card" open>
          <summary>
            <span className="tool-name">
              {toolLabel(pendingApproval.toolName)}
            </span>
            <span className="tool-status">
              {approvalSubmission?.decision === "approve"
                ? "Resuming…"
                : approvalSubmission?.decision === "decline"
                  ? "Declining…"
                  : "Approval required"}
            </span>
          </summary>
          <div className="tool-data">
            <p>Input</p>
            <pre>{formatToolData(pendingApproval.args)}</pre>
            <p className="approval-explanation">
              This tool will change your local learning backlog.
            </p>
            <div className="approval-actions">
              <button
                className="approval-decline"
                type="button"
                onClick={() => onApprovalDecision("decline")}
                disabled={approvalSubmission !== null}
              >
                {approvalSubmission?.decision === "decline"
                  ? "Declining…"
                  : "Decline"}
              </button>
              <button
                className="approval-approve"
                type="button"
                onClick={() => onApprovalDecision("approve")}
                disabled={approvalSubmission !== null}
              >
                {approvalSubmission?.decision === "approve"
                  ? "Approving…"
                  : "Approve once"}
              </button>
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? `Request failed with status ${response.status}.`;
}

function isLearningSpace(value: unknown): value is LearningSpace {
  if (!value || typeof value !== "object") return false;

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  );
}

function isThreadSummary(value: unknown): value is ThreadSummary {
  if (!value || typeof value !== "object") return false;

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "preview" in value &&
    typeof value.preview === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string" &&
    "isActive" in value &&
    typeof value.isActive === "boolean"
  );
}

function SpaceControls({
  spaces,
  selectedSpaceId,
  threads,
  disabled,
  busy,
  isCreatingSpace,
  isCreatingThread,
  switchingThreadId,
  isLoadingThreads,
  isCreateFormOpen,
  newSpaceName,
  error,
  threadError,
  onSelect,
  onSelectThread,
  onCreateThread,
  onOpenCreate,
  onCancelCreate,
  onNameChange,
  onCreate,
}: {
  spaces: LearningSpace[];
  selectedSpaceId: string;
  threads: ThreadSummary[];
  disabled: boolean;
  busy: boolean;
  isCreatingSpace: boolean;
  isCreatingThread: boolean;
  switchingThreadId: string | null;
  isLoadingThreads: boolean;
  isCreateFormOpen: boolean;
  newSpaceName: string;
  error: string | null;
  threadError: string | null;
  onSelect: (spaceId: string) => void;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
  onOpenCreate: () => void;
  onCancelCreate: () => void;
  onNameChange: (name: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <aside className="space-sidebar" aria-label="Learning spaces">
      <div>
        <p className="eyebrow">Learning spaces</p>
        <h2>Your spaces</h2>
        <p className="space-intro">
          Each space has its own curriculum progress and conversations.
        </p>
      </div>

      <div className="space-picker">
        <label htmlFor="learning-space">Current space</label>
        <select
          id="learning-space"
          value={selectedSpaceId}
          onChange={(event) => onSelect(event.target.value)}
          disabled={disabled}
        >
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </div>

      {isCreateFormOpen ? (
        <form
          className="new-space-form"
          aria-label="Create learning space"
          onSubmit={onCreate}
        >
          <label htmlFor="new-space-name">Space name</label>
          <input
            id="new-space-name"
            value={newSpaceName}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Mastra Deep Dive"
            maxLength={60}
            disabled={disabled || isCreatingSpace}
            autoFocus
          />
          <div className="new-space-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={
                disabled || isCreatingSpace || newSpaceName.trim().length === 0
              }
            >
              {isCreatingSpace ? "Creating…" : "Create space"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={onCancelCreate}
              disabled={isCreatingSpace}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          className="new-space-button"
          type="button"
          onClick={onOpenCreate}
          disabled={disabled}
        >
          + New space
        </button>
      )}

      {error ? (
        <p className="space-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="conversation-navigation" aria-label="Conversations">
        <div className="conversation-heading">
          <div>
            <p className="eyebrow">Conversations</p>
            <h3>History</h3>
          </div>
          <button
            className="new-conversation-button"
            type="button"
            onClick={onCreateThread}
            disabled={disabled}
          >
            {isCreatingThread ? "Creating…" : "+ New"}
          </button>
        </div>

        {isLoadingThreads && threads.length === 0 ? (
          <p className="conversation-placeholder">Loading conversations…</p>
        ) : threads.length === 0 ? (
          <p className="conversation-placeholder">No conversations yet.</p>
        ) : (
          <div className="conversation-list">
            {threads.map((thread) => (
              <button
                className={`conversation-item ${
                  thread.isActive ? "active" : ""
                }`}
                type="button"
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
                disabled={disabled || thread.isActive}
                aria-current={thread.isActive ? "page" : undefined}
                title={thread.preview}
              >
                <span className="conversation-preview">{thread.preview}</span>
                <span className="conversation-meta">
                  {switchingThreadId === thread.id
                    ? "Opening…"
                    : thread.isActive
                      ? "Current"
                      : new Date(thread.updatedAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}

        {threadError ? (
          <p className="space-error" role="alert">
            {threadError}
          </p>
        ) : null}
      </section>

      <div className="space-sidebar-footer">
        <span>
          {spaces.length} {spaces.length === 1 ? "space" : "spaces"} ·{" "}
          {threads.length}{" "}
          {threads.length === 1 ? "conversation" : "conversations"}
        </span>
        {busy ? (
          <p>
            Finish the active response or approval before changing navigation.
          </p>
        ) : (
          <p>Spaces are URL-scoped; conversations stay inside each space.</p>
        )}
      </div>
    </aside>
  );
}

export function LearningShell({
  userName,
  spaces,
  spaceId,
  spaceName,
}: {
  userName: string;
  spaces: LearningSpace[];
  spaceId: string;
  spaceName: string;
}) {
  const router = useRouter();
  const encodedSpaceId = encodeURIComponent(spaceId);
  const chatUrl = `/api/spaces/${encodedSpaceId}/chat`;
  const threadsUrl = `/api/spaces/${encodedSpaceId}/threads`;
  const [chat, setChat] = useState(initialState);
  const [message, setMessage] = useState("");
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [approvalSubmission, setApprovalSubmission] = useState<{
    toolCallId: string;
    decision: "approve" | "decline";
  } | null>(null);
  const [spaceOptions, setSpaceOptions] = useState(spaces);
  const [selectedSpaceId, setSelectedSpaceId] = useState(spaceId);
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [switchingThreadId, setSwitchingThreadId] = useState<string | null>(
    null,
  );
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);
  const [isNavigating, startNavigation] = useTransition();
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const eventSource = useRef<EventSource | null>(null);
  const acceptsChatEvents = useRef(true);
  const threadRefreshSequence = useRef(0);
  const threadSwitchSequence = useRef(0);
  const lastChatThreadId = useRef<string | null>(null);
  const lastChatError = useRef<string | null>(null);
  const chatWasRunning = useRef(false);

  const refreshThreads = useCallback(async () => {
    const sequence = ++threadRefreshSequence.current;

    setIsLoadingThreads(true);
    const response = await fetch(threadsUrl, { cache: "no-store" }).catch(
      () => null,
    );

    if (sequence !== threadRefreshSequence.current) return;

    if (!response) {
      setThreadError("Could not load conversations.");
      setIsLoadingThreads(false);
      return;
    }

    if (!response.ok) {
      if (response.status === 401) {
        setIsLoadingThreads(false);
        router.refresh();
        return;
      }

      setThreadError(await readError(response));
      setIsLoadingThreads(false);
      return;
    }

    const body = (await response.json().catch(() => null)) as
      | { threads?: unknown }
      | null;

    if (
      !Array.isArray(body?.threads) ||
      !body.threads.every(isThreadSummary)
    ) {
      setThreadError("The server returned invalid conversation history.");
      setIsLoadingThreads(false);
      return;
    }

    setThreads(body.threads);
    setThreadError(null);
    setIsLoadingThreads(false);
  }, [router, threadsUrl]);

  useEffect(() => {
    let active = true;
    const events = new EventSource(chatUrl);

    acceptsChatEvents.current = true;
    eventSource.current = events;

    events.onopen = () => {
      if (active && acceptsChatEvents.current) {
        setConnection("connected");
        void refreshThreads();
      }
    };
    events.onmessage = (event) => {
      if (!active || !acceptsChatEvents.current) return;

      const nextState = JSON.parse(event.data) as ChatState;
      const threadChanged = lastChatThreadId.current !== nextState.threadId;
      const runFinished = chatWasRunning.current && !nextState.isRunning;
      const newError =
        nextState.error !== null && nextState.error !== lastChatError.current;

      lastChatThreadId.current = nextState.threadId;
      lastChatError.current = nextState.error;
      chatWasRunning.current = nextState.isRunning;
      setChat(nextState);
      setApprovalSubmission((submission) =>
        submission?.toolCallId === nextState.pendingApproval?.toolCallId
          ? submission
          : null,
      );
      setConnection("connected");

      if (threadChanged || runFinished || newError) {
        void refreshThreads();
      }
    };
    events.onerror = () => {
      if (!active || !acceptsChatEvents.current) return;

      setConnection("reconnecting");
      void fetch("/api/session")
        .then((response) => response.json())
        .then((body: { user?: unknown }) => {
          if (
            active &&
            acceptsChatEvents.current &&
            body.user === null
          ) {
            router.refresh();
          }
        })
        .catch(() => undefined);
    };

    return () => {
      active = false;
      acceptsChatEvents.current = false;
      threadRefreshSequence.current += 1;
      threadSwitchSequence.current += 1;
      events.close();
      if (eventSource.current === events) {
        eventSource.current = null;
      }
    };
  }, [chatUrl, refreshThreads, router]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.pendingApproval, chat.toolActivity]);

  const sessionBusy =
    chat.isRunning ||
    chat.pendingApproval !== null ||
    approvalSubmission !== null ||
    isSendingMessage ||
    isCreatingThread ||
    switchingThreadId !== null;
  const spaceControlsDisabled =
    sessionBusy ||
    connection !== "connected" ||
    isNavigating ||
    isCreatingSpace ||
    isSwitchingUser;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = message.trim();

    if (!content || sessionBusy) return;

    setMessage("");
    setRequestError(null);
    setIsSendingMessage(true);

    const response = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content }),
    }).catch(() => null);

    if (!response) {
      setRequestError("Could not reach the local server.");
      setMessage(content);
      setIsSendingMessage(false);
      return;
    }

    if (!response.ok) {
      if (response.status === 401) {
        setIsSendingMessage(false);
        router.refresh();
        return;
      }

      setRequestError(await readError(response));
      setMessage(content);
    }

    setIsSendingMessage(false);
  };

  const startNewConversation = async () => {
    if (
      sessionBusy ||
      connection !== "connected" ||
      isNavigating ||
      isCreatingSpace
    ) {
      return;
    }

    setRequestError(null);
    setThreadError(null);
    setIsCreatingThread(true);
    const response = await fetch(threadsUrl, { method: "POST" }).catch(
      () => null,
    );

    if (!response) {
      setRequestError("Could not reach the local server.");
      setIsCreatingThread(false);
      return;
    }

    if (!response.ok) {
      if (response.status === 401) {
        setIsCreatingThread(false);
        router.refresh();
        return;
      }

      setRequestError(await readError(response));
      setIsCreatingThread(false);
      return;
    }

    const body = (await response.json().catch(() => null)) as
      | { thread?: unknown }
      | null;
    const createdThread = body?.thread;

    if (!isThreadSummary(createdThread)) {
      setRequestError("The server created a conversation without valid details.");
      setIsCreatingThread(false);
      return;
    }

    setThreads((current) => [
      createdThread,
      ...current
        .filter((thread) => thread.id !== createdThread.id)
        .map((thread) => ({ ...thread, isActive: false })),
    ]);
    setChat({
      ...initialState,
      threadId: createdThread.id,
    });
    lastChatThreadId.current = createdThread.id;
    setApprovalSubmission(null);
    setIsCreatingThread(false);
    void refreshThreads();
  };

  const switchConversation = async (threadId: string) => {
    if (
      sessionBusy ||
      connection !== "connected" ||
      isNavigating ||
      isCreatingSpace ||
      !threads.some((thread) => thread.id === threadId && !thread.isActive)
    ) {
      return;
    }

    const sequence = ++threadSwitchSequence.current;

    setRequestError(null);
    setThreadError(null);
    setSwitchingThreadId(threadId);

    const response = await fetch(
      `${threadsUrl}/${encodeURIComponent(threadId)}/active`,
      { method: "PUT" },
    ).catch(() => null);

    if (sequence !== threadSwitchSequence.current) return;

    if (!response) {
      setThreadError("Could not open that conversation.");
      setSwitchingThreadId(null);
      return;
    }

    if (!response.ok) {
      if (response.status === 401) {
        setSwitchingThreadId(null);
        router.refresh();
        return;
      }

      setThreadError(await readError(response));
      setSwitchingThreadId(null);
      void refreshThreads();
      return;
    }

    setThreads((current) =>
      current.map((thread) => ({
        ...thread,
        isActive: thread.id === threadId,
      })),
    );
    // The hydrated SSE snapshot can arrive before this PUT resolves.
    setChat((current) =>
      current.threadId === threadId
        ? current
        : { ...initialState, threadId },
    );
    lastChatThreadId.current = threadId;
    setApprovalSubmission(null);
    setMessage("");
    setSwitchingThreadId(null);
    void refreshThreads();
  };

  const respondToApproval = async (decision: "approve" | "decline") => {
    const pendingApproval = chat.pendingApproval;
    const approvalIsSubmitting =
      approvalSubmission?.toolCallId === pendingApproval?.toolCallId;

    if (!pendingApproval || approvalIsSubmitting) return;

    setRequestError(null);
    setApprovalSubmission({
      toolCallId: pendingApproval.toolCallId,
      decision,
    });

    const response = await fetch(chatUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolCallId: pendingApproval.toolCallId,
        decision,
      }),
    }).catch(() => null);

    if (!response) {
      setRequestError("Could not reach the local server.");
      setApprovalSubmission(null);
      return;
    }

    if (!response.ok) {
      if (response.status === 401) {
        setApprovalSubmission(null);
        router.refresh();
        return;
      }

      setRequestError(await readError(response));
      setApprovalSubmission(null);
    }
  };

  const beginSpaceNavigation = (nextSpaceId: string) => {
    acceptsChatEvents.current = false;
    eventSource.current?.close();
    eventSource.current = null;
    threadRefreshSequence.current += 1;
    threadSwitchSequence.current += 1;
    setSelectedSpaceId(nextSpaceId);
    setChat(initialState);
    setThreads([]);
    setThreadError(null);
    setIsLoadingThreads(true);
    setSwitchingThreadId(null);
    setMessage("");
    setConnection("connecting");
    setRequestError(null);
    setApprovalSubmission(null);
    setSpaceError(null);
    setIsCreateFormOpen(false);

    startNavigation(() => {
      router.push(`/?space=${encodeURIComponent(nextSpaceId)}`, {
        scroll: false,
      });
    });
  };

  const selectSpace = (nextSpaceId: string) => {
    if (
      spaceControlsDisabled ||
      nextSpaceId === spaceId ||
      !spaceOptions.some((space) => space.id === nextSpaceId)
    ) {
      setSelectedSpaceId(spaceId);
      return;
    }

    beginSpaceNavigation(nextSpaceId);
  };

  const createSpace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newSpaceName.trim();

    if (!name || spaceControlsDisabled) return;

    setSpaceError(null);
    setIsCreatingSpace(true);

    const response = await fetch("/api/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);

    if (!response) {
      setSpaceError("Could not reach the local server.");
      setIsCreatingSpace(false);
      return;
    }

    if (!response.ok) {
      if (response.status === 401) {
        setIsCreatingSpace(false);
        router.refresh();
        return;
      }

      setSpaceError(await readError(response));
      setIsCreatingSpace(false);
      return;
    }

    const body = (await response.json().catch(() => null)) as
      | { space?: unknown }
      | null;
    const createdSpace = body?.space;

    if (!isLearningSpace(createdSpace)) {
      setSpaceError("The server created a space without valid details.");
      setIsCreatingSpace(false);
      return;
    }

    setSpaceOptions((current) => [...current, createdSpace]);
    setNewSpaceName("");
    setIsCreatingSpace(false);
    beginSpaceNavigation(createdSpace.id);
  };

  const switchUser = async () => {
    if (sessionBusy || isSwitchingUser || isNavigating) return;

    setRequestError(null);
    setIsSwitchingUser(true);

    const response = await fetch("/api/session", { method: "DELETE" }).catch(
      () => null,
    );

    if (!response) {
      setRequestError("Could not reach the local server.");
      setIsSwitchingUser(false);
      return;
    }

    if (!response.ok) {
      setRequestError(await readError(response));
      setIsSwitchingUser(false);
      return;
    }

    router.refresh();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const visibleError = requestError ?? chat.error;
  const currentApprovalSubmission =
    approvalSubmission?.toolCallId === chat.pendingApproval?.toolCallId
      ? approvalSubmission
      : null;
  const lastMessage = chat.messages[chat.messages.length - 1];
  const activityBeforeMessageId =
    lastMessage?.role === "assistant" ? lastMessage.id : null;
  const activity = (
    <ToolActivityPanel
      tools={chat.toolActivity}
      pendingApproval={chat.pendingApproval}
      approvalSubmission={currentApprovalSubmission}
      onApprovalDecision={(decision) => void respondToApproval(decision)}
    />
  );

  return (
    <main className="learning-shell">
      <SpaceControls
        spaces={spaceOptions}
        selectedSpaceId={selectedSpaceId}
        threads={threads}
        disabled={spaceControlsDisabled}
        busy={sessionBusy}
        isCreatingSpace={isCreatingSpace}
        isCreatingThread={isCreatingThread}
        switchingThreadId={switchingThreadId}
        isLoadingThreads={isLoadingThreads}
        isCreateFormOpen={isCreateFormOpen}
        newSpaceName={newSpaceName}
        error={spaceError}
        threadError={threadError}
        onSelect={selectSpace}
        onSelectThread={(threadId) => void switchConversation(threadId)}
        onCreateThread={() => void startNewConversation()}
        onOpenCreate={() => {
          setSpaceError(null);
          setIsCreateFormOpen(true);
        }}
        onCancelCreate={() => {
          setNewSpaceName("");
          setSpaceError(null);
          setIsCreateFormOpen(false);
        }}
        onNameChange={setNewSpaceName}
        onCreate={(event) => void createSpace(event)}
      />

      <section className="chat-shell" aria-label={`${spaceName} conversation`}>
        <header className="chat-header">
          <div>
            <p className="eyebrow">Local learning project · {spaceName}</p>
            <h1>Mastra AgentController Chat</h1>
            <p className="subtitle">
              Next.js → AgentController → Bedrock Claude Sonnet 5
            </p>
          </div>
          <div className="chat-header-actions">
            <p className="active-user">
              Chatting as <strong>{userName}</strong>
            </p>
            <div className="header-buttons">
              <button
                className="secondary-button"
                type="button"
                onClick={switchUser}
                disabled={
                  sessionBusy ||
                  isSwitchingUser ||
                  isNavigating ||
                  isCreatingSpace
                }
              >
                {isSwitchingUser ? "Switching…" : "Switch user"}
              </button>
            </div>
          </div>
        </header>

        <section className="status-bar" aria-label="Chat status">
          <span className={`connection ${connection}`}>
            <span className="status-dot" />
            {connection}
          </span>
          <span>
            {chat.isRunning || isSendingMessage
              ? "Agent is responding"
              : "Agent is idle"}
          </span>
          <span>{chat.tokenUsage.totalTokens.toLocaleString()} tokens</span>
        </section>

      <section className="transcript" aria-live="polite">
        {chat.messages.length === 0 ? (
          <div className="empty-state">
            <p className="empty-icon">M</p>
            <h2>Start a conversation</h2>
            <p>
              Ask a question to see the controller create a thread, stream agent
              events, and persist the result locally.
            </p>
          </div>
        ) : (
          chat.messages.map((item) => (
            <div className="transcript-entry" key={item.id}>
              {activityBeforeMessageId === item.id ? activity : null}
              <article className={`message ${item.role}`}>
                <p className="message-role">
                  {item.role === "user" ? "You" : "Assistant"}
                </p>
                <div className="message-content">
                  {item.text || (item.isStreaming ? "Thinking…" : "")}
                  {item.isStreaming && item.text ? (
                    <span className="cursor" aria-hidden="true" />
                  ) : null}
                </div>
                {item.error ? (
                  <p className="message-error">{item.error}</p>
                ) : null}
              </article>
            </div>
          ))
        )}
        {activityBeforeMessageId ? null : activity}
        <div ref={transcriptEnd} />
      </section>

      {visibleError ? <p className="error-banner">{visibleError}</p> : null}

      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the agent something…"
          rows={3}
          maxLength={8_000}
          disabled={sessionBusy || isNavigating}
        />
        <div className="composer-footer">
          <span>Enter to send · Shift+Enter for a new line</span>
          <button
            className="primary-button"
            type="submit"
            disabled={
              !message.trim() ||
              sessionBusy ||
              connection !== "connected" ||
              isNavigating
            }
          >
            {chat.isRunning || isSendingMessage ? "Responding…" : "Send"}
          </button>
        </div>
      </form>

        <footer className="chat-footer">
          <span>{chat.modelId}</span>
          <span>Thread: {chat.threadId?.slice(0, 12) ?? "connecting"}</span>
        </footer>
      </section>
    </main>
  );
}
