export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  isStreaming: boolean;
  error?: string;
}

export interface ThreadSummary {
  id: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export type ChatToolStatus =
  | "streaming_input"
  | "running"
  | "completed"
  | "error";

export interface ChatToolActivity {
  toolCallId: string;
  name: string;
  args: unknown;
  status: ChatToolStatus;
  result?: unknown;
  isError?: boolean;
}

export interface PendingToolApproval {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ChatState {
  threadId: string | null;
  modelId: string;
  isRunning: boolean;
  messages: ChatMessage[];
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolActivity: ChatToolActivity[];
  pendingApproval: PendingToolApproval | null;
  error: string | null;
}
