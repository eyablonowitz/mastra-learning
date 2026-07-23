import { getPersistentLearningSmokeSpace } from "./learning-smoke-space.ts";

const { user, space } =
  await getPersistentLearningSmokeSpace("controller-smoke");
const [{ getMastraRuntime }, { createLearningRequestContext }] =
  await Promise.all([
    import("../src/mastra/runtime.ts"),
    import("../src/mastra/learning-request-context.ts"),
  ]);
const { session } = await getMastraRuntime(user, space);
const resourceId = session.identity.getResourceId();
const conversationThreadId = session.thread.getId();

console.log(
  `Session ready for space ${space.id} on thread ${conversationThreadId}`,
);

if (!conversationThreadId) {
  throw new Error("Expected the Session to have an active thread.");
}

const alternateThread = await session.thread.create({
  title: "Controller smoke alternate conversation",
});

if (alternateThread.resourceId !== resourceId) {
  throw new Error("The alternate conversation escaped the space resource.");
}

const resourceThreads = await session.thread.list();

if (
  resourceThreads.length < 2 ||
  resourceThreads.some((thread) => thread.resourceId !== resourceId)
) {
  throw new Error(
    "Expected at least two resource-scoped conversations before the run.",
  );
}

await session.thread.switch({
  threadId: conversationThreadId,
  emitEvent: true,
});

if (
  session.thread.getId() !== conversationThreadId ||
  session.identity.getResourceId() !== resourceId
) {
  throw new Error(
    "Switching conversations changed the active resource or selected the wrong thread.",
  );
}

console.log(
  `Created alternate thread ${alternateThread.id} and returned to ${conversationThreadId}`,
);

let runError: Error | null = null;

const unsubscribe = session.subscribe((event) => {
  if (
    event.type === "agent_start" ||
    event.type === "agent_end" ||
    event.type === "error"
  ) {
    if (event.type === "error") runError = event.error;
    console.log(
      `event: ${event.type}${event.type === "error" ? ` - ${event.error.message}` : ""}`,
    );
  }
});

await session.sendMessage({
  content: "Reply with exactly: AgentController connection successful",
  requestContext: createLearningRequestContext(user, space),
});

if (runError) throw runError;

console.log("Controller run finished");

const messages = await session.thread.listActiveMessages({ limit: 2 });

if (messages.length < 2) {
  throw new Error(
    "Expected the original conversation transcript after switching back.",
  );
}

for (const message of messages) {
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  console.log(`${message.role}: ${text}`);
}

unsubscribe();
process.exit(0);
