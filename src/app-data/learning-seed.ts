import { readFile } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import {
  learningBacklogSchema,
  type LearningBacklog,
} from "../mastra/learning-backlog-schema.ts";

const LEARNING_SEED_PATH = path.join(
  process.cwd(),
  "data",
  "learning-backlog.seed.json",
);

function formatValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

export async function loadLearningBacklogSeed(): Promise<LearningBacklog> {
  let text: string;

  try {
    text = await readFile(LEARNING_SEED_PATH, "utf8");
  } catch (error) {
    throw new Error("Could not read the learning backlog seed file.", {
      cause: error,
    });
  }

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error("The learning backlog seed file is not valid JSON.", {
      cause: error,
    });
  }

  try {
    return learningBacklogSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(
        `The learning backlog seed file is invalid: ${formatValidationError(error)}`,
        { cause: error },
      );
    }

    throw error;
  }
}
