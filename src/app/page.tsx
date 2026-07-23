import { redirect } from "next/navigation";
import { getLearningSpaceRepository } from "@/app-data/learning-spaces";
import { getCurrentFakeUser } from "@/lib/current-user";
import { getLearningOwnerId } from "@/lib/learning-identity";
import { LearningShell } from "./chat";
import { SignIn } from "./sign-in";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ space?: string | string[] }>;
}) {
  const user = await getCurrentFakeUser();

  if (!user) {
    return <SignIn />;
  }

  const repository = await getLearningSpaceRepository();
  const spaces = await repository.listOrCreateDefaultLearningSpaces(
    getLearningOwnerId(user.id),
  );
  const { space: requestedSpace } = await searchParams;
  const selectedSpace =
    typeof requestedSpace === "string"
      ? spaces.find((space) => space.id === requestedSpace)
      : undefined;
  const defaultSpace = spaces[0];

  if (!selectedSpace) {
    redirect(`/?space=${encodeURIComponent(defaultSpace.id)}`);
  }

  return (
    <LearningShell
      key={selectedSpace.id}
      userName={user.displayName}
      spaces={spaces}
      spaceId={selectedSpace.id}
      spaceName={selectedSpace.name}
    />
  );
}
