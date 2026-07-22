import { createFakeUser } from "../src/lib/fake-auth.ts";
import { getMastraRuntime } from "../src/mastra/runtime.ts";

const { session } = await getMastraRuntime(createFakeUser("controller-smoke"));
console.log(`Session ready on thread ${session.thread.getId()}`);
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
});

if (runError) throw runError;

console.log("Controller run finished");

const messages = await session.thread.listActiveMessages({ limit: 2 });

for (const message of messages) {
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  console.log(`${message.role}: ${text}`);
}

unsubscribe();
process.exit(0);
