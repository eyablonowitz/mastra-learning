import assert from "node:assert/strict";
import test from "node:test";
import {
  createLearningRequestContext,
  learningRequestContextSchema,
  learningRequestIdentitySchema,
  requireLearningRequestContext,
} from "./learning-request-context.ts";
import {
  getLearningItemTool,
  listLearningItemsTool,
  markLearningItemCompleteTool,
  markLearningItemStartedTool,
} from "./tools/learning-backlog.ts";

const user = { id: "user-123" };
const space = { id: "2c999a9e-11d8-47c8-bd69-944c967699e9" };

test("constructs a typed learning request context", () => {
  const requestContext = createLearningRequestContext(user, space);

  assert.deepEqual(requestContext.all, {
    userId: user.id,
    spaceId: space.id,
  });
  assert.deepEqual(requireLearningRequestContext(requestContext), {
    userId: user.id,
    spaceId: space.id,
  });
});

test("rejects missing, malformed, and untrusted context fields", () => {
  assert.throws(
    () => requireLearningRequestContext(undefined),
    /Learning request context is required/,
  );
  assert.equal(
    learningRequestIdentitySchema.safeParse({ userId: user.id }).success,
    false,
  );
  assert.equal(
    learningRequestIdentitySchema.safeParse({
      userId: user.id,
      spaceId: "not-a-uuid",
    }).success,
    false,
  );
  assert.equal(
    learningRequestIdentitySchema.safeParse({
      userId: user.id,
      spaceId: space.id,
      ownerId: "model-chosen-owner",
    }).success,
    false,
  );
  assert.equal(
    learningRequestContextSchema.safeParse({
      userId: user.id,
      spaceId: space.id,
      controller: { frameworkOwned: true },
    }).success,
    true,
  );
});

test("requires the same trusted context schema on every backlog tool", () => {
  for (const tool of [
    listLearningItemsTool,
    getLearningItemTool,
    markLearningItemStartedTool,
    markLearningItemCompleteTool,
  ]) {
    assert.equal(tool.requestContextSchema, learningRequestContextSchema);
  }
});
