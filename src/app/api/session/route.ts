import { NextResponse } from "next/server";
import {
  createFakeUser,
  encodeFakeAuthCookie,
  FAKE_AUTH_COOKIE_MAX_AGE_SECONDS,
  FAKE_AUTH_COOKIE_NAME,
  FakeAuthValidationError,
} from "@/lib/fake-auth";
import { getCurrentFakeUser } from "@/lib/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentFakeUser();
  return Response.json({ user: user ? { name: user.displayName } : null });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { name?: unknown }
    | null;

  if (typeof body?.name !== "string") {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  try {
    const user = createFakeUser(body.name);
    const response = NextResponse.json({ user: { name: user.displayName } });

    response.cookies.set(FAKE_AUTH_COOKIE_NAME, encodeFakeAuthCookie(user), {
      httpOnly: true,
      maxAge: FAKE_AUTH_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    if (error instanceof FakeAuthValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
}

export async function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(FAKE_AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
