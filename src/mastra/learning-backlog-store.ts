import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import {
  learningBacklogSchema,
  type LearningBacklog,
  type LearningItem,
  type LearningItemStatus,
  type LearningItemSummary,
} from "./learning-backlog-schema.ts";

const DATA_DIRECTORY = path.join(process.cwd(), ".data");
const SEED_PATH = path.join(
  process.cwd(),
  "data",
  "learning-backlog.seed.json",
);

export const learningBacklogDataPath = path.join(
  DATA_DIRECTORY,
  "learning-backlog.json",
);

function formatValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

async function readBacklogFile(
  filePath: string,
  label: "seed" | "runtime",
): Promise<LearningBacklog> {
  let text: string;

  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read the learning backlog ${label} file.`, {
      cause: error,
    });
  }

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`The learning backlog ${label} file is not valid JSON.`, {
      cause: error,
    });
  }

  try {
    return learningBacklogSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(
        `The learning backlog ${label} file is invalid: ${formatValidationError(error)}`,
        { cause: error },
      );
    }

    throw error;
  }
}

async function initializeRuntimeBacklog(): Promise<LearningBacklog> {
  const seed = await readBacklogFile(SEED_PATH, "seed");
  await writeLearningBacklog(seed);
  return seed;
}

export async function readLearningBacklog(): Promise<LearningBacklog> {
  try {
    return await readBacklogFile(learningBacklogDataPath, "runtime");
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;

    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "ENOENT"
    ) {
      return initializeRuntimeBacklog();
    }

    throw error;
  }
}

export async function writeLearningBacklog(
  value: LearningBacklog,
): Promise<void> {
  const backlog = learningBacklogSchema.parse(value);
  await mkdir(DATA_DIRECTORY, { recursive: true });

  const temporaryPath = path.join(
    DATA_DIRECTORY,
    `.learning-backlog.${process.pid}.${randomUUID()}.tmp`,
  );

  await writeFile(temporaryPath, `${JSON.stringify(backlog, null, 2)}\n`, "utf8");
  await rename(temporaryPath, learningBacklogDataPath);
}

export async function listLearningItems(
  status?: LearningItemStatus,
): Promise<LearningItemSummary[]> {
  const { items } = await readLearningBacklog();

  return items
    .filter((item) => status === undefined || item.status === status)
    .map((item) => ({
      id: item.id,
      topic: item.topic,
      difficulty: item.difficulty,
      prerequisites: item.prerequisites,
      status: item.status,
    }));
}

export async function getLearningItem(id: string): Promise<LearningItem> {
  const { items } = await readLearningBacklog();
  const item = items.find((candidate) => candidate.id === id);

  if (!item) {
    throw new Error(`No learning item exists with id "${id}".`);
  }

  return item;
}

export async function markLearningItemStarted(
  id: string,
): Promise<{ item: LearningItem; changed: boolean }> {
  const backlog = await readLearningBacklog();
  const index = backlog.items.findIndex((item) => item.id === id);

  if (index === -1) {
    throw new Error(`No learning item exists with id "${id}".`);
  }

  const item = backlog.items[index];

  if (item.status !== "not-started") {
    return { item, changed: false };
  }

  const startedItem: LearningItem = {
    ...item,
    status: "in-progress",
  };
  const items = [...backlog.items];
  items[index] = startedItem;

  await writeLearningBacklog({ items });

  return { item: startedItem, changed: true };
}

export async function markLearningItemComplete(
  id: string,
): Promise<{ item: LearningItem; changed: boolean }> {
  const backlog = await readLearningBacklog();
  const index = backlog.items.findIndex((item) => item.id === id);

  if (index === -1) {
    throw new Error(`No learning item exists with id "${id}".`);
  }

  const item = backlog.items[index];

  if (item.status === "completed") {
    return { item, changed: false };
  }

  const completedItem: LearningItem = {
    ...item,
    status: "completed",
  };
  const items = [...backlog.items];
  items[index] = completedItem;

  await writeLearningBacklog({ items });

  return { item: completedItem, changed: true };
}
