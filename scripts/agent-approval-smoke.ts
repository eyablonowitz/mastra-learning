import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import type { LearningItemStatus } from "../src/mastra/learning-backlog-schema.ts";
import { createTemporaryLearningSmokeSpace } from "./learning-smoke-space.ts";

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

const fixture =
  await createTemporaryLearningSmokeSpace("agent-approval-smoke");
const [
  { getLearningSpaceRepository },
  { getLearningOwnerId },
  { getMastraRuntime },
  { createLearningRequestContext },
  { LEARNING_BACKLOG_WRITE_TOOL_NAMES },
] = await Promise.all([
  import("../src/app-data/learning-spaces.ts"),
  import("../src/lib/learning-identity.ts"),
  import("../src/mastra/runtime.ts"),
  import("../src/mastra/learning-request-context.ts"),
  import("../src/mastra/tools/learning-backlog.ts"),
]);
const repository = await getLearningSpaceRepository();
const ownerId = getLearningOwnerId(fixture.user.id);
const otherSpace = await repository.createLearningSpace(
  ownerId,
  "Approval Isolation Space",
);
const [{ session }, { session: otherSession }] = await Promise.all([
  getMastraRuntime(fixture.user, fixture.space),
  getMastraRuntime(fixture.user, otherSpace),
]);

async function runApprovalDecision({
  itemId,
  toolName,
  prompt,
  expectedStatusBefore,
  decision,
  probeOtherSpace = false,
}: {
  itemId: string;
  toolName: string;
  prompt: string;
  expectedStatusBefore: LearningItemStatus;
  decision: "approve" | "decline";
  probeOtherSpace?: boolean;
}) {
  await session.thread.create({ title: "Approval smoke conversation" });

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
        new Error(
          `AgentController error before approval: ${event.error.message}`,
        ),
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
      requestContext: createLearningRequestContext(
        fixture.user,
        fixture.space,
      ),
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

    const beforeDecision = await repository.getLearningItem(
      ownerId,
      fixture.space.id,
      itemId,
    );

    if (beforeDecision.status !== expectedStatusBefore) {
      throw new Error(
        `The item changed before the approval decision was sent: expected ${expectedStatusBefore}, received ${beforeDecision.status}.`,
      );
    }

    if (probeOtherSpace) {
      otherSession.respondToToolApproval({
        decision: "approve",
        toolCallId: approval.toolCallId,
        requestContext: createLearningRequestContext(
          fixture.user,
          otherSpace,
        ),
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      const afterWrongSessionDecision = await repository.getLearningItem(
        ownerId,
        fixture.space.id,
        itemId,
      );

      if (
        !session.approval.isArmed() ||
        afterWrongSessionDecision.status !== expectedStatusBefore
      ) {
        throw new Error(
          "An approval sent through another space affected the pending run.",
        );
      }
    }

    session.respondToToolApproval({
      decision,
      toolCallId: approval.toolCallId,
      requestContext: createLearningRequestContext(
        fixture.user,
        fixture.space,
      ),
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

    const afterDecision = await repository.getLearningItem(
      ownerId,
      fixture.space.id,
      itemId,
    );
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

async function runApprovalFlow() {
  const items = await repository.listLearningItems(
    ownerId,
    fixture.space.id,
  );
  const target = items.find((item) => item.status === "not-started");
  const completedTarget = items.find((item) => item.status === "completed");

  if (!target) {
    throw new Error(
      "The approval smoke test needs one not-started learning item.",
    );
  }

  if (!completedTarget) {
    throw new Error(
      "The approval smoke test needs one completed learning item.",
    );
  }

  const declined = await runApprovalDecision({
    itemId: target.id,
    toolName: LEARNING_BACKLOG_WRITE_TOOL_NAMES.markStarted,
    prompt: `Mark the learning item with exact id "${target.id}" started. This is an explicit request to make that change.`,
    expectedStatusBefore: "not-started",
    decision: "decline",
    probeOtherSpace: true,
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
  const approvedResult = approved.writeResult as
    | { changed?: unknown }
    | undefined;

  if (
    approved.afterDecision.status !== "in-progress" ||
    approvedResult?.changed !== true
  ) {
    throw new Error(
      `Approval did not start the item exactly once: ${JSON.stringify(approved.writeResult)}.`,
    );
  }

  console.log(`start approve: changed once; assistant: ${approved.finalText}`);

  const repeatedStart = await repository.markLearningItemStarted(
    ownerId,
    fixture.space.id,
    target.id,
  );

  if (
    repeatedStart.changed !== false ||
    repeatedStart.item.status !== "in-progress"
  ) {
    throw new Error("Repeating start was not idempotent.");
  }

  const protectedCompletion = await repository.markLearningItemStarted(
    ownerId,
    fixture.space.id,
    completedTarget.id,
  );

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

  const repeatedCompletion = await repository.markLearningItemComplete(
    ownerId,
    fixture.space.id,
    target.id,
  );

  if (
    repeatedCompletion.changed !== false ||
    repeatedCompletion.item.status !== "completed"
  ) {
    throw new Error("Repeating completion was not idempotent.");
  }

  console.log(`complete approve: changed once; assistant: ${completed.finalText}`);
  console.log(
    `approval flow successful in isolated space ${fixture.space.id}; temporary database will be removed`,
  );
}

try {
  await runApprovalFlow();
} finally {
  await fixture.cleanup();
}

process.exit(0);
