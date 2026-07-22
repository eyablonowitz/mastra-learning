import { randomUUID } from "node:crypto";
import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import { getMastraController } from "../src/mastra/runtime.ts";
import { LEARNING_BACKLOG_READ_TOOL_NAMES } from "../src/mastra/tools/learning-backlog.ts";

const controller = await getMastraController();
const smokeId = randomUUID();
const session = await controller.createSession({
  id: `agent-tools-smoke-${smokeId}`,
  ownerId: "agent-tools-smoke",
  resourceId: `agent-tools-smoke-${smokeId}`,
});
await session.permissions.setForCategory({
  category: "read",
  policy: "allow",
});

const observedToolNames = new Map<string, string>();

const unsubscribe = session.subscribe((event: AgentControllerEvent) => {
  if (event.type === "tool_start") {
    observedToolNames.set(event.toolCallId, event.toolName);
    console.log(
      `tool_start: ${event.toolName} ${JSON.stringify(event.args)}`,
    );
  }

  if (event.type === "tool_end") {
    const toolName = observedToolNames.get(event.toolCallId) ?? "unknown";
    console.log(
      `tool_end: ${toolName} (${event.isError ? "error" : "success"}) ${JSON.stringify(event.result)}`,
    );
  }

  if (event.type === "error") {
    console.error(`event: error - ${event.error.message}`);
  }
});

try {
  await session.sendMessage({
    content:
      "List my learning backlog. Then inspect the full details of the agent-tools item using its exact id. Only after both observations, explain why it is the best next topic.",
  });

  const messages = await session.thread.listActiveMessages({ limit: 4 });
  const finalAssistantMessage = messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  const finalText = finalAssistantMessage?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  if (
    ![...observedToolNames.values()].includes(
      LEARNING_BACKLOG_READ_TOOL_NAMES.list,
    )
  ) {
    throw new Error(
      `Expected the agent to call ${LEARNING_BACKLOG_READ_TOOL_NAMES.list}.`,
    );
  }

  if (
    ![...observedToolNames.values()].includes(
      LEARNING_BACKLOG_READ_TOOL_NAMES.get,
    )
  ) {
    throw new Error(
      `Expected the agent to call ${LEARNING_BACKLOG_READ_TOOL_NAMES.get}.`,
    );
  }

  if (!finalText) {
    throw new Error("Expected a final assistant response after the tool calls.");
  }

  console.log(`assistant: ${finalText}`);
  console.log("Agent read-tool loop successful");
} finally {
  unsubscribe();
}

process.exit(0);
