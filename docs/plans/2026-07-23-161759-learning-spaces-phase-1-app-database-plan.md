# Learning spaces phase 1: application database foundation

## Intended outcome

Introduce an application-owned LibSQL database and an ownership-scoped
repository for learning spaces and their seeded learning items.

This phase establishes the durable application data model without changing the
running chat, Mastra resources, backlog tools, or browser experience. The
existing `.data/learning-backlog.json` remains the active backlog until phase 2
wires the new repository through the full request path.

At the end of this phase:

- `.data/app.db` is initialized through versioned, repeatable migrations.
- A repository can create, list, and load learning spaces by owner.
- Creating a space atomically copies the validated tracked curriculum seed.
- Every learning-item read and mutation requires both `ownerId` and `spaceId`.
- Repository tests prove ownership isolation and status-transition behavior.

## Relationship to the umbrella plan

This is phase 1 of
[Learning spaces, conversation navigation, and isolated SQL backlogs](./2026-07-22-191728-learning-spaces-isolated-backlogs-plan.md).

It has no implementation dependency on the later phases. Phase 2 depends on the
database initialization and repository contracts established here.

## Scope

### Included

- Direct `@libsql/client` dependency
- Application database connection and initialization
- Versioned application migration runner
- Learning-space name normalization and validation
- Learning-space and learning-item tables
- Zod-validated curriculum seed loading
- Ownership-scoped repository operations
- Atomic seeded-space creation
- Conditional, idempotent item-status transitions
- Temporary-database repository and migration tests
- Test command updates needed to run the new tests

### Not included

- Automatic default-space creation during sign-in or page load
- Mastra `resourceId`, Session, or runtime-cache changes
- `RequestContext` changes
- Backlog-tool changes
- Space or space-scoped chat APIs
- Browser changes
- Reading from or writing to the repository in the running application
- Migration or deletion of the legacy JSON backlog

## Architecture and implementation decisions

### Keep application and Mastra persistence separate

Use two files under `.data`:

```text
.data/
  app.db       # application-owned spaces and learning items
  mastra.db    # Mastra-owned sessions, threads, messages, and memory
```

The application repository must use `@libsql/client` directly. It must not
reach into Mastra storage adapters or tables.

### Initialize migrations once per process

Create an application database module that:

1. Ensures `.data` exists.
2. Opens the LibSQL client for `.data/app.db`.
3. Creates a small migration ledger if it does not exist.
4. Applies unapplied migrations in order.
5. Records each completed migration.
6. Caches the initialization promise once per process.
7. Removes or replaces a rejected cached promise so a later call can retry.

Migrations must be idempotent and safe when initialization is called repeatedly
within one process. Tests should also reopen the same temporary database and
verify that a second initialization makes no destructive changes.

### Store explicit ownership and normalized names

Add `app_learning_spaces` with:

- UUID `id`
- `owner_id`
- display `name`
- `normalized_name`
- `created_at`
- `updated_at`
- a unique constraint on `(owner_id, normalized_name)`

Normalize names using the same NFKC, control-character rejection, whitespace
collapse, and case-insensitive identity rules as fake usernames. Space names
allow 1–60 visible characters. Extract or share normalization primitives where
that prevents the fake-user and space rules from drifting, while retaining
their different maximum lengths and error messages.

Equivalent names owned by one user must conflict. The same normalized name
owned by different users must be allowed.

### Preserve the tracked curriculum as the template

Continue to validate `data/learning-backlog.seed.json` with the existing
`learningBacklogSchema`. Do not duplicate the curriculum in a migration or
TypeScript constant.

Add `app_learning_items` with:

- `space_id`
- existing `item_id`, topic, description, difficulty, prerequisites, and status
- a composite primary key on `(space_id, item_id)`
- a foreign key to the learning space

Store prerequisites as JSON, parse them on reads, and validate repository
outputs through the existing learning-item schemas. Database constraints should
reject impossible enum values where practical; Zod remains the
application-facing validation boundary.

### Make seeded-space creation atomic

Validate the complete seed before opening the write transaction. Within one
transaction:

1. Insert the learning space.
2. Insert every validated seed item using the new space ID.
3. Commit only after all inserts succeed.

If name uniqueness, item insertion, or any other write fails, neither the space
nor a partial curriculum may remain.

### Require ownership on every item operation

Repository methods that access learning items must accept both `ownerId` and
`spaceId`. They must establish ownership in the same database operation or
transaction used for the item access; callers must not be able to perform an
unscoped item query after a separate authorization check.

The repository should expose contracts equivalent to:

```ts
listLearningSpaces(ownerId)
getOwnedLearningSpace(ownerId, spaceId)
createLearningSpace(ownerId, name)

listLearningItems(ownerId, spaceId, status?)
getLearningItem(ownerId, spaceId, itemId)
markLearningItemStarted(ownerId, spaceId, itemId)
markLearningItemComplete(ownerId, spaceId, itemId)
```

The exact module split may vary, but there must be no application-facing
unscoped overload.

Use conditional SQL updates for status changes:

- start changes only `not-started → in-progress`;
- complete changes any non-completed item to `completed`;
- completed items never regress;
- repeated calls return the current item with `changed: false`.

## Ordered implementation plan

1. Add `@libsql/client` and the application database path/configuration module.
2. Add the migration ledger and initial schema migration.
3. Add shared learning-space name normalization with focused unit tests.
4. Add tracked-seed loading and validation for repository use.
5. Add the learning-space repository and atomic seeded-space creation.
6. Add ownership-scoped learning-item reads and status transitions.
7. Add temporary-database tests for migrations, creation, isolation, and
   transitions.
8. Update `npm test` so the new suites run with the existing fake-auth tests.
9. Run the phase verification commands.

## Verification criteria

### Migration and initialization

- A new temporary path produces the complete application schema.
- Calling initialization repeatedly is safe.
- Closing and reopening the same database preserves data and migration history.
- A failed initialization does not permanently poison the process cache.
- Tests never read or mutate the developer's real `.data/app.db`.

### Names and creation

- Empty, control-character, invisible-formatting, and overlong names fail.
- NFKC, whitespace, and case-equivalent names normalize identically.
- Equivalent names conflict within one owner.
- Identical names are allowed for different owners.
- A created space contains every validated seed item.
- A forced item-insert failure leaves no partially created space.

### Ownership and isolation

- A user cannot load another user's space by ID.
- Every item read and mutation fails as not found for a foreign owner.
- Two spaces owned by one user have independent item state.
- Two users with identically named spaces have independent item state.
- Item IDs remain unique within a space rather than globally.

### Status transitions

- Starting a not-started item changes it once.
- Repeating start returns `changed: false`.
- Starting an in-progress or completed item does not regress it.
- Completing an item changes it once.
- Repeating completion returns `changed: false`.
- Concurrent or repeated transition attempts end in a valid monotonic state.

### Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`

## Phase exit

Phase 1 is complete when the repository contract and all temporary-database
tests pass while the existing browser and backlog behavior remain unchanged.
Phase 2 may then replace the legacy JSON store at one end-to-end cutover point.

Phase 1 completed: 2026-07-23 16:34:22 America/New_York

Implementation notes:

- Added a direct `@libsql/client` dependency and a process-cached application
  database initializer for `.data/app.db`. Rejected initialization promises are
  evicted so the same database path can be retried.
- Added a versioned migration ledger plus the learning-space and learning-item
  schema. Curriculum position is stored explicitly so repository reads preserve
  tracked seed order.
- Extracted the existing fake-user normalization behavior into a shared
  primitive and added the 60-character learning-space validation boundary.
- Added Zod-validated seed loading and a `LearningSpaceRepository` whose item
  operations always require owner and space identity.
- Seed copying runs in an interactive write transaction. A forced database
  trigger failure verified that neither a partial space nor partial curriculum
  remains.
- Status writes use one conditional `UPDATE … RETURNING` statement. This
  shortened the SQLite write lock and made concurrent start/complete calls
  converge on exactly one effective change without state regression.
- Added 10 application-database and repository tests alongside the existing
  three fake-auth tests. Every test uses a unique temporary database outside
  `.data`.
- Confirmed that the live app and backlog tools still import the legacy JSON
  store; the SQL repository remains dormant until phase 2.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and
  `git diff --check` passed.

## Explicitly deferred

- Wiring the repository into tools or routes
- Default-space provisioning
- Public space APIs
- Space selection and creation UI
- Thread listing or switching
- Rename and delete operations
- Legacy JSON or Mastra-resource migration
- Production database operations and multi-process migration coordination
