import "server-only";
import type { LearningSpace } from "../app-data/learning-spaces.ts";
import {
  getLearningSpaceRepository,
  type LearningSpaceRepository,
} from "../app-data/learning-spaces.ts";
import type { FakeUser } from "./fake-auth.ts";
import { getCurrentFakeUser, unauthorizedResponse } from "./current-user.ts";
import { getLearningOwnerId } from "./learning-identity.ts";

export interface AuthorizedLearningSpace {
  user: FakeUser;
  space: LearningSpace;
  repository: LearningSpaceRepository;
}

export type LearningSpaceAuthorization =
  | { authorized: true; value: AuthorizedLearningSpace }
  | { authorized: false; response: Response };

export async function authorizeLearningSpace(
  spaceId: string,
): Promise<LearningSpaceAuthorization> {
  const user = await getCurrentFakeUser();

  if (!user) {
    return { authorized: false, response: unauthorizedResponse() };
  }

  const repository = await getLearningSpaceRepository();
  const space = await repository.getOwnedLearningSpace(
    getLearningOwnerId(user.id),
    spaceId,
  );

  if (!space) {
    return {
      authorized: false,
      response: Response.json(
        { error: "The learning space was not found." },
        { status: 404 },
      ),
    };
  }

  return {
    authorized: true,
    value: { user, space, repository },
  };
}
