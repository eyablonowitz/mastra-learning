import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createClient,
  type Client,
  type InStatement,
} from "@libsql/client";

const DATA_DIRECTORY = path.join(process.cwd(), ".data");

export const applicationDataLocation = path.join(DATA_DIRECTORY, "app.db");
export const APPLICATION_SCHEMA_VERSION = 1;

interface ApplicationMigration {
  version: number;
  name: string;
  statements: InStatement[];
}

const APPLICATION_MIGRATIONS: ApplicationMigration[] = [
  {
    version: 1,
    name: "create_learning_spaces_and_items",
    statements: [
      `CREATE TABLE IF NOT EXISTS app_learning_spaces (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (owner_id, normalized_name)
      )`,
      `CREATE INDEX IF NOT EXISTS app_learning_spaces_owner_created
        ON app_learning_spaces (owner_id, created_at, id)`,
      `CREATE TABLE IF NOT EXISTS app_learning_items (
        space_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        topic TEXT NOT NULL,
        description TEXT NOT NULL,
        difficulty INTEGER NOT NULL CHECK (difficulty IN (1, 2, 3)),
        prerequisites_json TEXT NOT NULL CHECK (json_valid(prerequisites_json)),
        status TEXT NOT NULL
          CHECK (status IN ('not-started', 'in-progress', 'completed')),
        PRIMARY KEY (space_id, item_id),
        FOREIGN KEY (space_id) REFERENCES app_learning_spaces (id)
          ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS app_learning_items_space_status_position
        ON app_learning_items (space_id, status, position)`,
    ],
  },
];

const globalApplicationDatabases = globalThis as typeof globalThis & {
  mastraLearningApplicationDatabases?: Map<string, Promise<Client>>;
};

function cacheKey(databasePath: string): string {
  return path.resolve(databasePath);
}

export function resolveApplicationDataLocation(): string {
  const configuredPath = process.env.MASTRA_LEARNING_APP_DATABASE_PATH;

  return configuredPath
    ? path.resolve(configuredPath)
    : applicationDataLocation;
}

async function applyMigrations(client: Client): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );

  const appliedResult = await client.execute(
    "SELECT version FROM app_schema_migrations",
  );
  const appliedVersions = new Set(
    appliedResult.rows.map((row) => Number(row.version)),
  );

  for (const migration of APPLICATION_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;

    await client.batch(
      [
        ...migration.statements,
        {
          sql: `INSERT OR IGNORE INTO app_schema_migrations
            (version, name, applied_at)
            VALUES (?, ?, ?)`,
          args: [
            migration.version,
            migration.name,
            new Date().toISOString(),
          ],
        },
      ],
      "write",
    );
  }
}

async function openApplicationDatabase(databasePath: string): Promise<Client> {
  await mkdir(path.dirname(databasePath), { recursive: true });

  const client = createClient({
    url: `file:${databasePath}`,
    timeout: 5_000,
  });

  try {
    await client.execute("PRAGMA foreign_keys = ON");
    await applyMigrations(client);
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export function getApplicationDatabase(
  databasePath = resolveApplicationDataLocation(),
): Promise<Client> {
  const databases =
    (globalApplicationDatabases.mastraLearningApplicationDatabases ??=
      new Map());
  const key = cacheKey(databasePath);
  const cached = databases.get(key);

  if (cached) return cached;

  const databasePromise = openApplicationDatabase(key);
  databases.set(key, databasePromise);
  void databasePromise.catch(() => {
    if (databases.get(key) === databasePromise) {
      databases.delete(key);
    }
  });

  return databasePromise;
}

export async function closeApplicationDatabase(
  databasePath = resolveApplicationDataLocation(),
): Promise<void> {
  const databases =
    globalApplicationDatabases.mastraLearningApplicationDatabases;
  const key = cacheKey(databasePath);
  const databasePromise = databases?.get(key);

  databases?.delete(key);

  if (!databasePromise) return;

  try {
    const client = await databasePromise;
    client.close();
  } catch {
    // Failed initialization closes its client before rejecting.
  }
}
