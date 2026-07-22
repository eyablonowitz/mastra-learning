import { randomUUID } from "node:crypto";
import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  getLearningItem,
  markLearningItemComplete,
  markLearningItemStarted,
  readLearningBacklog,
  writeLearningBacklog,
} from "../src/mastra/learning-backlog-store.ts";
import type { LearningItemStatus } from "../src/mastra/learning-backlog-schema.ts";
import { getMastraController } from "../src/mastra/runtime.ts";
import { LEARNING_BACKLOG_WRITE_TOOL_NAMES } from "../src/mastra/tools/learning-backlog.ts";

type ApprovalEvent = Extract<
  AgentControllerEvent,
  { type: "tool_approval_required" }
>;

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 60_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}.`)),
      timeoutMs,
    );

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function runApprovalDecision({
  itemId,
  toolName,
  prompt,
  expectedStatusBefore,
  decision,
}: {
  itemId: string;
  toolName: (typeof LEARNING_BACKLOG_WRITE_TOOL_NAMES)[keyof typeof LEARNING_BACKLOG_WRITE_TOOL_NAMES];
  prompt: string;
  expectedStatusBefore: LearningItemStatus;
  decision: "approve" | "decline";
}) {
  const controller = await getMastraController();
  const smokeId = randomUUID();
  const session = await controller.createSession({
    id: `agent-approval-smoke-${smokeId}`,
    ownerId: "agent-approval-smoke",
    resourceId: `agent-approval-smoke-${smokeId}`,
  });
  await session.permissions.setForCategory({
    category: "read",
    policy: "allow",
  });
  await session.permissions.setForCategory({
    category: "edit",
    policy: "ask",
  });

  let resolveApproval: (event: ApprovalEvent) => void = () => undefined;
  let rejectApproval: (error: Error) => void = () => undefined;
  const approvalPromise = new Promise<ApprovalEvent>((resolve, reject) => {
    resolveApproval = resolve;
    rejectApproval = reject;
  });
  let writeResult: unknown;
  let approvalToolCallId: string | null = null;

  const unsubscribe = session.subscribe((event: AgentControllerEvent) => {
    if (event.type === "error") {
      rejectApproval(
        new Error(`AgentController error before approval: ${event.error.message}`),
      );
    }

    if (
      event.type === "tool_approval_required" &&
      event.toolName === toolName
    ) {
      approvalToolCallId = event.toolCallId;
      resolveApproval(event);
    }

    if (
      event.type === "tool_end" &&
      approvalToolCallId === event.toolCallId &&
      !event.isError
    ) {
      writeResult = event.result;
    }
  });

  try {
    const runPromise = session.sendMessage({
      content: prompt,
    });
    const approval = await withTimeout(
      Promise.race([
        approvalPromise,
        runPromise.then(async () => {
          const messages = await session.thread.listActiveMessages({ limit: 4 });
          const finalText = messages
            .filter((message) => message.role === "assistant")
            .at(-1)
            ?.content.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");

          throw new Error(
            `The agent finished without requesting approval.${finalText ? ` Final response: ${finalText}` : ""}`,
          );
        }),
      ]),
      "the write-tool approval request",
    );
    const args = approval.args as { id?: unknown };

    if (args.id !== itemId) {
      throw new Error(
        `Expected approval for item "${itemId}", received ${JSON.stringify(approval.args)}.`,
      );
    }

    const beforeDecision = await getLearningItem(itemId);
    if (beforeDecision.status !== expectedStatusBefore) {
      throw new Error(
        `The item changed before the approval decision was sent: expected ${expectedStatusBefore}, received ${beforeDecision.status}.`,
      );
    }

    session.respondToToolApproval({
      decision,
      toolCallId: approval.toolCallId,
      ...(decision === "decline"
        ? {
            declineContext: {
              reason: "smoke_test_decline",
              message: "The user declined this change.",
            },
          }
        : {}),
    });
    await withTimeout(runPromise, `the ${decision} run to finish`);

    const afterDecision = await getLearningItem(itemId);
    const messages = await session.thread.listActiveMessages({ limit: 4 });
    const finalText = messages
      .filter((message) => message.role === "assistant")
      .at(-1)
      ?.content.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    if (!finalText) {
      throw new Error(`Expected a final assistant response after ${decision}.`);
    }

    return { afterDecision, finalText, writeResult };
  } finally {
    unsubscribe();
  }
}

const originalBacklog = await readLearningBacklog();
const target = originalBacklog.items.find(
  (item) => item.status === "not-started",
);
const completedTarget = originalBacklog.items.find(
  (item) => item.status === "completed",
);

if (!target) {
  throw new Error("The approval smoke test needs one not-started learning item.");
}

if (!completedTarget) {
  throw new Error("The approval smoke test needs one completed learning item.");
}

try {
  const declined = await runApprovalDecision({
    itemId: target.id,
    toolName: LEARNING_BACKLOG_WRITE_TOOL_NAMES.markStarted,
    prompt: `Mark the learning item with exact id "${target.id}" started. This is an explicit request to make that change.`,
    expectedStatusBefore: "not-started",
    decision: "decline",
  });

  if (declined.afterDecision.status !== "not-started") {
    throw new Error("Declining the tool unexpectedly changed the backlog.");
  }

  console.log(`decline: unchanged; assistant: ${declined.finalText}`);

  const approved = await runApprovalDecision({
    itemId: target.id,
    toolName: LEARNING_BACKLOG_WRITE_TOOL_NAMES.markStarted,
    prompt: `Mark the learning item with exact id "${target.id}" started. This is an explicit request to make that change.`,
    expectedStatusBefore: "not-started",
    decision: "approve",
  });
  const approvedResult = approved.writeResult as { changed?: unknown } | undefined;

  if (
    approved.afterDecision.status !== "in-progress" ||
    approvedResult?.changed !== true
  ) {
    throw new Error(
      `Approval did not start the item exactly once: ${JSON.stringify(approved.writeResult)}.`,
    );
  }

  console.log(`start approve: changed once; assistant: ${approved.finalText}`);

  const repeatedStart = await markLearningItemStarted(target.id);
  if (
    repeatedStart.changed !== false ||
    repeatedStart.item.status !== "in-progress"
  ) {
    throw new Error("Repeating start was not idempotent.");
  }

  const protectedCompletion = await markLearningItemStarted(completedTarget.id);
  if (
    protectedCompletion.changed !== false ||
    protectedCompletion.item.status !== "completed"
  ) {
    throw new Error("Starting an already completed item regressed its status.");
  }

  console.log("start repeat and completed-item protection: changed=false");

  const completed = await runApprovalDecision({
    itemId: target.id,
    toolName: LEARNING_BACKLOG_WRITE_TOOL_NAMES.markComplete,
    prompt: `Mark the learning item with exact id "${target.id}" complete. This is an explicit request to make that change.`,
    expectedStatusBefore: "in-progress",
    decision: "approve",
  });
  const completedResult = completed.writeResult as
    | { changed?: unknown }
    | undefined;

  if (
    completed.afterDecision.status !== "completed" ||
    completedResult?.changed !== true
  ) {
    throw new Error(
      `Approval did not complete the started item exactly once: ${JSON.stringify(completed.writeResult)}.`,
    );
  }

  const repeatedCompletion = await markLearningItemComplete(target.id);
  if (
    repeatedCompletion.changed !== false ||
    repeatedCompletion.item.status !== "completed"
  ) {
    throw new Error("Repeating completion was not idempotent.");
  }

  console.log(`complete approve: changed once; assistant: ${completed.finalText}`);
  console.log("approval flow successful; original backlog will be restored");
} finally {
  await writeLearningBacklog(originalBacklog);
}

process.exit(0);
