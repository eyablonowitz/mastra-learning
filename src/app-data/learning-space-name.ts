import { normalizeOwnedName } from "../lib/name-normalization.ts";

const MAX_LEARNING_SPACE_NAME_LENGTH = 60;

export interface NormalizedLearningSpaceName {
  name: string;
  normalizedName: string;
}

export class LearningSpaceNameValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningSpaceNameValidationError";
  }
}

export function normalizeLearningSpaceName(
  value: string,
): NormalizedLearningSpaceName {
  const { displayName, identityName } = normalizeOwnedName(value, {
    label: "Space name",
    maxLength: MAX_LEARNING_SPACE_NAME_LENGTH,
    createError: (message) => new LearningSpaceNameValidationError(message),
  });

  return {
    name: displayName,
    normalizedName: identityName,
  };
}
