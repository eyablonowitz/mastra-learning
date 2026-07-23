import { randomUUID } from "node:crypto";
import type { Client, Row, Transaction } from "@libsql/client";
import { z } from "zod";
import {
  learningItemSchema,
  learningItemStatusSchema,
  type LearningItem,
  type LearningItemStatus,
  type LearningItemSummary,
} from "../mastra/learning-backlog-schema.ts";
import { loadLearningBacklogSeed } from "./learning-seed.ts";
import { normalizeLearningSpaceName } from "./learning-space-name.ts";
import {
  getApplicationDatabase,
  resolveApplicationDataLocation,
} from "./database.ts";
import { DEFAULT_LEARNING_SPACE_NAME } from "../lib/learning-identity.ts";

const ownerIdSchema = z.string().trim().min(1);
const learningSpaceRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});
const learningItemRowSchema = z.object({
  item_id: z.string().min(1),
  topic: z.string().min(1),
  description: z.string().min(1),
  difficulty: z.number().int(),
  prerequisites_json: z.string(),
  status: z.string(),
});

export interface LearningSpace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export class LearningSpaceNameConflictError extends Error {
  constructor(name: string) {
    super(`A learning space named "${name}" already exists.`);
    this.name = "LearningSpaceNameConflictError";
  }
}

export class LearningSpaceNotFoundError extends Error {
  constructor() {
    super("The learning space was not found.");
    this.name = "LearningSpaceNotFoundError";
  }
}

export class LearningItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`No learning item exists with id "${itemId}".`);
    this.name = "LearningItemNotFoundError";
  }
}

function toLearningSpace(row: Row): LearningSpace {
  const value = learningSpaceRowSchema.parse(row);

  return {
    id: value.id,
    name: value.name,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function toLearningItem(row: Row): LearningItem {
  const value = learningItemRowSchema.parse(row);
  let prerequisites: unknown;

  try {
    prerequisites = JSON.parse(value.prerequisites_json);
  } catch (error) {
    throw new Error(
      `Learning item "${value.item_id}" has invalid prerequisite data.`,
      { cause: error },
    );
  }

  return learningItemSchema.parse({
    id: value.item_id,
    topic: value.topic,
    description: value.description,
    difficulty: value.difficulty,
    prerequisites,
    status: value.status,
  });
}

function toLearningItemSummary(item: LearningItem): LearningItemSummary {
  return {
    id: item.id,
    topic: item.topic,
    difficulty: item.difficulty,
    prerequisites: item.prerequisites,
    status: item.status,
  };
}

function isSpaceNameConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  const message =
    error instanceof Error
      ? error.message
      : "message" in error && typeof error.message === "string"
        ? error.message
        : "";

  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    message.includes(
      "UNIQUE constraint failed: app_learning_spaces.owner_id, app_learning_spaces.normalized_name",
    )
  );
}

async function rollbackQuietly(transaction: Transaction): Promise<void> {
  try {
    await transaction.rollback();
  } catch {
    // Preserve the original repository error.
  }
}

export class LearningSpaceRepository {
  private readonly client: Client;
  private readonly defaultSpacePromises = new Map<
    string,
    Promise<LearningSpace[]>
  >();

  constructor(client: Client) {
    this.client = client;
  }

  async listLearningSpaces(ownerId: string): Promise<LearningSpace[]> {
    const owner = ownerIdSchema.parse(ownerId);
    const result = await this.client.execute({
      sql: `SELECT id, name, created_at, updated_at
        FROM app_learning_spaces
        WHERE owner_id = ?
        ORDER BY created_at ASC, id ASC`,
      args: [owner],
    });

    return result.rows.map(toLearningSpace);
  }

  async getOwnedLearningSpace(
    ownerId: string,
    spaceId: string,
  ): Promise<LearningSpace | null> {
    const owner = ownerIdSchema.parse(ownerId);
    const result = await this.client.execute({
      sql: `SELECT id, name, created_at, updated_at
        FROM app_learning_spaces
        WHERE owner_id = ? AND id = ?
        LIMIT 1`,
      args: [owner, spaceId],
    });
    const row = result.rows[0];

    return row ? toLearningSpace(row) : null;
  }

  async createLearningSpace(
    ownerId: string,
    requestedName: string,
  ): Promise<LearningSpace> {
    const owner = ownerIdSchema.parse(ownerId);
    const { name, normalizedName } =
      normalizeLearningSpaceName(requestedName);
    const seed = await loadLearningBacklogSeed();
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const transaction = await this.client.transaction("write");

    try {
      await transaction.execute({
        sql: `INSERT INTO app_learning_spaces
          (id, owner_id, name, normalized_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, owner, name, normalizedName, timestamp, timestamp],
      });

      for (const [position, item] of seed.items.entries()) {
        await transaction.execute({
          sql: `INSERT INTO app_learning_items
            (
              space_id,
              item_id,
              position,
              topic,
              description,
              difficulty,
              prerequisites_json,
              status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            id,
            item.id,
            position,
            item.topic,
            item.description,
            item.difficulty,
            JSON.stringify(item.prerequisites),
            item.status,
          ],
        });
      }

      await transaction.commit();

      return {
        id,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    } catch (error) {
      await rollbackQuietly(transaction);

      if (isSpaceNameConflict(error)) {
        throw new LearningSpaceNameConflictError(name);
      }

      throw error;
    } finally {
      transaction.close();
    }
  }

  async listOrCreateDefaultLearningSpaces(
    ownerId: string,
  ): Promise<LearningSpace[]> {
    const owner = ownerIdSchema.parse(ownerId);
    const cached = this.defaultSpacePromises.get(owner);

    if (cached) return cached;

    const provisioningPromise = this.provisionDefaultLearningSpace(owner);
    this.defaultSpacePromises.set(owner, provisioningPromise);

    try {
      return await provisioningPromise;
    } finally {
      if (this.defaultSpacePromises.get(owner) === provisioningPromise) {
        this.defaultSpacePromises.delete(owner);
      }
    }
  }

  async listLearningItems(
    ownerId: string,
    spaceId: string,
    status?: LearningItemStatus,
  ): Promise<LearningItemSummary[]> {
    const owner = ownerIdSchema.parse(ownerId);
    const validatedStatus = learningItemStatusSchema.optional().parse(status);
    const result = await this.client.execute({
      sql: `SELECT
          spaces.id AS owned_space_id,
          items.item_id,
          items.topic,
          items.description,
          items.difficulty,
          items.prerequisites_json,
          items.status
        FROM app_learning_spaces AS spaces
        LEFT JOIN app_learning_items AS items
          ON items.space_id = spaces.id
          AND (? IS NULL OR items.status = ?)
        WHERE spaces.owner_id = ? AND spaces.id = ?
        ORDER BY items.position ASC, items.item_id ASC`,
      args: [
        validatedStatus ?? null,
        validatedStatus ?? null,
        owner,
        spaceId,
      ],
    });

    if (result.rows.length === 0) {
      throw new LearningSpaceNotFoundError();
    }

    return result.rows.flatMap((row) =>
      row.item_id === null ? [] : [toLearningItemSummary(toLearningItem(row))],
    );
  }

  async getLearningItem(
    ownerId: string,
    spaceId: string,
    itemId: string,
  ): Promise<LearningItem> {
    const owner = ownerIdSchema.parse(ownerId);
    const result = await this.client.execute({
      sql: `SELECT
          items.item_id,
          items.topic,
          items.description,
          items.difficulty,
          items.prerequisites_json,
          items.status
        FROM app_learning_items AS items
        INNER JOIN app_learning_spaces AS spaces
          ON spaces.id = items.space_id
        WHERE
          spaces.owner_id = ?
          AND spaces.id = ?
          AND items.item_id = ?
        LIMIT 1`,
      args: [owner, spaceId, itemId],
    });
    const row = result.rows[0];

    if (!row) {
      throw new LearningItemNotFoundError(itemId);
    }

    return toLearningItem(row);
  }

  async markLearningItemStarted(
    ownerId: string,
    spaceId: string,
    itemId: string,
  ): Promise<{ item: LearningItem; changed: boolean }> {
    return this.transitionLearningItem({
      ownerId,
      spaceId,
      itemId,
      status: "in-progress",
      currentStatusPredicate: "status = 'not-started'",
    });
  }

  async markLearningItemComplete(
    ownerId: string,
    spaceId: string,
    itemId: string,
  ): Promise<{ item: LearningItem; changed: boolean }> {
    return this.transitionLearningItem({
      ownerId,
      spaceId,
      itemId,
      status: "completed",
      currentStatusPredicate: "status <> 'completed'",
    });
  }

  private async transitionLearningItem({
    ownerId,
    spaceId,
    itemId,
    status,
    currentStatusPredicate,
  }: {
    ownerId: string;
    spaceId: string;
    itemId: string;
    status: LearningItemStatus;
    currentStatusPredicate:
      | "status = 'not-started'"
      | "status <> 'completed'";
  }): Promise<{ item: LearningItem; changed: boolean }> {
    const owner = ownerIdSchema.parse(ownerId);
    const update = await this.client.execute({
      sql: `UPDATE app_learning_items
        SET status = ?
        WHERE
          space_id = ?
          AND item_id = ?
          AND ${currentStatusPredicate}
          AND EXISTS (
            SELECT 1
            FROM app_learning_spaces AS spaces
            WHERE spaces.id = app_learning_items.space_id
              AND spaces.owner_id = ?
          )
        RETURNING
          item_id,
          topic,
          description,
          difficulty,
          prerequisites_json,
          status`,
      args: [status, spaceId, itemId, owner],
    });
    const updatedRow = update.rows[0];

    if (updatedRow) {
      return {
        item: toLearningItem(updatedRow),
        changed: true,
      };
    }

    return {
      item: await this.getLearningItem(owner, spaceId, itemId),
      changed: false,
    };
  }

  private async provisionDefaultLearningSpace(
    ownerId: string,
  ): Promise<LearningSpace[]> {
    const existing = await this.listLearningSpaces(ownerId);

    if (existing.length > 0) {
      return existing;
    }

    try {
      const created = await this.createLearningSpace(
        ownerId,
        DEFAULT_LEARNING_SPACE_NAME,
      );

      return [created];
    } catch (error) {
      if (
        !(error instanceof LearningSpaceNameConflictError) &&
        !isDatabaseBusy(error)
      ) {
        throw error;
      }

      const spaces = await this.listLearningSpaces(ownerId);

      if (spaces.length === 0) {
        throw error;
      }

      return spaces;
    }
  }
}

function isDatabaseBusy(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "SQLITE_BUSY"
  );
}

const globalLearningSpaceRepositories = globalThis as typeof globalThis & {
  mastraLearningSpaceRepositories?: Map<
    string,
    Promise<LearningSpaceRepository>
  >;
};

export function getLearningSpaceRepository(
  databasePath = resolveApplicationDataLocation(),
): Promise<LearningSpaceRepository> {
  const repositories =
    (globalLearningSpaceRepositories.mastraLearningSpaceRepositories ??=
      new Map());
  const cached = repositories.get(databasePath);

  if (cached) return cached;

  const repositoryPromise = getApplicationDatabase(databasePath).then(
    (client) => new LearningSpaceRepository(client),
  );
  repositories.set(databasePath, repositoryPromise);
  void repositoryPromise.catch(() => {
    if (repositories.get(databasePath) === repositoryPromise) {
      repositories.delete(databasePath);
    }
  });

  return repositoryPromise;
}
