import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getLearningSpaceRepository } from "../../app-data/learning-spaces.ts";
import { getLearningOwnerId } from "../../lib/learning-identity.ts";
import {
  learningItemSchema,
  learningItemStatusSchema,
  learningItemSummarySchema,
} from "../learning-backlog-schema.ts";
import {
  learningRequestContextSchema,
  requireLearningRequestContext,
} from "../learning-request-context.ts";

export const LEARNING_BACKLOG_READ_TOOL_NAMES = {
  list: "list_learning_items",
  get: "get_learning_item",
} as const;

export const LEARNING_BACKLOG_WRITE_TOOL_NAMES = {
  markStarted: "mark_learning_item_started",
  markComplete: "mark_learning_item_complete",
} as const;

export const listLearningItemsTool = createTool({
  id: LEARNING_BACKLOG_READ_TOOL_NAMES.list,
  description:
    "List the current local learning backlog. Use this whenever a response depends on which topics exist or their current status, difficulty, or prerequisites.",
  inputSchema: z
    .object({
      status: learningItemStatusSchema
        .optional()
        .describe("Only return items with this status when provided."),
    })
    .strict(),
  outputSchema: z
    .object({
      items: z.array(learningItemSummarySchema),
    })
    .strict(),
  requestContextSchema: learningRequestContextSchema,
  // Function-form approval is authoritative over AgentController's global
  // approval gate, so harmless reads stay inside one uninterrupted tool loop.
  requireApproval: () => false,
  execute: async ({ status }, { requestContext }) => {
    const identity = requireLearningRequestContext(requestContext);
    const repository = await getLearningSpaceRepository();

    return {
      items: await repository.listLearningItems(
        getLearningOwnerId(identity.userId),
        identity.spaceId,
        status,
      ),
    };
  },
});

export const getLearningItemTool = createTool({
  id: LEARNING_BACKLOG_READ_TOOL_NAMES.get,
  description:
    "Get the full description and current state of one learning item by its exact id. Use this only when the details affect the answer.",
  inputSchema: z
    .object({
      id: z.string().trim().min(1).describe("The exact learning item id."),
    })
    .strict(),
  outputSchema: z
    .object({
      item: learningItemSchema,
    })
    .strict(),
  requestContextSchema: learningRequestContextSchema,
  requireApproval: () => false,
  execute: async ({ id }, { requestContext }) => {
    const identity = requireLearningRequestContext(requestContext);
    const repository = await getLearningSpaceRepository();

    return {
      item: await repository.getLearningItem(
        getLearningOwnerId(identity.userId),
        identity.spaceId,
        id,
      ),
    };
  },
});

export const markLearningItemCompleteTool = createTool({
  id: LEARNING_BACKLOG_WRITE_TOOL_NAMES.markComplete,
  description:
    "Mark one learning backlog item complete by its exact id. Use this only when the user explicitly asks to make that change.",
  inputSchema: z
    .object({
      id: z.string().trim().min(1).describe("The exact learning item id."),
    })
    .strict(),
  outputSchema: z
    .object({
      item: learningItemSchema,
      changed: z.boolean(),
    })
    .strict(),
  requestContextSchema: learningRequestContextSchema,
  requireApproval: true,
  execute: async ({ id }, { requestContext }) => {
    const identity = requireLearningRequestContext(requestContext);
    const repository = await getLearningSpaceRepository();

    return repository.markLearningItemComplete(
      getLearningOwnerId(identity.userId),
      identity.spaceId,
      id,
    );
  },
});

export const markLearningItemStartedTool = createTool({
  id: LEARNING_BACKLOG_WRITE_TOOL_NAMES.markStarted,
  description:
    "Mark one not-started learning backlog item in progress by its exact id. Use this only when the user explicitly asks to start that item. This never changes an in-progress or completed item.",
  inputSchema: z
    .object({
      id: z.string().trim().min(1).describe("The exact learning item id."),
    })
    .strict(),
  outputSchema: z
    .object({
      item: learningItemSchema,
      changed: z.boolean(),
    })
    .strict(),
  requestContextSchema: learningRequestContextSchema,
  requireApproval: true,
  execute: async ({ id }, { requestContext }) => {
    const identity = requireLearningRequestContext(requestContext);
    const repository = await getLearningSpaceRepository();

    return repository.markLearningItemStarted(
      getLearningOwnerId(identity.userId),
      identity.spaceId,
      id,
    );
  },
});

export const learningBacklogReadTools = {
  [LEARNING_BACKLOG_READ_TOOL_NAMES.list]: listLearningItemsTool,
  [LEARNING_BACKLOG_READ_TOOL_NAMES.get]: getLearningItemTool,
};

export const learningBacklogTools = {
  ...learningBacklogReadTools,
  [LEARNING_BACKLOG_WRITE_TOOL_NAMES.markStarted]:
    markLearningItemStartedTool,
  [LEARNING_BACKLOG_WRITE_TOOL_NAMES.markComplete]:
    markLearningItemCompleteTool,
};
