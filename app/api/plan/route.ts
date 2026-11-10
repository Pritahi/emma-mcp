import { NextResponse } from "next/server";
import { z } from "zod";
import { buildDemoPlan } from "@/lib/demo";
import { buildLivePlan } from "@/lib/planner";
import { demoModeAllowed, hasEmmaCredentials } from "@/lib/status";
import { getAccessState } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ prompt: z.string().trim().min(8).max(500) });

export async function POST(request: Request) {
  const access = getAccessState(request);
  if (access.required && !access.authorized) return NextResponse.json({ error: access.message }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a JSON body with a prompt." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Describe the machine you need (8–500 characters)." }, { status: 400 });

  try {
    if (hasEmmaCredentials()) return NextResponse.json(await buildLivePlan(parsed.data.prompt));
    if (demoModeAllowed()) return NextResponse.json(buildDemoPlan(parsed.data.prompt));
    return NextResponse.json({ error: "emma is not connected. Add server-side emma credentials or enable EMMA_DEMO_MODE for a local preview." }, { status: 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not search the emma catalog.";
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 422;
    return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 422 });
  }
}
