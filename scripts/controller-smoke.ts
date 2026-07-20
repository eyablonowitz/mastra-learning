import { getMastraRuntime } from "../src/mastra/runtime.ts";

const { session } = await getMastraRuntime();
console.log(`Session ready on thread ${session.thread.getId()}`);

const unsubscribe = session.subscribe((event) => {
  if (
    event.type === "agent_start" ||
    event.type === "agent_end" ||
    event.type === "error"
  ) {
    console.log(
      `event: ${event.type}${event.type === "error" ? ` - ${event.error.message}` : ""}`,
    );
  }
});

await session.sendMessage({
  content: "Reply with exactly: AgentController connection successful",
});
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
