import { getPersistentLearningSmokeSpace } from "./learning-smoke-space.ts";

const { user, space } =
  await getPersistentLearningSmokeSpace("controller-smoke");
const { getMastraRuntime } = await import("../src/mastra/runtime.ts");
const { session } = await getMastraRuntime(user, space);
const threads = await session.thread.list();
const resourceId = session.identity.getResourceId();
const activeThreadId = session.thread.getId();

if (
  threads.length < 2 ||
  threads.some((thread) => thread.resourceId !== resourceId)
) {
  throw new Error(
    "Expected multiple persisted conversations scoped to the smoke-test space.",
  );
}

if (
  !activeThreadId ||
  !threads.some((thread) => thread.id === activeThreadId)
) {
  throw new Error("Expected one persisted conversation to be active.");
}

const activeMessages = await session.thread.listActiveMessages();

console.log(
  `Restored ${threads.length} threads and ${activeMessages.length} active-thread messages from space ${space.id}`,
);

if (activeMessages.length < 2) {
  throw new Error(
    "Expected the latest controller smoke-test conversation to persist and resume.",
  );
}

process.exit(0);
