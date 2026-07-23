export interface NormalizedOwnedName {
  displayName: string;
  identityName: string;
}

export function normalizeOwnedName(
  value: string,
  options: {
    label: string;
    maxLength: number;
    createError: (message: string) => Error;
  },
): NormalizedOwnedName {
  const unicodeNormalizedName = value.normalize("NFKC");

  if (/[\p{Cc}\p{Cf}]/u.test(unicodeNormalizedName)) {
    throw options.createError(
      `${options.label} cannot contain control or invisible formatting characters.`,
    );
  }

  const displayName = unicodeNormalizedName.trim().replace(/\s+/gu, " ");
  const length = [...displayName].length;

  if (length === 0) {
    throw options.createError(`${options.label} is required.`);
  }

  if (length > options.maxLength) {
    throw options.createError(
      `${options.label} must be ${options.maxLength} characters or fewer.`,
    );
  }

  return {
    displayName,
    identityName: displayName.toLocaleLowerCase("en-US"),
  };
}
