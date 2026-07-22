import { createHash } from "node:crypto";

export const FAKE_AUTH_COOKIE_NAME = "mastra_learning_user";
export const FAKE_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const COOKIE_VERSION = 1;
const MAX_COOKIE_LENGTH = 512;
const MAX_NAME_LENGTH = 50;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

export interface FakeUser {
  id: string;
  displayName: string;
  identityName: string;
}

interface FakeAuthCookiePayload {
  version: typeof COOKIE_VERSION;
  name: string;
}

export class FakeAuthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FakeAuthValidationError";
  }
}

export function createFakeUser(name: string): FakeUser {
  const unicodeNormalizedName = name.normalize("NFKC");

  if (CONTROL_CHARACTERS.test(unicodeNormalizedName)) {
    throw new FakeAuthValidationError(
      "Name cannot contain control or invisible formatting characters.",
    );
  }

  const displayName = unicodeNormalizedName.trim().replace(/\s+/gu, " ");
  const length = [...displayName].length;

  if (length === 0) {
    throw new FakeAuthValidationError("Name is required.");
  }

  if (length > MAX_NAME_LENGTH) {
    throw new FakeAuthValidationError(
      `Name must be ${MAX_NAME_LENGTH} characters or fewer.`,
    );
  }

  const identityName = displayName.toLocaleLowerCase("en-US");
  const id = createHash("sha256")
    .update(identityName, "utf8")
    .digest("hex")
    .slice(0, 32);

  return { id, displayName, identityName };
}

export function encodeFakeAuthCookie(user: FakeUser): string {
  const payload: FakeAuthCookiePayload = {
    version: COOKIE_VERSION,
    name: user.displayName,
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeFakeAuthCookie(value: string | undefined): FakeUser | null {
  if (!value || value.length > MAX_COOKIE_LENGTH) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<FakeAuthCookiePayload>;

    if (payload.version !== COOKIE_VERSION || typeof payload.name !== "string") {
      return null;
    }

    return createFakeUser(payload.name);
  } catch {
    return null;
  }
}
