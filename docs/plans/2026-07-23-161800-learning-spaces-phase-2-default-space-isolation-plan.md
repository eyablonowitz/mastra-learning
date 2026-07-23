# Learning spaces phase 2: default-space isolation

## Intended outcome

Cut the running application over from the shared JSON backlog and per-user
Mastra resource to one automatically provisioned, fully isolated learning space
per fake user.

The browser remains intentionally simple: each user sees only the seeded
**Mastra Fundamentals** space and can continue chatting, approving backlog
changes, and starting a new conversation. Internally, every backlog operation,
Mastra Session, thread, and chat command is scoped to that validated space.

This is the critical end-to-end architecture proof before exposing multiple
spaces in phase 3.

## Relationship and dependencies

This is phase 2 of
[Learning spaces, conversation navigation, and isolated SQL backlogs](./2026-07-22-191728-learning-spaces-isolated-backlogs-plan.md).

It depends on
[phase 1: application database foundation](./2026-07-23-161759-learning-spaces-phase-1-app-database-plan.md).
Phase 3 depends on the stable space-scoped runtime and HTTP contracts delivered
here.

## Scope

### Included

- Automatic creation of **Mastra Fundamentals** for an owner with no spaces
- Replacement of JSON backlog access with the phase-1 SQL repository
- Strict `LearningRequestContext`
- Trusted context construction in server routes
- Request-context validation on all backlog tools
- One shared `AgentController` and one cached `Session` per user and space
- Stable owner, resource, and session identifiers
- Space-scoped chat and thread-creation routes
- URL addressing through `/?space=<spaceId>`
- Redirect from missing or invalid selection to the owner's default space
- Existing chat, SSE, approval, and new-conversation behavior on the new routes
- Context, isolation, approval, restart, and smoke verification

### Not included

- A public create-space endpoint
- A space selector or new-space form
- More than one user-visible space
- Conversation-history listing or switching
- Space or thread rename/delete
- Migration of the legacy JSON backlog
- Migration of existing `fake-chat:<userId>` Mastra resources

## Architecture and implementation decisions

### Provision a default space at the authenticated application boundary

Add one repository/service operation that returns an owner's spaces and
atomically creates **Mastra Fundamentals** when none exist.

Concurrent first requests for the same owner must converge on one space through
the normalized-name uniqueness constraint. A losing request should reload the
winning row instead of failing the sign-in flow.

Provisioning occurs only after the fake user has been resolved from the
HTTP-only cookie. No route accepts an owner ID from the client.

### Treat validated space lookup as authorization

For every space-scoped route:

1. Resolve the fake user from the cookie.
2. Load the space using `(ownerId, spaceId)`.
3. Return `404` when it is missing or foreign.
4. Only then resolve the Mastra runtime.
5. Construct trusted request context from the resolved user and space.

Use:

```text
ownerId    = fake-user:<userId>
resourceId = learning-space:<userId>:<spaceId>
sessionId  = learning-session:<userId>:<spaceId>
```

Centralize these derivations so routes, runtime tests, and smoke scripts cannot
drift.

### Cache one Session per user and learning space

Keep one process-wide `AgentController`, but cache Session-creation promises by
a collision-safe `(userId, spaceId)` key. Remove rejected promises so runtime
creation can be retried.

The pinned Mastra version gives each created `Session` an independent event bus,
active-thread binding, run state, approvals, permissions, token state, and
display state. Request handlers must drive the returned Session directly:

- `session.sendMessage(...)`
- `session.respondToToolApproval(...)`
- `session.thread.create(...)`
- Session-scoped thread and message reads

Do not use controller-wide convenience state for a space-scoped request.

After creating or restoring a Session, preserve the existing policies:

```text
read → allow
edit → ask
```

### Make request context mandatory and server controlled

Define one strict Zod schema:

```ts
interface LearningRequestContext {
  userId: string;
  spaceId: string;
}
```

Add it as `requestContextSchema` on every backlog tool. Tool input schemas remain
unchanged: the model supplies only item IDs and filters, never user or space
identity.

Each tool reads identity from its execution context, derives the repository
owner ID centrally, and calls only the scoped repository methods. Missing or
invalid context must fail before the tool executes.

Construct a Mastra `RequestContext` after route authorization and pass it to
both:

- `session.sendMessage()` for the original run; and
- `session.respondToToolApproval()` when resuming an approved or declined tool
  call.

The approval route must reconstruct this context from the authenticated request
and validated space rather than trusting stored browser data.

### Cut over once and leave legacy data untouched

Remove the running application's dependency on
`src/mastra/learning-backlog-store.ts`. Keep
`data/learning-backlog.seed.json` as the template and stop reading or writing
`.data/learning-backlog.json`.

Do not import the legacy JSON contents. A user's first default space receives a
fresh seed. Existing `fake-chat:<userId>` resources and conversations remain in
`mastra.db` but are no longer selected by the application.

### Establish the final space-scoped route shape

Add:

```text
GET  /api/spaces

POST  /api/spaces/:spaceId/threads

GET   /api/spaces/:spaceId/chat
POST  /api/spaces/:spaceId/chat
PATCH /api/spaces/:spaceId/chat
```

`GET /api/spaces` returns the authenticated owner's spaces and provisions the
default when necessary. The thread collection supports creation only in this
phase; listing and switching arrive in phase 4.

Remove or stop using the unscoped `/api/chat` methods. Update the existing
client to receive the validated `spaceId`, connect its EventSource to the
space-scoped URL, send and approve on the same URL, and create conversations
through the thread collection.

### Make the default space URL-addressable

The authenticated page resolves `searchParams.space` on the server.

- Missing selection redirects to the owner's first/default space.
- An invalid or foreign selection redirects to the owner's first/default space.
- A valid selection renders the existing chat for that space.

This establishes the final URL and SSE-remount boundary without yet rendering a
space picker.

## Ordered implementation plan

1. Add centralized owner/resource/session identifier helpers and tests.
2. Add concurrency-safe default-space provisioning.
3. Define the strict learning request-context schema and construction helper.
4. Refactor backlog tools to use context plus scoped SQL repository operations.
5. Refactor runtime lookup and caching to accept a validated learning space.
6. Add `GET /api/spaces` and the space-scoped chat routes.
7. Move new-conversation creation to the space-scoped thread collection.
8. Update the authenticated page to resolve or redirect to `?space=<spaceId>`.
9. Update the existing chat client to use only space-scoped URLs.
10. Update all smoke scripts to provision isolated temporary spaces and pass
    valid request context.
11. Remove runtime imports of the legacy JSON store and run verification.

## Verification criteria

### Provisioning and URL selection

- A first authenticated request creates exactly one **Mastra Fundamentals**.
- Repeated and concurrent first requests return the same space.
- Missing `?space` redirects to the default space.
- A foreign or nonexistent `?space` does not reveal ownership and redirects to
  the authenticated owner's default.
- Refresh restores the URL-selected default space.

### Runtime isolation

- Two spaces for one synthetic owner derive different resources, session IDs,
  and Session instances while retaining the same owner.
- Two fake users never receive the same Session.
- A rejected Session initialization can be retried.
- Restarting the process recreates the Session against the same resource and
  most recent thread.
- Events, run state, approvals, permissions, and display state do not cross
  Session boundaries.

### Tools and request context

- Every backlog tool rejects missing or malformed context.
- Model-visible tool inputs contain no owner or space fields.
- Read tools return only the selected space's items.
- Approved writes affect only the selected space.
- Declined writes change no item.
- A stale approval ID still returns `409`.
- An approval routed through another space cannot release or execute the first
  space's pending tool call.

### Legacy boundary

- The application no longer reads or writes
  `.data/learning-backlog.json`.
- Existing legacy JSON contents remain untouched.
- Existing `fake-chat:<userId>` threads remain in Mastra storage but are not
  returned for the new resource.

### Browser and commands

- Chat streaming, tool activity, token usage, errors, approvals, and new
  conversation still work for the default space.
- An unauthenticated request to every new API returns `401`.
- Foreign space IDs return `404` from API routes.
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- all controller, tool, approval, and persistence smoke scripts
- `git diff --check`

## Phase exit

Phase 2 is complete when the existing single-space experience works entirely
through `app.db`, a trusted request context, a space-specific Mastra Session,
and space-scoped routes. No space-creation or conversation-picker UI should be
required to demonstrate that isolation.

Phase 2 completed: 2026-07-23 17:20:21 America/New_York

Implementation notes:

- Added centralized stable owner, resource, and Session identifiers plus
  concurrency-safe default provisioning of **Mastra Fundamentals**. Concurrent
  first requests converge on the normalized-name uniqueness constraint.
- Added strict server-side learning identity validation and one shared
  tool-facing request-context schema. The latter permits Mastra's framework
  metadata while extracting only the validated `userId` and `spaceId` trusted
  by repository operations.
- Replaced every backlog tool's legacy JSON access with owner-and-space-scoped
  SQL repository calls. Model-visible inputs still contain only backlog
  arguments.
- Kept one process-wide `AgentController` and introduced retryable Session
  promise caching by derived space resource. Read tools remain allowed and
  edit tools remain approval-gated.
- Replaced the unscoped chat route with authenticated space, chat, and thread
  routes. All space routes authorize ownership before resolving a Session,
  return `401` when unauthenticated, and return ownership-obscuring `404`
  responses for foreign IDs.
- Made `/?space=<spaceId>` authoritative. First sign-in and invalid selections
  redirect to the owner's default space, while the existing browser remains a
  deliberately single-space experience.
- Updated the chat client to use only scoped URLs and to adopt the thread ID
  returned by new-conversation creation immediately.
- Updated controller, persistence, tool, and approval smokes to provision SQL
  spaces and pass trusted request context. Approval coverage includes an
  attempted continuation through a second space's Session.
- Browser acceptance verified default provisioning and redirect, refresh,
  chat streaming, tool activity, token usage, approval and execution, distinct
  conversation creation, separate user spaces, and cross-space isolation.
- The running application has no import of the legacy JSON backlog store.
  `.data/learning-backlog.json` remained untouched.
- `npm test` (19 tests), `npm run typecheck`, `npm run lint`, `npm run build`,
  Bedrock/controller/tool/approval/persistence smokes, API authorization
  probes, and `git diff --check` passed.

## Explicitly deferred

- User-created additional spaces
- Space selector and creation UI
- Thread history, previews, and switching
- Rename and delete operations
- Legacy-data migration or deletion
- Real authentication
- Multi-process Session coordination or durable execution
