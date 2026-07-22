import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import type { ChatMessage } from "@/lib/chat-types";
import { getCurrentFakeUser, unauthorizedResponse } from "@/lib/current-user";
import { toChatMessage, toChatState } from "@/mastra/chat-state";
import { getMastraRuntime } from "@/mastra/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

export async function GET(request: Request) {
  const user = await getCurrentFakeUser();
  if (!user) return unauthorizedResponse();

  const { session } = await getMastraRuntime(user);
  const persistedMessages = await session.thread.listActiveMessages();
  const messages = new Map<string, ChatMessage>(
    persistedMessages.map((message) => [message.id, toChatMessage(message)]),
  );

  let lastError: string | null = null;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        if (!closed) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
      };

      const sendState = () => send(toChatState(session, messages, lastError));

      const handleEvent = (event: AgentControllerEvent) => {
        if (event.type === "agent_start") {
          lastError = null;
        }

        if (event.type === "message_end") {
          const message = toChatMessage(event.message);
          messages.set(message.id, message);
        }

        if (event.type === "thread_created" || event.type === "thread_changed") {
          messages.clear();
          lastError = null;
        }

        if (event.type === "error") {
          lastError = errorMessage(event.error);
        }

        if (event.type === "display_state_changed") {
          sendState();
        }
      };

      unsubscribe = session.subscribe(handleEvent);
      heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }
      }, 15_000);

      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          unsubscribe?.();
          if (heartbeat) clearInterval(heartbeat);
          controller.close();
        },
        { once: true },
      );

      sendState();
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentFakeUser();
  if (!user) return unauthorizedResponse();

  const body = (await request.json().catch(() => null)) as
    | { message?: unknown }
    | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  if (message.length > 8_000) {
    return Response.json(
      { error: "Message must be 8,000 characters or fewer." },
      { status: 400 },
    );
  }

  const { session } = await getMastraRuntime(user);

  if (session.run.isRunning()) {
    return Response.json(
      { error: "Wait for the current response to finish." },
      { status: 409 },
    );
  }

  try {
    await session.sendMessage({ content: message });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Agent run failed:", error);
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getCurrentFakeUser();
  if (!user) return unauthorizedResponse();

  const body = (await request.json().catch(() => null)) as
    | { toolCallId?: unknown; decision?: unknown }
    | null;
  const toolCallId =
    typeof body?.toolCallId === "string" ? body.toolCallId.trim() : "";
  const decision = body?.decision;

  if (
    !toolCallId ||
    (decision !== "approve" && decision !== "decline")
  ) {
    return Response.json(
      { error: "A valid toolCallId and approval decision are required." },
      { status: 400 },
    );
  }

  const { session } = await getMastraRuntime(user);
  const pendingApproval = session.displayState.get().pendingApproval;

  if (
    !pendingApproval ||
    !session.approval.isArmed() ||
    pendingApproval.toolCallId !== toolCallId ||
    session.approval.getToolCallId() !== toolCallId
  ) {
    return Response.json(
      { error: "That tool approval is no longer pending." },
      { status: 409 },
    );
  }

  session.respondToToolApproval({
    decision,
    toolCallId,
    ...(decision === "decline"
      ? {
          declineContext: {
            reason: "user_declined",
            message: "The user declined this change.",
          },
        }
      : {}),
  });

  return new Response(null, { status: 204 });
}

export async function DELETE() {
  const user = await getCurrentFakeUser();
  if (!user) return unauthorizedResponse();

  const { session } = await getMastraRuntime(user);

  if (session.run.isRunning()) {
    return Response.json(
      { error: "Wait for the current response to finish." },
      { status: 409 },
    );
  }

  await session.thread.create({ title: "New conversation" });
  return new Response(null, { status: 204 });
}
