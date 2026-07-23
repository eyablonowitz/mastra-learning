# Learning spaces phase 3: multiple-space experience

## Intended outcome

Let an authenticated fake user create and switch among multiple private
learning spaces while preserving the end-to-end isolation established in phase
2.

Each space begins with an independent curriculum and empty Mastra conversation
history. The selected space is represented by `/?space=<spaceId>`, so refreshes
and separate browser tabs retain their own resource selection.

Conversation-history listing and switching remain deferred to phase 4. In this
phase, each space resumes its most recent conversation and supports creating a
new one.

## Relationship and dependencies

This is phase 3 of
[Learning spaces, conversation navigation, and isolated SQL backlogs](./2026-07-22-191728-learning-spaces-isolated-backlogs-plan.md).

It depends on
[phase 2: default-space isolation](./2026-07-23-161800-learning-spaces-phase-2-default-space-isolation-plan.md).
Phase 4 builds conversation navigation inside the selected space.

## Scope

### Included

- Authenticated `POST /api/spaces`
- Space listing and creation error contracts
- URL-driven space selection
- Space selector and inline new-space form
- Client navigation between spaces
- Space-specific SSE teardown and reconnection
- Busy-state locks for space navigation and creation
- Independent behavior in separate tabs
- Cross-user and cross-space browser acceptance
- Phase-specific documentation and automated tests

### Not included

- Conversation list, previews, sorting, or switching
- Space rename or deletion
- Space ordering controls
- Curriculum-template selection
- Shared spaces, memberships, or invitations
- Cross-tab coordination beyond each tab observing its selected Session

## Architecture and implementation decisions

### Keep the URL as the selected-resource authority

The `space` query parameter is the durable browser representation of the
selected learning space. Do not store an additional global "current space" in a
cookie, local storage, or application database.

The authenticated server page continues to:

1. load the owner's spaces;
2. resolve the query parameter through ownership-scoped lookup;
3. redirect a missing or invalid selection to the first/default space; and
4. render the selected space ID and display name into the client shell.

Client selection uses router navigation to `/?space=<id>`. This lets two tabs
choose different spaces without overwriting shared browser state.

### Add only the create mutation needed for v1

Add:

```text
POST /api/spaces
Content-Type: application/json

{ "name": "Mastra Deep Dive" }
```

The route:

1. authenticates the cookie-derived fake user;
2. validates and normalizes the name server-side;
3. calls atomic seeded-space creation for that owner;
4. returns the created public `LearningSpace`; and
5. maps a same-owner normalized-name conflict to a stable client error.

The request never accepts `ownerId`, `userId`, curriculum contents, or initial
item status. Missing authentication returns `401`; invalid input returns `400`;
same-owner name conflict returns `409`.

Keep `GET /api/spaces` as the owner-scoped collection read established in phase
2.

### Remount live chat state at the space boundary

The selected space determines:

- chat EventSource URL;
- send and approval URLs;
- new-conversation URL;
- Session and active thread;
- transcript, tool activity, pending approval, and token state.

Key the chat connection and local transient submission state by `spaceId`.
When the selected space changes:

1. close the previous EventSource;
2. clear request and approval submission state that belongs to it;
3. render a connecting state for the new space; and
4. open only the new space's EventSource.

Late events or failed requests from the previous selection must not overwrite
the new space's display.

### Lock navigation while the selected Session is busy

Disable space selection, space creation, new conversation, and user switching
in the current tab while the selected Session:

- is running; or
- has a pending approval.

The lock is a UI safety boundary, not a cross-tab mutex. Another tab selecting a
different space may continue because it resolves a different Session. A second
tab on the same space observes the shared Session state through its own SSE
connection and remains subject to the existing server run guards.

Creating a new space could technically be independent of the current Session,
but keep it disabled during a run or approval so the current tab cannot navigate
away from live or decision-required state.

### Introduce the shell seam needed by phase 4

Refactor the current monolithic client only as far as necessary to give the
space controls and chat transcript clear ownership. A suitable shape is:

```text
Learning shell
  space controls
  conversation region
    chat status
    transcript and tool activity
    composer
```

Do not build an empty abstraction layer for future thread features, but avoid
embedding space fetch/navigation logic throughout transcript rendering. Phase 4
should be able to add a conversation section beside or below the space controls
without rewriting the chat protocol again.

## Ordered implementation plan

1. Add the authenticated `POST /api/spaces` route and stable error mapping.
2. Add API tests for authentication, validation, ownership, seed copying, and
   normalized-name conflicts.
3. Load or fetch the owner's public space list for the authenticated shell.
4. Add the space selector and inline new-space form.
5. Navigate to the created space immediately after a successful response.
6. Key EventSource, send, approval, and new-conversation behavior by `spaceId`.
7. Clear or ignore stale client state when space selection changes.
8. Add busy-state navigation and creation locks.
9. Refactor component boundaries only where required to keep space and chat
   concerns understandable.
10. Update documentation and complete cross-space and multi-tab acceptance.

## Verification criteria

### API and ownership

- Unauthenticated list and create requests return `401`.
- A valid name creates a space owned by the cookie-derived user.
- The created space contains a complete independent seed.
- Invalid names return `400` with no partial rows.
- Equivalent names for one owner return `409`.
- Equivalent names for different owners both succeed.
- Responses never expose normalized names or owner identifiers.

### Selection and isolation

- Selecting a space changes the URL and active Session/resource.
- Refresh restores the URL-selected space.
- Missing, foreign, and nonexistent selections redirect to the owner's first
  space without revealing foreign ownership.
- A second space starts with the seeded backlog and no inherited thread
  messages.
- Updating one space's item status does not alter another space.
- Switching back restores that space's most recent conversation and backlog.

### SSE and live state

- The previous EventSource closes when the space changes.
- Only the selected space's snapshots render after navigation.
- Tool activity, pending approval, token usage, errors, and transcript do not
  flash from the prior space.
- Navigation and creation controls disable during runs and approvals.
- Controls become available again after completion, decline, approval, or
  error.

### Tabs and regressions

- Two tabs can select different spaces and chat independently.
- A run or approval in space A does not lock a tab using space B.
- Two tabs on the same space observe the same live Session state.
- New conversation still affects only the selected space.
- User switching remains disabled when the selected Session is busy.
- Existing sign-in, chat, tool, approval, and restart behavior still works.

### Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- relevant controller, tool, approval, and persistence smoke scripts
- `git diff --check`

## Phase exit

Phase 3 is complete when users can create, select, refresh, and use multiple
isolated spaces, including in separate tabs, without a conversation-history
picker. The selected space must remain the single input to every live chat
operation.

Phase 3 completed: 2026-07-23 17:53:07 America/New_York

Implementation notes:

- Added authenticated `POST /api/spaces` with a strict `{ name }` request
  contract. The route derives ownership from the fake-user cookie, atomically
  copies the tracked seed, returns only the public space fields, and maps name
  validation to `400` and normalized same-owner conflicts to `409`.
- Kept conflict mapping stable across Next.js development module duplication by
  recognizing the repository's named domain errors as well as same-instance
  errors.
- Added four focused creation-contract tests covering accepted fields,
  authenticated ownership, complete seed copying, invalid-input rollback,
  same-owner normalized conflicts, and equivalent names for different owners.
- Refactored the client into a learning shell with a space sidebar and a
  separate conversation region. The server-provided owned space collection
  drives a native selector and an inline **New space** form.
- Space selection and successful creation navigate directly to
  `/?space=<spaceId>`. Refresh and foreign-selection fallback continue to be
  resolved by the authenticated server page, without a second persisted
  "current space" value.
- Keyed the conversation shell by space and explicitly closes its EventSource
  before navigation. The client clears transcript and transient request state
  immediately and ignores queued events from the prior connection.
- Added immediate request locks for message submission and thread creation in
  addition to Mastra Session run and pending-approval state. Space selection,
  space creation, new conversation, and user switching remain disabled until
  the selected Session is safe to leave.
- Browser acceptance verified creation and `409` feedback, URL selection,
  refresh, an empty second-space conversation, independent SQL item status,
  conversation restoration, approval locking and re-enabling, selected-space
  thread creation, foreign selection fallback, two independent space tabs, and
  two same-space tabs observing the same live Session state.
- SQL acceptance confirmed five seeded items in every created space and
  `agent-tools` progressing only in the selected **Mastra Deep Dive** space.
- HTTP probes confirmed unauthenticated list/create return `401`, valid create
  returns `201`, untrusted fields and invalid names return `400`, duplicate
  normalized names return `409`, and response bodies expose no owner or
  normalized-name fields.
- `npm test` (23 tests), `npm run typecheck`, `npm run lint`, `npm run build`,
  controller/tool/approval/persistence smokes, and `git diff --check` passed.

## Explicitly deferred

- Conversation-history listing and switching
- Thread previews and sorting
- Space and thread rename/delete
- Custom curriculum contents or templates
- Shared spaces and access control
- Persisted "last selected space" outside the URL
- Durable cross-process runs or approvals
