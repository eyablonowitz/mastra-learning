# Basic fake authentication and per-user chat isolation

## Intended outcome

Gate the chat behind a username prompt and remember the active fake user in a 30-day HTTP-only cookie. The normalized username becomes a stable identity, so entering the same name resumes that user's latest conversation.

Use one shared Mastra `AgentController` with one cached `Session` and unique `resourceId` per user. This isolates threads, messages, memory, live runs, and approvals while leaving the learning backlog and read-only workspace shared.

This feature provides user partitioning for a local or trusted environment, not secure authentication. Anyone who knows another user's name can enter it and access that user's chats.

## Architecture and interface decisions

### Fake identity and browser session

- Add a centralized fake-auth module that normalizes names with Unicode normalization, trimmed and collapsed whitespace, and case-insensitive matching.
- Accept names containing 1–50 visible characters and reject control characters.
- Derive an opaque, deterministic user ID by hashing the normalized name.
- Encode the display name in a versioned cookie named `mastra_learning_user`.
- Set the cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, a 30-day lifetime, and `Secure` in production.
- Leave existing `local-learning-chat` records untouched and unreachable from new hash-derived user resources.

The server-side identity shape will be:

```ts
interface FakeUser {
  id: string;
  displayName: string;
  identityName: string;
}
```

Add the following session API:

```text
GET    /api/session
POST   /api/session { name: string }
DELETE /api/session
```

- `GET` returns `{ user: { name } | null }`.
- `POST` validates the name, sets the cookie, and returns the normalized display name.
- `DELETE` clears the cookie.
- All `/api/chat` methods resolve identity exclusively from the cookie and return `401` for a missing or invalid session.
- Chat requests never accept a client-supplied user ID.

The existing `/api/chat` request and response payloads remain unchanged.

### Mastra session isolation

- Initialize storage, the workspace, and the `AgentController` once.
- Change the runtime entry point to `getMastraRuntime(user: FakeUser): Promise<MastraRuntime>`.
- Cache one session-creation promise per derived user ID and remove rejected promises so creation can be retried.
- Create stable per-user values such as `fake-session:<hash>`, `fake-user:<hash>`, and `fake-chat:<hash>` for the session `id`, `ownerId`, and `resourceId`.
- Apply the existing read and approval permission policies to every created session.
- Let `createSession()` resume the most recent thread within the user's resource.
- Preserve the process-local singleton behavior required for SSE, live runs, and approvals. After a server restart, recreate live sessions from persisted LibSQL threads.
- Update smoke scripts to use an explicit smoke-test user or a shared-controller accessor.

The same normalized name used in multiple browsers intentionally maps to the same live session. Existing run guards continue to reject conflicting concurrent sends.

### User experience

- Render a focused username prompt before mounting `Chat`, preventing unauthenticated SSE connections.
- Show the active display name and a **Switch user** control in the chat header.
- Disable switching while a run is active or an approval is pending.
- Clear the cookie and return to the username prompt when switching.
- When an authenticated request fails, check `/api/session` and refresh to the prompt if the cookie expired.
- Retain the current most-recent-conversation and **New conversation** behavior; do not add a conversation-history picker.

## Ordered implementation plan

1. Add the fake-user normalization, validation, hashing, and cookie encoding helpers with unit tests.
2. Add the `/api/session` route and server helpers for resolving or requiring the current fake user.
3. Refactor the Mastra runtime into shared controller initialization plus lazy, cached per-user sessions.
4. Require the cookie-derived user in every chat route operation and pass that user to the runtime.
5. Add the server-rendered authentication gate, username prompt, active-user display, and switch-user behavior.
6. Update smoke scripts and project documentation to describe the trusted-environment limitation and shared backlog.
7. Run automated checks and complete the cross-user browser acceptance scenarios.

## Verification criteria

- Unit tests cover name normalization, whitespace handling, Unicode normalization, length and control-character validation, cookie decoding, and stable identity derivation.
- `Alice`, `alice`, and ` Alice ` resolve to the same identity, while distinct names produce distinct resources.
- Unauthenticated `GET`, `POST`, `PATCH`, and `DELETE /api/chat` requests return `401`.
- Alice can create messages and a new conversation; after switching to Bob, none of Alice's transcript, run state, tool activity, or approvals is visible.
- Switching back as `alice` resumes Alice's most recent conversation.
- Two browsers using the same normalized name share the same live state, while the existing run guard prevents conflicting concurrent sends.
- User switching is disabled during generation and while approval is pending.
- The learning backlog remains shared and mutable across users.
- `npm run typecheck`, `npm run lint`, `npm run build`, and the existing controller and persistence smoke checks pass.

## Explicitly deferred

- Passwords, PINs, identity providers, signed credentials, account recovery, authorization roles, and protection against username impersonation.
- Conversation-history listing and thread switching beyond resuming the latest chat and creating a new conversation.
- Per-user learning backlogs or workspaces.
- Migration or deletion of the existing shared `local-learning-chat` data.
- Multi-process session coordination or durable recovery beyond the app's current local, single-process architecture.
