import { z } from "zod";
import {
  LearningSpaceNameConflictError,
  type LearningSpace,
  type LearningSpaceRepository,
} from "../app-data/learning-spaces.ts";
import { LearningSpaceNameValidationError } from "../app-data/learning-space-name.ts";
import type { FakeUser } from "./fake-auth.ts";
import { getLearningOwnerId } from "./learning-identity.ts";

export const createLearningSpaceRequestSchema = z
  .object({
    name: z.string(),
  })
  .strict();

export type LearningSpaceCreationResult =
  | {
      ok: true;
      space: LearningSpace;
    }
  | {
      ok: false;
      status: 400 | 409;
      error: string;
    };

function hasErrorName(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}

export async function createLearningSpaceForUser(
  user: Pick<FakeUser, "id">,
  payload: unknown,
  repository: LearningSpaceRepository,
): Promise<LearningSpaceCreationResult> {
  const request = createLearningSpaceRequestSchema.safeParse(payload);

  if (!request.success) {
    return {
      ok: false,
      status: 400,
      error: "A space name is required.",
    };
  }

  try {
    return {
      ok: true,
      space: await repository.createLearningSpace(
        getLearningOwnerId(user.id),
        request.data.name,
      ),
    };
  } catch (error) {
    if (
      error instanceof LearningSpaceNameValidationError ||
      hasErrorName(error, "LearningSpaceNameValidationError")
    ) {
      return { ok: false, status: 400, error: error.message };
    }

    if (
      error instanceof LearningSpaceNameConflictError ||
      hasErrorName(error, "LearningSpaceNameConflictError")
    ) {
      return { ok: false, status: 409, error: error.message };
    }

    throw error;
  }
}
