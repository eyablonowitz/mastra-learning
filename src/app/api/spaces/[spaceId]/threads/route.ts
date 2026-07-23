import { authorizeLearningSpace } from "@/lib/learning-space-request";
import { getMastraRuntime } from "@/mastra/runtime";
import {
  isSessionNavigationBusy,
  navigationConflictResponse,
} from "@/mastra/session-navigation";
import {
  ensureActiveThreadPreview,
  listThreadSummaries,
  toThreadSummary,
} from "@/mastra/thread-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { spaceId } = await context.params;
  const authorization = await authorizeLearningSpace(spaceId);

  if (!authorization.authorized) {
    return authorization.response;
  }

  const { user, space } = authorization.value;
  const { session } = await getMastraRuntime(user, space);
  await ensureActiveThreadPreview(session);
  const threads = await listThreadSummaries(session);

  return Response.json({ threads });
}

export async function POST(_request: Request, context: RouteContext) {
  const { spaceId } = await context.params;
  const authorization = await authorizeLearningSpace(spaceId);

  if (!authorization.authorized) {
    return authorization.response;
  }

  const { user, space } = authorization.value;
  const { session } = await getMastraRuntime(user, space);

  if (isSessionNavigationBusy(session)) {
    return navigationConflictResponse();
  }

  const thread = await session.thread.create({ title: "New conversation" });

  return Response.json(
    { thread: toThreadSummary(thread, undefined, thread.id) },
    { status: 201 },
  );
}
