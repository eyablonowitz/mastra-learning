import "server-only";
import { cookies } from "next/headers";
import {
  decodeFakeAuthCookie,
  FAKE_AUTH_COOKIE_NAME,
  type FakeUser,
} from "./fake-auth.ts";

export async function getCurrentFakeUser(): Promise<FakeUser | null> {
  const cookieStore = await cookies();
  return decodeFakeAuthCookie(cookieStore.get(FAKE_AUTH_COOKIE_NAME)?.value);
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: "Sign in with a name to use the chat." },
    { status: 401 },
  );
}
