import { getLearningSpaceRepository } from "@/app-data/learning-spaces";
import { getCurrentFakeUser, unauthorizedResponse } from "@/lib/current-user";
import { getLearningOwnerId } from "@/lib/learning-identity";
import { createLearningSpaceForUser } from "@/lib/learning-space-creation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentFakeUser();

  if (!user) {
    return unauthorizedResponse();
  }

  const repository = await getLearningSpaceRepository();
  const spaces = await repository.listOrCreateDefaultLearningSpaces(
    getLearningOwnerId(user.id),
  );

  return Response.json({ spaces });
}

export async function POST(request: Request) {
  const user = await getCurrentFakeUser();

  if (!user) {
    return unauthorizedResponse();
  }

  const payload = await request.json().catch(() => null);
  const repository = await getLearningSpaceRepository();
  const result = await createLearningSpaceForUser(user, payload, repository);

  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return Response.json({ space: result.space }, { status: 201 });
}
