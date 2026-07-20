"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type {
  ChatState,
  ChatToolActivity,
  ChatToolStatus,
  PendingToolApproval,
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

export function Chat() {
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
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const events = new EventSource("/api/chat");

    events.onopen = () => setConnection("connected");
    events.onmessage = (event) => {
      setChat(JSON.parse(event.data) as ChatState);
      setConnection("connected");
    };
    events.onerror = () => setConnection("reconnecting");

    return () => events.close();
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.pendingApproval, chat.toolActivity]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = message.trim();

    if (!content || chat.isRunning) return;

    setMessage("");
    setRequestError(null);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content }),
    }).catch(() => null);

    if (!response) {
      setRequestError("Could not reach the local server.");
      setMessage(content);
      return;
    }

    if (!response.ok) {
      setRequestError(await readError(response));
      setMessage(content);
    }
  };

  const startNewConversation = async () => {
    setRequestError(null);
    const response = await fetch("/api/chat", { method: "DELETE" }).catch(
      () => null,
    );

    if (!response) {
      setRequestError("Could not reach the local server.");
      return;
    }

    if (!response.ok) {
      setRequestError(await readError(response));
    }
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

    const response = await fetch("/api/chat", {
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
      setRequestError(await readError(response));
      setApprovalSubmission(null);
    }
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
    <main className="chat-shell">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Local learning project</p>
          <h1>Mastra AgentController Chat</h1>
          <p className="subtitle">
            Next.js → AgentController → Bedrock Claude Sonnet 5
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={startNewConversation}
          disabled={chat.isRunning || connection !== "connected"}
        >
          New conversation
        </button>
      </header>

      <section className="status-bar" aria-label="Chat status">
        <span className={`connection ${connection}`}>
          <span className="status-dot" />
          {connection}
        </span>
        <span>{chat.isRunning ? "Agent is responding" : "Agent is idle"}</span>
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
          disabled={chat.isRunning}
        />
        <div className="composer-footer">
          <span>Enter to send · Shift+Enter for a new line</span>
          <button
            className="primary-button"
            type="submit"
            disabled={
              !message.trim() || chat.isRunning || connection !== "connected"
            }
          >
            {chat.isRunning ? "Responding…" : "Send"}
          </button>
        </div>
      </form>

      <footer className="chat-footer">
        <span>{chat.modelId}</span>
        <span>Thread: {chat.threadId?.slice(0, 12) ?? "connecting"}</span>
      </footer>
    </main>
  );
}
