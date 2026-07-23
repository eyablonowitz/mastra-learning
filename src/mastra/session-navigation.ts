import type {
  AgentControllerThread,
  Session,
} from "@mastra/core/agent-controller";

interface SessionNavigationState {
  run: {
    isRunning(): boolean;
  };
  stream: {
    isActive(): boolean;
  };
  approval: {
    isArmed(): boolean;
  };
  suspensions: {
    hasPending(): boolean;
  };
  displayState: {
    get(): {
      isRunning: boolean;
      pendingApproval: unknown;
      pendingSuspensions: ReadonlyMap<string, unknown>;
    };
  };
}

export function isSessionNavigationBusy(
  session: SessionNavigationState,
): boolean {
  const displayState = session.displayState.get();

  return (
    session.run.isRunning() ||
    session.stream.isActive() ||
    session.approval.isArmed() ||
    session.suspensions.hasPending() ||
    displayState.isRunning ||
    displayState.pendingApproval !== null ||
    displayState.pendingSuspensions.size > 0
  );
}

export function navigationConflictResponse(): Response {
  return Response.json(
    { error: "Wait for the current response to finish." },
    { status: 409 },
  );
}

export async function getOwnedSessionThread(
  session: Pick<Session, "identity" | "thread">,
  threadId: string,
): Promise<AgentControllerThread | null> {
  const thread = await session.thread.getById({ threadId });

  if (
    !thread ||
    thread.resourceId !== session.identity.getResourceId()
  ) {
    return null;
  }

  return thread;
}
