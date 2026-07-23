import assert from "node:assert/strict";
import test from "node:test";
import {
  getLearningIdentifiers,
  getLearningOwnerId,
  getLearningResourceId,
  getLearningSessionId,
} from "./learning-identity.ts";

test("derives stable owner, resource, and session identifiers", () => {
  const user = { id: "user-123" };
  const space = { id: "space-abc" };

  assert.deepEqual(getLearningIdentifiers(user, space), {
    ownerId: "fake-user:user-123",
    resourceId: "learning-space:user-123:space-abc",
    sessionId: "learning-session:user-123:space-abc",
  });
  assert.equal(getLearningOwnerId(user.id), "fake-user:user-123");
  assert.equal(
    getLearningResourceId(user.id, space.id),
    "learning-space:user-123:space-abc",
  );
  assert.equal(
    getLearningSessionId(user.id, space.id),
    "learning-session:user-123:space-abc",
  );
});

test("keeps spaces and users in separate resource and session identities", () => {
  const first = getLearningIdentifiers(
    { id: "user-a" },
    { id: "space-one" },
  );
  const secondSpace = getLearningIdentifiers(
    { id: "user-a" },
    { id: "space-two" },
  );
  const secondUser = getLearningIdentifiers(
    { id: "user-b" },
    { id: "space-one" },
  );

  assert.equal(first.ownerId, secondSpace.ownerId);
  assert.notEqual(first.resourceId, secondSpace.resourceId);
  assert.notEqual(first.sessionId, secondSpace.sessionId);
  assert.notEqual(first.ownerId, secondUser.ownerId);
  assert.notEqual(first.resourceId, secondUser.resourceId);
  assert.notEqual(first.sessionId, secondUser.sessionId);
});
