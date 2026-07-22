import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AgentController } from "@mastra/core/agent-controller";
import type { Session } from "@mastra/core/agent-controller";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import type { FakeUser } from "../lib/fake-auth.ts";
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

async function createUserRuntime(user: FakeUser): Promise<MastraRuntime> {
  const controller = await getMastraController();
  const resourceId = `fake-chat:${user.id}`;
  const existingSession = await controller.getSessionByResource(resourceId);
  const session =
    existingSession ??
    (await controller.createSession({
      id: `fake-session:${user.id}`,
      ownerId: `fake-user:${user.id}`,
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
  mastraLearningUserSessions?: Map<string, Promise<MastraRuntime>>;
};

export function getMastraController(): Promise<AgentController> {
  globalRuntime.mastraLearningController ??= createController();
  return globalRuntime.mastraLearningController;
}

export function getMastraRuntime(user: FakeUser): Promise<MastraRuntime> {
  const sessions = (globalRuntime.mastraLearningUserSessions ??= new Map());
  const cached = sessions.get(user.id);

  if (cached) return cached;

  const runtimePromise = createUserRuntime(user);
  sessions.set(user.id, runtimePromise);
  void runtimePromise.catch(() => {
    if (sessions.get(user.id) === runtimePromise) {
      sessions.delete(user.id);
    }
  });

  return runtimePromise;
}

export const mastraDataLocation = DATABASE_PATH;
