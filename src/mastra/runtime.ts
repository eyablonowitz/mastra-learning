import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AgentController } from "@mastra/core/agent-controller";
import type { Session } from "@mastra/core/agent-controller";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import type { LearningSpace } from "../app-data/learning-spaces.ts";
import type { FakeUser } from "../lib/fake-auth.ts";
import { getLearningIdentifiers } from "../lib/learning-identity.ts";
import { learningAgent } from "./agent.ts";
import {
  LEARNING_BACKLOG_READ_TOOL_NAMES,
  LEARNING_BACKLOG_WRITE_TOOL_NAMES,
} from "./tools/learning-backlog.ts";

const DATA_DIRECTORY = path.join(process.cwd(), ".data");
const DATABASE_PATH = path.join(DATA_DIRECTORY, "mastra.db");
const WORKSPACE_PATH = path.join(DATA_DIRECTORY, "workspace");
const LEARNING_BACKLOG_READ_TOOLS = Object.values(
  LEARNING_BACKLOG_READ_TOOL_NAMES,
);
const LEARNING_BACKLOG_EDIT_TOOLS = Object.values(
  LEARNING_BACKLOG_WRITE_TOOL_NAMES,
);
const LEARNING_BACKLOG_TOOLS = [
  ...LEARNING_BACKLOG_READ_TOOLS,
  ...LEARNING_BACKLOG_EDIT_TOOLS,
];

export interface MastraRuntime {
  controller: AgentController;
  session: Session;
}

async function createController(): Promise<AgentController> {
  await Promise.all([
    mkdir(DATA_DIRECTORY, { recursive: true }),
    mkdir(WORKSPACE_PATH, { recursive: true }),
  ]);

  const storage = new LibSQLStore({
    id: "mastra-learning-storage",
    url: `file:${DATABASE_PATH}`,
  });

  const controller = new AgentController({
    id: "mastra-learning-controller",
    resourceId: "local-learning-chat",
    storage,
    memory: new Memory({
      storage,
      vector: false,
      options: {
        lastMessages: 20,
      },
    }),
    agent: learningAgent,
    workspace: new Workspace({
      id: "mastra-learning-workspace",
      name: "Mastra Learning Workspace",
      filesystem: new LocalFilesystem({
        id: "mastra-learning-filesystem",
        basePath: WORKSPACE_PATH,
        contained: true,
        readOnly: true,
        instructions: "",
      }),
    }),
    defaultModeId: "chat",
    modes: [
      {
        id: "chat",
        name: "Chat",
        description:
          "A conversation with read access and approval-gated status updates for a local learning backlog.",
        availableTools: LEARNING_BACKLOG_TOOLS,
      },
    ],
    toolCategoryResolver: (toolName) => {
      if (
        LEARNING_BACKLOG_READ_TOOLS.includes(
          toolName as (typeof LEARNING_BACKLOG_READ_TOOLS)[number],
        )
      ) {
        return "read";
      }

      if (
        LEARNING_BACKLOG_EDIT_TOOLS.includes(
          toolName as (typeof LEARNING_BACKLOG_EDIT_TOOLS)[number],
        )
      ) {
        return "edit";
      }

      return null;
    },
    disableBuiltinTools: [
      "ask_user",
      "submit_plan",
      "task_write",
      "task_update",
      "task_complete",
      "task_check",
      "subagent",
    ],
  });

  await controller.init();

  return controller;
}

async function createSpaceRuntime(
  user: FakeUser,
  space: LearningSpace,
): Promise<MastraRuntime> {
  const controller = await getMastraController();
  const { ownerId, resourceId, sessionId } = getLearningIdentifiers(
    user,
    space,
  );
  const existingSession = await controller.getSessionByResource(resourceId);
  const session =
    existingSession ??
    (await controller.createSession({
      id: sessionId,
      ownerId,
      resourceId,
    }));

  await session.permissions.setForCategory({
    category: "read",
    policy: "allow",
  });
  await session.permissions.setForCategory({
    category: "edit",
    policy: "ask",
  });

  return { controller, session };
}

const globalRuntime = globalThis as typeof globalThis & {
  mastraLearningController?: Promise<AgentController>;
  mastraLearningSpaceSessions?: Map<string, Promise<MastraRuntime>>;
};

export function getMastraController(): Promise<AgentController> {
  globalRuntime.mastraLearningController ??= createController();
  return globalRuntime.mastraLearningController;
}

export function getMastraRuntime(
  user: FakeUser,
  space: LearningSpace,
): Promise<MastraRuntime> {
  const sessions = (globalRuntime.mastraLearningSpaceSessions ??= new Map());
  const { resourceId } = getLearningIdentifiers(user, space);
  const cached = sessions.get(resourceId);

  if (cached) return cached;

  const runtimePromise = createSpaceRuntime(user, space);
  sessions.set(resourceId, runtimePromise);
  void runtimePromise.catch(() => {
    if (sessions.get(resourceId) === runtimePromise) {
      sessions.delete(resourceId);
    }
  });

  return runtimePromise;
}

export const mastraDataLocation = DATABASE_PATH;
