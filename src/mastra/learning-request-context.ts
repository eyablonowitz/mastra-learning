import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import type { LearningSpace } from "../app-data/learning-spaces.ts";
import type { FakeUser } from "../lib/fake-auth.ts";

export const learningRequestIdentitySchema = z
  .object({
    userId: z.string().trim().min(1),
    spaceId: z.uuid(),
  })
  .strict();

export const learningRequestContextSchema =
  learningRequestIdentitySchema.passthrough();

export type LearningRequestContext = z.infer<
  typeof learningRequestIdentitySchema
>;

export function createLearningRequestContext(
  user: Pick<FakeUser, "id">,
  space: Pick<LearningSpace, "id">,
): RequestContext {
  const value = learningRequestIdentitySchema.parse({
    userId: user.id,
    spaceId: space.id,
  });
  const requestContext = new RequestContext();

  requestContext.set("userId", value.userId);
  requestContext.set("spaceId", value.spaceId);

  return requestContext;
}

export function requireLearningRequestContext(
  requestContext: { readonly all: unknown } | undefined,
): LearningRequestContext {
  if (!requestContext) {
    throw new Error("Learning request context is required.");
  }

  const value = learningRequestContextSchema.parse(requestContext.all);

  return learningRequestIdentitySchema.parse({
    userId: value.userId,
    spaceId: value.spaceId,
  });
}
