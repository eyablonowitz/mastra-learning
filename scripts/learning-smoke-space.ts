import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LearningSpace } from "../src/app-data/learning-spaces.ts";
import type { FakeUser } from "../src/lib/fake-auth.ts";

export interface LearningSmokeSpace {
  user: FakeUser;
  space: LearningSpace;
}

export interface TemporaryLearningSmokeSpace extends LearningSmokeSpace {
  cleanup: () => Promise<void>;
}

export async function getPersistentLearningSmokeSpace(
  userName: string,
): Promise<LearningSmokeSpace> {
  const [
    { getLearningSpaceRepository },
    { createFakeUser },
    { getLearningOwnerId },
  ] = await Promise.all([
    import("../src/app-data/learning-spaces.ts"),
    import("../src/lib/fake-auth.ts"),
    import("../src/lib/learning-identity.ts"),
  ]);
  const user = createFakeUser(userName);
  const repository = await getLearningSpaceRepository();
  const spaces = await repository.listOrCreateDefaultLearningSpaces(
    getLearningOwnerId(user.id),
  );

  return { user, space: spaces[0] };
}

export async function createTemporaryLearningSmokeSpace(
  label: string,
): Promise<TemporaryLearningSmokeSpace> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "mastra-learning-smoke-"),
  );
  const databasePath = path.join(directory, "app.db");
  const previousDatabasePath =
    process.env.MASTRA_LEARNING_APP_DATABASE_PATH;

  process.env.MASTRA_LEARNING_APP_DATABASE_PATH = databasePath;

  try {
    const [
      { getLearningSpaceRepository },
      { createFakeUser },
      { getLearningOwnerId },
      { closeApplicationDatabase },
    ] = await Promise.all([
      import("../src/app-data/learning-spaces.ts"),
      import("../src/lib/fake-auth.ts"),
      import("../src/lib/learning-identity.ts"),
      import("../src/app-data/database.ts"),
    ]);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const user = createFakeUser(`${label}-${suffix}`);
    const repository = await getLearningSpaceRepository(databasePath);
    const spaces = await repository.listOrCreateDefaultLearningSpaces(
      getLearningOwnerId(user.id),
    );

    return {
      user,
      space: spaces[0],
      cleanup: async () => {
        await closeApplicationDatabase(databasePath);

        if (previousDatabasePath === undefined) {
          delete process.env.MASTRA_LEARNING_APP_DATABASE_PATH;
        } else {
          process.env.MASTRA_LEARNING_APP_DATABASE_PATH =
            previousDatabasePath;
        }

        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (previousDatabasePath === undefined) {
      delete process.env.MASTRA_LEARNING_APP_DATABASE_PATH;
    } else {
      process.env.MASTRA_LEARNING_APP_DATABASE_PATH = previousDatabasePath;
    }

    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
