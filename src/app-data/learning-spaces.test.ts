import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Client } from "@libsql/client";
import {
  closeApplicationDatabase,
  getApplicationDatabase,
} from "./database.ts";
import { loadLearningBacklogSeed } from "./learning-seed.ts";
import {
  LearningItemNotFoundError,
  LearningSpaceNameConflictError,
  LearningSpaceNotFoundError,
  LearningSpaceRepository,
} from "./learning-spaces.ts";

async function withRepository(
  run: (repository: LearningSpaceRepository, client: Client) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "mastra-learning-repository-"),
  );
  const databasePath = path.join(directory, "app.db");

  try {
    const client = await getApplicationDatabase(databasePath);
    await run(new LearningSpaceRepository(client), client);
  } finally {
    await closeApplicationDatabase(databasePath);
    await rm(directory, { recursive: true, force: true });
  }
}

test("atomically creates an owned space from the validated seed", async () => {
  await withRepository(async (repository) => {
    const seed = await loadLearningBacklogSeed();
    const space = await repository.createLearningSpace(
      "owner-a",
      "  Mastra   Fundamentals  ",
    );
    const spaces = await repository.listLearningSpaces("owner-a");
    const items = await repository.listLearningItems("owner-a", space.id);

    assert.equal(space.name, "Mastra Fundamentals");
    assert.deepEqual(spaces, [space]);
    assert.deepEqual(
      items.map((item) => item.id),
      seed.items.map((item) => item.id),
    );
    assert.deepEqual(
      items.map((item) => item.status),
      seed.items.map((item) => item.status),
    );

    const firstItem = await repository.getLearningItem(
      "owner-a",
      space.id,
      seed.items[0].id,
    );

    assert.deepEqual(firstItem, seed.items[0]);
  });
});

test("enforces normalized-name uniqueness per owner", async () => {
  await withRepository(async (repository) => {
    const first = await repository.createLearningSpace(
      "owner-a",
      "Mastra Fundamentals",
    );

    await assert.rejects(
      repository.createLearningSpace(
        "owner-a",
        "  ＭＡＳＴＲＡ   fundamentals ",
      ),
      LearningSpaceNameConflictError,
    );

    const otherOwner = await repository.createLearningSpace(
      "owner-b",
      "mastra fundamentals",
    );

    assert.notEqual(otherOwner.id, first.id);
    assert.equal(
      (await repository.listLearningSpaces("owner-a")).length,
      1,
    );
    assert.equal(
      (await repository.listLearningSpaces("owner-b")).length,
      1,
    );
  });
});

test("concurrent first requests converge on one default space", async () => {
  await withRepository(async (repository) => {
    const [first, second, third] = await Promise.all([
      repository.listOrCreateDefaultLearningSpaces("owner-a"),
      repository.listOrCreateDefaultLearningSpaces("owner-a"),
      repository.listOrCreateDefaultLearningSpaces("owner-a"),
    ]);

    assert.equal(first.length, 1);
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
    assert.equal(first[0].name, "Mastra Fundamentals");
    assert.equal(
      (await repository.listLearningSpaces("owner-a")).length,
      1,
    );

    const existing = await repository.createLearningSpace(
      "owner-b",
      "Existing Space",
    );
    assert.deepEqual(
      await repository.listOrCreateDefaultLearningSpaces("owner-b"),
      [existing],
    );
  });
});

test("rolls back the space when a seed-item insert fails", async () => {
  await withRepository(async (repository, client) => {
    await client.execute(
      `CREATE TRIGGER fail_learning_item_insert
        BEFORE INSERT ON app_learning_items
        BEGIN
          SELECT RAISE(ABORT, 'forced seed failure');
        END`,
    );

    await assert.rejects(
      repository.createLearningSpace("owner-a", "Atomic Space"),
      /forced seed failure/,
    );
    assert.deepEqual(await repository.listLearningSpaces("owner-a"), []);

    await client.execute("DROP TRIGGER fail_learning_item_insert");

    const space = await repository.createLearningSpace(
      "owner-a",
      "Atomic Space",
    );

    assert.equal(
      (await repository.listLearningItems("owner-a", space.id)).length,
      (await loadLearningBacklogSeed()).items.length,
    );
  });
});

test("isolates spaces and items by both owner and space ID", async () => {
  await withRepository(async (repository) => {
    const first = await repository.createLearningSpace(
      "owner-a",
      "First Space",
    );
    const second = await repository.createLearningSpace(
      "owner-a",
      "Second Space",
    );
    const otherOwner = await repository.createLearningSpace(
      "owner-b",
      "First Space",
    );

    await repository.markLearningItemStarted(
      "owner-a",
      first.id,
      "agent-tools",
    );

    assert.equal(
      (await repository.getLearningItem("owner-a", first.id, "agent-tools"))
        .status,
      "in-progress",
    );
    assert.equal(
      (await repository.getLearningItem("owner-a", second.id, "agent-tools"))
        .status,
      "not-started",
    );
    assert.equal(
      (
        await repository.getLearningItem(
          "owner-b",
          otherOwner.id,
          "agent-tools",
        )
      ).status,
      "not-started",
    );

    assert.equal(
      await repository.getOwnedLearningSpace("owner-b", first.id),
      null,
    );
    await assert.rejects(
      repository.listLearningItems("owner-b", first.id),
      LearningSpaceNotFoundError,
    );
    await assert.rejects(
      repository.getLearningItem("owner-b", first.id, "agent-tools"),
      LearningItemNotFoundError,
    );
    await assert.rejects(
      repository.markLearningItemComplete(
        "owner-b",
        first.id,
        "agent-tools",
      ),
      LearningItemNotFoundError,
    );
    await assert.rejects(
      repository.getLearningItem("owner-a", first.id, "missing-item"),
      LearningItemNotFoundError,
    );
  });
});

test("applies monotonic, idempotent status transitions", async () => {
  await withRepository(async (repository) => {
    const space = await repository.createLearningSpace(
      "owner-a",
      "Status Space",
    );

    const firstStart = await repository.markLearningItemStarted(
      "owner-a",
      space.id,
      "agent-tools",
    );
    const repeatedStart = await repository.markLearningItemStarted(
      "owner-a",
      space.id,
      "agent-tools",
    );
    const completion = await repository.markLearningItemComplete(
      "owner-a",
      space.id,
      "agent-tools",
    );
    const startAfterCompletion = await repository.markLearningItemStarted(
      "owner-a",
      space.id,
      "agent-tools",
    );
    const repeatedCompletion = await repository.markLearningItemComplete(
      "owner-a",
      space.id,
      "agent-tools",
    );
    const completedSeedStart = await repository.markLearningItemStarted(
      "owner-a",
      space.id,
      "agent-controller-lifecycle",
    );

    assert.equal(firstStart.changed, true);
    assert.equal(firstStart.item.status, "in-progress");
    assert.equal(repeatedStart.changed, false);
    assert.equal(completion.changed, true);
    assert.equal(completion.item.status, "completed");
    assert.equal(startAfterCompletion.changed, false);
    assert.equal(startAfterCompletion.item.status, "completed");
    assert.equal(repeatedCompletion.changed, false);
    assert.equal(completedSeedStart.changed, false);
    assert.equal(completedSeedStart.item.status, "completed");
  });
});

test("serializes concurrent transitions to one effective change", async () => {
  await withRepository(async (repository) => {
    const space = await repository.createLearningSpace(
      "owner-a",
      "Concurrent Space",
    );
    const starts = await Promise.all([
      repository.markLearningItemStarted(
        "owner-a",
        space.id,
        "agent-tools",
      ),
      repository.markLearningItemStarted(
        "owner-a",
        space.id,
        "agent-tools",
      ),
    ]);
    const completions = await Promise.all([
      repository.markLearningItemComplete(
        "owner-a",
        space.id,
        "agent-tools",
      ),
      repository.markLearningItemComplete(
        "owner-a",
        space.id,
        "agent-tools",
      ),
    ]);

    assert.equal(starts.filter((result) => result.changed).length, 1);
    assert.equal(completions.filter((result) => result.changed).length, 1);
    assert.equal(
      (
        await repository.getLearningItem(
          "owner-a",
          space.id,
          "agent-tools",
        )
      ).status,
      "completed",
    );
  });
});
