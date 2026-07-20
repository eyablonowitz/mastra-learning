import { getMastraRuntime } from "../src/mastra/runtime.ts";

const { session } = await getMastraRuntime();
const threads = await session.thread.list();
let persistedMessageCount = 0;
let persistedThreadId: string | null = null;

for (const thread of threads) {
  const messages = await session.thread.listMessages({ threadId: thread.id });

  if (messages.length > persistedMessageCount) {
    persistedMessageCount = messages.length;
    persistedThreadId = thread.id;
  }
}

console.log(
  `Restored ${persistedMessageCount} messages from thread ${persistedThreadId}`,
);

if (persistedMessageCount < 2) {
  throw new Error("Expected the controller smoke-test conversation to persist.");
}

process.exit(0);
