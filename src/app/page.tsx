import { getCurrentFakeUser } from "@/lib/current-user";
import { Chat } from "./chat";
import { SignIn } from "./sign-in";

export default async function Home() {
  const user = await getCurrentFakeUser();
  return user ? <Chat userName={user.displayName} /> : <SignIn />;
}
