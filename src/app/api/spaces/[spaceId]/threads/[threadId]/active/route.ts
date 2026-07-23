import { authorizeLearningSpace } from "@/lib/learning-space-request";
import { getMastraRuntime } from "@/mastra/runtime";
import {
  getOwnedSessionThread,
  isSessionNavigationBusy,
  navigationConflictResponse,
} from "@/mastra/session-navigation";
import { ensureActiveThreadPreview } from "@/mastra/thread-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ spaceId: string; threadId: string }>;
}

export async function PUT(_request: Request, context: RouteContext) {
  const { spaceId, threadId } = await context.params;
  const authorization = await authorizeLearningSpace(spaceId);

  if (!authorization.authorized) {
    return authorization.response;
  }

  const { user, space } = authorization.value;
  const { session } = await getMastraRuntime(user, space);
  const thread = await getOwnedSessionThread(session, threadId);

  if (!thread) {
    return Response.json(
      { error: "Conversation not found." },
      { status: 404 },
    );
  }

  if (isSessionNavigationBusy(session)) {
    return navigationConflictResponse();
  }

  if (session.thread.getId() !== thread.id) {
    await session.thread.switch({ threadId: thread.id, emitEvent: true });
  }

  await ensureActiveThreadPreview(session);

  return new Response(null, { status: 204 });
}
