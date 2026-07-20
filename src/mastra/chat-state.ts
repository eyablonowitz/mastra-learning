import type { Session } from "@mastra/core/agent-controller";
import type { AgentControllerMessage } from "@mastra/core/agent-controller";
import type { ChatMessage, ChatState } from "@/lib/chat-types";
import { BEDROCK_MODEL_ID } from "./bedrock.ts";

export function toChatMessage(
  message: AgentControllerMessage,
  isStreaming = false,
): ChatMessage {
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  return {
    id: message.id,
    role: message.role,
    text,
    createdAt: message.createdAt.toISOString(),
    isStreaming,
    error: message.errorMessage,
  };
}

export function toChatState(
  session: Session,
  messages: ReadonlyMap<string, ChatMessage>,
  error: string | null,
): ChatState {
  const displayState = session.displayState.get();
  const visibleMessages = new Map(messages);

  if (displayState.isRunning && displayState.currentMessage) {
    visibleMessages.set(
      displayState.currentMessage.id,
      toChatMessage(displayState.currentMessage, true),
    );
  }

  return {
    threadId: session.thread.getId(),
    modelId: BEDROCK_MODEL_ID,
    isRunning: displayState.isRunning,
    messages: [...visibleMessages.values()].sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    ),
    tokenUsage: {
      promptTokens: displayState.tokenUsage.promptTokens,
      completionTokens: displayState.tokenUsage.completionTokens,
      totalTokens: displayState.tokenUsage.totalTokens,
    },
    toolActivity: [...displayState.activeTools.entries()].map(
      ([toolCallId, tool]) => ({
        toolCallId,
        name: tool.name,
        args: tool.args,
        status: tool.status,
        ...(tool.result !== undefined ? { result: tool.result } : {}),
        ...(tool.isError !== undefined ? { isError: tool.isError } : {}),
      }),
    ),
    pendingApproval: displayState.pendingApproval
      ? {
          toolCallId: displayState.pendingApproval.toolCallId,
          toolName: displayState.pendingApproval.toolName,
          args: displayState.pendingApproval.args,
        }
      : null,
    error,
  };
}
