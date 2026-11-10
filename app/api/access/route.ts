import { NextResponse } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE_NAME, authorizePassword, createAccessSession, getAccessState } from "@/lib/access";
import { hasEmmaCredentials } from "@/lib/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json(getAccessState(request));
}

const schema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: Request) {
  if (!hasEmmaCredentials()) return NextResponse.json({ error: "No live emma workspace is configured, so no launch password is needed in preview mode." }, { status: 409 });
  if (!process.env.APP_PASSWORD) return NextResponse.json({ error: "Live launch access is locked. The workspace owner must set APP_PASSWORD on the server." }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a JSON password." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success || !authorizePassword(parsed.data.password)) return NextResponse.json({ error: "That launch password is not correct." }, { status: 401 });

  const session = createAccessSession();
  const response = NextResponse.json({ authorized: true, message: "Live launch access granted." });
  response.cookies.set(ACCESS_COOKIE_NAME, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
