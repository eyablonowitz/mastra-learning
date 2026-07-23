# Learning spaces phase 4: conversation navigation and hardening

## Intended outcome

Complete the learning-space experience with a conversation list inside each
selected Mastra resource.

Users can create conversations, see them ordered by recent activity, recognize
them by the first user-message preview, and switch the selected space's active
thread while idle. Thread ownership and busy-state checks are enforced on the
server as well as represented in the browser.

This phase also closes the umbrella plan with consolidated documentation,
smoke coverage, restart verification, and cross-user/cross-space/cross-thread
acceptance.

## Relationship and dependencies

This is phase 4 of
[Learning spaces, conversation navigation, and isolated SQL backlogs](./2026-07-22-191728-learning-spaces-isolated-backlogs-plan.md).

It depends on
[phase 3: multiple-space experience](./2026-07-23-161801-learning-spaces-phase-3-multiple-spaces-plan.md).
It is the final planned phase for the umbrella feature.

## Scope

### Included

- Space-scoped thread collection reads
- Space-scoped thread creation response
- Active-thread switching endpoint
- Thread ownership and resource-membership checks
- Server-side busy-state conflicts
- Thread summaries with first-message previews
- Conversation list and new-conversation action
- Most-recently-updated sorting
- Active-conversation presentation
- Summary refresh after relevant chat and thread events
- Complete persistence, isolation, approval, browser, and restart verification
- README, architecture, persistence, reset, and smoke documentation

### Not included

- Thread rename, deletion, cloning, or branching
- Space rename or deletion
- Historical reconstruction of tool-activity panels
- Concurrent active-thread changes while one Session is busy
- Shared-space conversations
- Migration of legacy resources or backlog data

## Architecture and implementation decisions

### Keep threads inside the validated space resource

Complete the route contract:

```text
GET  /api/spaces/:spaceId/threads
POST /api/spaces/:spaceId/threads
PUT  /api/spaces/:spaceId/threads/:threadId/active
```

Every method:

1. authenticates the fake user;
2. loads the learning space by `(ownerId, spaceId)`;
3. resolves that space's Session;
4. uses Session-scoped thread operations; and
5. returns `404` for missing, foreign, or cross-resource identifiers.

For switching, do not treat possession of a thread ID as authorization. Load or
list the candidate through the Session and verify that its persisted
`resourceId` matches the derived resource for the validated space before
calling `session.thread.switch({ threadId })`.

### Define a small public summary

Return:

```ts
interface ThreadSummary {
  id: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}
```

List only the selected Session's resource and continue excluding forked
subagent threads. Sort newest `updatedAt` first with a deterministic secondary
key.

Use the Session's batch first-user-message read where available so previews do
not create an N+1 message-query path. Derive a short, normalized plain-text
preview from the first user message. Use **New conversation** when no user
message exists.

Do not expose raw Mastra thread metadata or message objects through the
application API.

### Treat creation and switching as Session lifecycle commands

Drive the returned space-specific Session directly:

- create with `session.thread.create({ title: "New conversation" })`;
- switch with `session.thread.switch({ threadId })`.

Thread creation returns the new thread summary or enough identity for the
client to select it and refresh the list. Switching returns `204` after the
Session has rebound and loaded the new active thread.

Do not change the Session's resource ID to navigate conversations. A learning
space owns one resource and many threads; switching changes only the active
thread inside that Session.

### Enforce the idle-only navigation rule on the server

Before create or switch, return `409` when:

- `session.run.isRunning()` is true;
- a tool approval is armed or visible as pending; or
- another Session state indicates the active thread cannot be safely rebound.

The UI also disables space and thread controls while busy, but server checks
remain authoritative for stale tabs and direct requests.

A run or approval in another learning space must not block this Session because
the busy state is per Session.

### Refresh summaries at explicit lifecycle points

Fetch thread summaries:

- when the selected space mounts;
- after creating a conversation;
- after switching conversations;
- after a completed or failed message changes thread activity; and
- after reconnect when the active thread may have changed.

Avoid refetching on every token or display-state snapshot. Prefer a small
completion signal derived from changes in running state or the existing
thread-created/thread-changed events.

Keep the EventSource mounted when switching threads inside the same space. The
Session emits the thread change and the chat projection replaces the transcript
for the new active thread. Changing spaces still remounts the EventSource as
defined in phase 3.

### Finish the shell without weakening chat behavior

Add a conversation section to the learning shell containing:

- selected-space controls;
- **New conversation**;
- the sorted conversation list;
- clear active-thread styling; and
- disabled/busy states.

The transcript, tool activity, approval card, composer, connection indicator,
token usage, and errors must continue to represent only the active thread and
Session.

Use accessible buttons and labels. Preserve keyboard chat submission and avoid
moving focus unexpectedly when background summary refreshes complete.

## Ordered implementation plan

1. Add or finalize the `ThreadSummary` schema and serialization helpers.
2. Add the thread-list endpoint using resource-scoped Session reads and batched
   first-message previews.
3. Update thread creation to return the new active thread identity/summary.
4. Add the active-thread endpoint with ownership, membership, and busy checks.
5. Add API tests for foreign spaces, cross-resource threads, sorting, previews,
   and `409` conflicts.
6. Add conversation-list loading and active-thread state to the learning shell.
7. Add new-conversation and thread-switch commands with stale-response guards.
8. Refresh summaries only at the defined lifecycle points.
9. Add busy and active presentation without regressing chat or approval UI.
10. Update smoke scripts for explicit spaces and multiple threads.
11. Update README architecture, persistence boundaries, reset instructions, and
    the resource/thread mental model.
12. Run the complete umbrella acceptance matrix.

## Verification criteria

### API authorization and membership

- All thread routes return `401` without authentication.
- A foreign or nonexistent space returns `404`.
- A thread from another user or space returns `404`, even when its ID is known.
- Listing returns only the selected resource's non-forked threads.
- Create and switch return `409` while the selected Session is running or
  awaiting approval.
- A busy Session in another space does not block the selected Session.

### Summaries

- Threads are sorted by most recent update.
- Each nonempty conversation uses its first user-message preview.
- Empty conversations use **New conversation**.
- Long or multiline messages produce a bounded, normalized preview.
- Exactly one returned summary is active when a thread is bound.
- Batch preview loading avoids one storage query per thread.

### Navigation

- Creating a conversation makes it active and keeps it in the selected space.
- Switching replaces the transcript with the selected thread's messages.
- Switching does not change the Session resource ID.
- Returning to a prior thread restores its persisted transcript.
- Refresh restores the selected space and that Session's active/latest thread.
- Summary order updates after a completed message.
- Repeated clicks and stale responses cannot activate the wrong thread.

### Runs and approvals

- Space and thread controls lock during generation.
- Space and thread controls remain locked while approval is pending.
- Direct create or switch requests receive `409` while busy.
- Approving or declining resumes only the selected Session.
- After the run settles, navigation unlocks and summaries refresh.
- A pending approval in one space never appears in another space or thread.

### Persistence and isolation

- Cross-user, cross-space, and cross-thread messages remain isolated.
- Backlog changes remain scoped to the selected space regardless of thread.
- Restarting the process restores each space against the same resource and
  persisted thread collection.
- Existing legacy JSON and `fake-chat:<userId>` data remain untouched.
- Two tabs using different spaces can create, switch, and chat independently.

### Complete release gate

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `AWS_PROFILE=dev AWS_REGION=us-east-1 npm run bedrock:smoke`
- `AWS_PROFILE=dev AWS_REGION=us-east-1 npm run controller:smoke`
- `AWS_PROFILE=dev AWS_REGION=us-east-1 npm run agent-tools:smoke`
- `AWS_PROFILE=dev AWS_REGION=us-east-1 npm run agent-approval:smoke`
- `npm run persistence:smoke`
- focused browser acceptance for sign-in, spaces, conversations, approval,
  refresh, tabs, and restart
- `git diff --check`

## Documentation completion

Update the README and architecture material to explain:

- fake user → learning spaces → Mastra resource → conversation threads;
- one application database and one Mastra database;
- trusted request context and ownership validation;
- default-space provisioning and URL selection;
- Session-local run, approval, display, and active-thread state;
- tracked curriculum seed versus per-space mutable copies;
- backlog-only, application-data, Mastra-data, and full local reset choices;
- intentional non-migration of legacy backlog and chat data; and
- the remaining local, single-process limitations.

## Phase exit

Phase 4 and the umbrella feature are complete when all four phases' exit
criteria and the complete release gate pass, and another user can navigate the
resource hierarchy from the browser without observing cross-user, cross-space,
or cross-thread state leakage.

Phase 4 completed: 2026-07-23 18:28:36 America/New_York

Implementation notes:

- Added public `ThreadSummary` serialization with bounded, whitespace-normalized
  first-user-message previews, **New conversation** fallback, newest-activity
  sorting, deterministic ties, and exact active state.
- Thread listing uses the Session's resource-scoped collection and one batched
  `firstUserMessages()` read. A defensive resource filter prevents accidental
  leakage even if the Session implementation changes.
- Mastra 1.50.1 persists AgentController user input with the raw storage role
  `signal`, while its batch helper currently filters raw rows for `user`.
  Added a small app-owned first-preview value in thread metadata as a fallback;
  it is populated once from the active thread and avoids application queries
  against Mastra's private SQL schema or one message query per listed thread.
- Completed `GET` and `POST /api/spaces/:spaceId/threads` and added
  `PUT /api/spaces/:spaceId/threads/:threadId/active`. The switch route verifies
  candidate membership before reporting Session busy state, so known foreign
  IDs remain indistinguishable from missing IDs.
- Centralized server-authoritative navigation conflicts across run, active
  stream, approval, suspension, and display-state signals. Create and switch
  return `409` when the selected Session cannot be rebound safely.
- Updated the SSE projection to clear and then hydrate the selected thread's
  persisted transcript on thread lifecycle events. A generation and thread-ID
  guard prevents a slow read from replacing a newer selection; switching a
  conversation keeps the same EventSource.
- Added the conversation sidebar, active styling, accessible create/switch
  controls, loading and failure states, request-sequence guards, and refreshes
  only on connect/reconnect, thread lifecycle, creation, switching, run
  completion, or failure.
- Updated controller and persistence smokes to create multiple threads, return
  to the original resource/thread, run there, and restore the latest transcript
  and complete resource-scoped collection from a fresh process.
- Replaced the outdated README architecture with the implemented
  fake-user → space → resource/Session → thread hierarchy, authenticated route
  surface, trusted request context, two-database persistence matrix, seed
  behavior, reset choices, legacy-data policy, and local limitations.
- Added seven focused navigation/summary tests; the full suite now passes 30
  tests. Typecheck, lint, production build, direct Bedrock, controller,
  read-tool, approval/idempotency, fresh-process persistence, and
  `git diff --check` all pass.
- Live HTTP acceptance confirmed list/create/switch success, active summaries,
  `401` without authentication, `404` for foreign spaces, and `404` for missing
  or cross-resource thread IDs.
- Browser acceptance verified creation, active styling, persisted preview
  backfill, transcript replacement and restoration, refresh, separate space
  tabs, space-local conversation counts, fresh-user isolation, and desktop
  layout. The post-process-restart browser reload was rejected by the browser
  tool's URL policy; the same restart boundary was verified independently by
  the fresh-process multi-thread persistence smoke.
- The legacy `.data/learning-backlog.json` remained byte-for-byte and
  timestamp unchanged (`474cdb7c…d35f`, 2026-07-23 14:22:45 EDT).
- Follow-up Chrome testing found an event-ordering race in the client:
  a hydrated `thread_changed` SSE snapshot could arrive before the switch
  request resolved, after which the request success handler replaced it with
  an empty initial state. The handler now preserves state already hydrated for
  the target thread. The original failure reproduced before the fix; three
  repeated Chrome switch cycles passed afterward without reloads or console
  errors.

## Explicitly deferred

- Real authentication and username-impersonation protection
- Shared spaces, memberships, invitations, and collaborative threads
- Space and thread rename/delete
- Thread cloning and branching UI
- Custom curriculum editing or template selection
- Legacy data migration or deletion
- Concurrent active-thread navigation within a busy Session
- Production database operations, multi-process coordination, and durable
  execution
