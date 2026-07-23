import type { LearningSpace } from "../app-data/learning-spaces.ts";
import type { FakeUser } from "./fake-auth.ts";

export const DEFAULT_LEARNING_SPACE_NAME = "Mastra Fundamentals";

export interface LearningIdentifiers {
  ownerId: string;
  resourceId: string;
  sessionId: string;
}

export function getLearningOwnerId(userId: string): string {
  return `fake-user:${userId}`;
}

export function getLearningResourceId(
  userId: string,
  spaceId: string,
): string {
  return `learning-space:${userId}:${spaceId}`;
}

export function getLearningSessionId(
  userId: string,
  spaceId: string,
): string {
  return `learning-session:${userId}:${spaceId}`;
}

export function getLearningIdentifiers(
  user: Pick<FakeUser, "id">,
  space: Pick<LearningSpace, "id">,
): LearningIdentifiers {
  return {
    ownerId: getLearningOwnerId(user.id),
    resourceId: getLearningResourceId(user.id, space.id),
    sessionId: getLearningSessionId(user.id, space.id),
  };
}
