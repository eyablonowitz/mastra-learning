import assert from "node:assert/strict";
import test from "node:test";
import {
  LearningSpaceNameValidationError,
  normalizeLearningSpaceName,
} from "./learning-space-name.ts";

test("normalizes equivalent learning-space names", () => {
  const expected = normalizeLearningSpaceName("Mastra Fundamentals");
  const variants = [
    normalizeLearningSpaceName("mastra fundamentals"),
    normalizeLearningSpaceName("  Mastra   Fundamentals  "),
    normalizeLearningSpaceName("Ｍａｓｔｒａ Ｆｕｎｄａｍｅｎｔａｌｓ"),
  ];

  assert.equal(expected.name, "Mastra Fundamentals");

  for (const variant of variants) {
    assert.equal(variant.normalizedName, expected.normalizedName);
  }
});

test("validates learning-space names", () => {
  assert.throws(
    () => normalizeLearningSpaceName("   "),
    LearningSpaceNameValidationError,
  );
  assert.throws(
    () => normalizeLearningSpaceName("Space\nName"),
    LearningSpaceNameValidationError,
  );
  assert.throws(
    () => normalizeLearningSpaceName("Space\u200bName"),
    LearningSpaceNameValidationError,
  );
  assert.throws(
    () => normalizeLearningSpaceName("A".repeat(61)),
    LearningSpaceNameValidationError,
  );

  assert.equal(
    [...normalizeLearningSpaceName("😀".repeat(60)).name].length,
    60,
  );
});
