import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Client } from "@libsql/client";
import {
  closeApplicationDatabase,
  getApplicationDatabase,
} from "../app-data/database.ts";
import { loadLearningBacklogSeed } from "../app-data/learning-seed.ts";
import { LearningSpaceRepository } from "../app-data/learning-spaces.ts";
import { getLearningOwnerId } from "./learning-identity.ts";
import {
  createLearningSpaceForUser,
  createLearningSpaceRequestSchema,
} from "./learning-space-creation.ts";

async function withRepository(
  run: (repository: LearningSpaceRepository, client: Client) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "mastra-learning-space-api-"),
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

test("accepts only a client-supplied learning-space name", () => {
  assert.equal(
    createLearningSpaceRequestSchema.safeParse({ name: "Mastra Deep Dive" })
      .success,
    true,
  );
  assert.equal(
    createLearningSpaceRequestSchema.safeParse({
      name: "Mastra Deep Dive",
      ownerId: "model-chosen-owner",
    }).success,
    false,
  );
  assert.equal(
    createLearningSpaceRequestSchema.safeParse({
      name: "Mastra Deep Dive",
      items: [],
    }).success,
    false,
  );
});

test("creates a complete seeded space for the authenticated user", async () => {
  await withRepository(async (repository) => {
    const user = { id: "user-a" };
    const result = await createLearningSpaceForUser(
      user,
      { name: "  Mastra   Deep Dive " },
      repository,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.space.name, "Mastra Deep Dive");
    assert.deepEqual(
      Object.keys(result.space).sort(),
      ["createdAt", "id", "name", "updatedAt"],
    );
    assert.deepEqual(
      await repository.listLearningSpaces(getLearningOwnerId(user.id)),
      [result.space],
    );

    const items = await repository.listLearningItems(
      getLearningOwnerId(user.id),
      result.space.id,
    );
    const seed = await loadLearningBacklogSeed();

    assert.deepEqual(
      items.map((item) => ({ id: item.id, status: item.status })),
      seed.items.map((item) => ({ id: item.id, status: item.status })),
    );
  });
});

test("rejects invalid requests without leaving partial rows", async () => {
  await withRepository(async (repository) => {
    const user = { id: "user-a" };

    for (const payload of [
      null,
      {},
      { name: "" },
      { name: "Invisible\u200bName" },
      { name: "x".repeat(61) },
      { name: "Valid", userId: "another-user" },
    ]) {
      const result = await createLearningSpaceForUser(
        user,
        payload,
        repository,
      );

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 400);
    }

    assert.deepEqual(
      await repository.listLearningSpaces(getLearningOwnerId(user.id)),
      [],
    );
  });
});

test("maps same-owner conflicts while allowing equivalent names for another owner", async () => {
  await withRepository(async (repository) => {
    const first = await createLearningSpaceForUser(
      { id: "user-a" },
      { name: "Mastra Deep Dive" },
      repository,
    );
    const conflict = await createLearningSpaceForUser(
      { id: "user-a" },
      { name: "  ＭＡＳＴＲＡ  deep dive " },
      repository,
    );
    const otherOwner = await createLearningSpaceForUser(
      { id: "user-b" },
      { name: "mastra deep dive" },
      repository,
    );

    assert.equal(first.ok, true);
    assert.deepEqual(conflict, {
      ok: false,
      status: 409,
      error: 'A learning space named "MASTRA deep dive" already exists.',
    });
    assert.equal(otherOwner.ok, true);
  });
});
