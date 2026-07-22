import assert from "node:assert/strict";
import test from "node:test";
import {
  createFakeUser,
  decodeFakeAuthCookie,
  encodeFakeAuthCookie,
  FakeAuthValidationError,
} from "./fake-auth.ts";

test("normalizes equivalent names to one stable identity", () => {
  const alice = createFakeUser("Alice");
  const variants = [
    createFakeUser("alice"),
    createFakeUser("  Alice  "),
    createFakeUser("Ａｌｉｃｅ"),
  ];

  for (const variant of variants) {
    assert.equal(variant.id, alice.id);
    assert.equal(variant.identityName, alice.identityName);
  }

  assert.equal(createFakeUser("Ada   Lovelace").displayName, "Ada Lovelace");
  assert.notEqual(createFakeUser("Bob").id, alice.id);
});

test("validates names", () => {
  assert.throws(() => createFakeUser("   "), FakeAuthValidationError);
  assert.throws(() => createFakeUser("Alice\nBob"), FakeAuthValidationError);
  assert.throws(() => createFakeUser(`A\u200bB`), FakeAuthValidationError);
  assert.throws(() => createFakeUser("A".repeat(51)), FakeAuthValidationError);
  assert.equal([...createFakeUser("😀".repeat(50)).displayName].length, 50);
});

test("round trips versioned cookies and rejects invalid values", () => {
  const user = createFakeUser("Ada Lovelace");
  const decoded = decodeFakeAuthCookie(encodeFakeAuthCookie(user));

  assert.deepEqual(decoded, user);
  assert.equal(decodeFakeAuthCookie(undefined), null);
  assert.equal(decodeFakeAuthCookie("not-json"), null);
  assert.equal(
    decodeFakeAuthCookie(
      Buffer.from(JSON.stringify({ version: 2, name: "Ada" })).toString(
        "base64url",
      ),
    ),
    null,
  );
});
