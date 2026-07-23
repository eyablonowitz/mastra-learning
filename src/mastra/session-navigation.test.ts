import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "@mastra/core/agent-controller";
import {
  getOwnedSessionThread,
  isSessionNavigationBusy,
} from "./session-navigation.ts";

function navigationState(
  active:
    | "idle"
    | "run"
    | "stream"
    | "approval"
    | "suspension"
    | "display-run"
    | "display-approval"
    | "display-suspension",
) {
  return {
    run: { isRunning: () => active === "run" },
    stream: { isActive: () => active === "stream" },
    approval: { isArmed: () => active === "approval" },
    suspensions: { hasPending: () => active === "suspension" },
    displayState: {
      get: () => ({
        isRunning: active === "display-run",
        pendingApproval: active === "display-approval" ? {} : null,
        pendingSuspensions: new Map(
          active === "display-suspension" ? [["tool-call", {}]] : [],
        ),
      }),
    },
  };
}

test("recognizes every run, approval, and suspension busy signal", () => {
  assert.equal(isSessionNavigationBusy(navigationState("idle")), false);

  for (const active of [
    "run",
    "stream",
    "approval",
    "suspension",
    "display-run",
    "display-approval",
    "display-suspension",
  ] as const) {
    assert.equal(
      isSessionNavigationBusy(navigationState(active)),
      true,
      active,
    );
  }
});

test("accepts an owned thread and rejects missing or foreign threads", async () => {
  const owned = {
    id: "owned",
    resourceId: "resource-a",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const foreign = { ...owned, id: "foreign", resourceId: "resource-b" };
  const session = {
    identity: {
      getResourceId: () => "resource-a",
    },
    thread: {
      getById: async ({ threadId }: { threadId: string }) =>
        threadId === "owned" ? owned : threadId === "foreign" ? foreign : null,
    },
  } as unknown as Pick<Session, "identity" | "thread">;

  assert.equal(await getOwnedSessionThread(session, "owned"), owned);
  assert.equal(await getOwnedSessionThread(session, "foreign"), null);
  assert.equal(await getOwnedSessionThread(session, "missing"), null);
});
