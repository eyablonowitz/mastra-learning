import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  APPLICATION_SCHEMA_VERSION,
  closeApplicationDatabase,
  getApplicationDatabase,
} from "./database.ts";

async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "mastra-learning-app-db-"),
  );

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("initializes and reopens the versioned application schema", async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = path.join(directory, "app.db");
    const firstClient = await getApplicationDatabase(databasePath);
    const cachedClient = await getApplicationDatabase(databasePath);

    assert.equal(cachedClient, firstClient);

    const tables = await firstClient.execute(
      `SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'app_%'
        ORDER BY name`,
    );

    assert.deepEqual(
      tables.rows.map((row) => row.name),
      [
        "app_learning_items",
        "app_learning_spaces",
        "app_schema_migrations",
      ],
    );

    const migrations = await firstClient.execute(
      `SELECT version, name
        FROM app_schema_migrations
        ORDER BY version`,
    );

    assert.deepEqual(
      migrations.rows.map((row) => ({
        version: Number(row.version),
        name: row.name,
      })),
      [
        {
          version: APPLICATION_SCHEMA_VERSION,
          name: "create_learning_spaces_and_items",
        },
      ],
    );

    await firstClient.execute({
      sql: `INSERT INTO app_learning_spaces
        (id, owner_id, name, normalized_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        "persisted-space",
        "owner-a",
        "Persisted",
        "persisted",
        "2026-07-23T00:00:00.000Z",
        "2026-07-23T00:00:00.000Z",
      ],
    });

    await closeApplicationDatabase(databasePath);

    const reopenedClient = await getApplicationDatabase(databasePath);
    const reopenedSpaces = await reopenedClient.execute(
      "SELECT id FROM app_learning_spaces",
    );
    const reopenedMigrations = await reopenedClient.execute(
      "SELECT version FROM app_schema_migrations",
    );

    assert.deepEqual(
      reopenedSpaces.rows.map((row) => row.id),
      ["persisted-space"],
    );
    assert.equal(reopenedMigrations.rows.length, 1);

    await closeApplicationDatabase(databasePath);
  });
});

test("removes a failed initialization from the process cache", async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = path.join(directory, "retry.db");

    await mkdir(databasePath);
    await assert.rejects(getApplicationDatabase(databasePath));
    await rm(databasePath, { recursive: true });

    const client = await getApplicationDatabase(databasePath);
    const migration = await client.execute(
      "SELECT version FROM app_schema_migrations",
    );

    assert.equal(migration.rows.length, 1);

    await closeApplicationDatabase(databasePath);
  });
});
