import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchSshKeys, EmmaApiError } from "@/lib/emma";
import { verifyPlanToken } from "@/lib/crypto";
import { provisionFromPlan } from "@/lib/provision";
import { demoModeAllowed, hasEmmaCredentials } from "@/lib/status";
import { getAccessState } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  planToken: z.string().min(20).max(20_000),
  sshKeyId: z.union([z.number().int().positive(), z.string().min(1).max(120)]),
  name: z.string().trim().min(1).max(63),
  confirmed: z.literal(true),
});

export async function POST(request: Request) {
  const access = getAccessState(request);
  if (access.required && !access.authorized) return NextResponse.json({ error: access.message }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a JSON body to confirm this launch." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "A current plan, SSH key, name, and explicit confirmation are required." }, { status: 400 });

  try {
    const plan = verifyPlanToken(parsed.data.planToken);
    if (plan.mode === "live" && !hasEmmaCredentials()) return NextResponse.json({ error: "This plan was created in live mode, but emma credentials are no longer configured. Search again after reconnecting." }, { status: 409 });
    if (plan.mode === "demo" && !demoModeAllowed()) return NextResponse.json({ error: "Preview mode is disabled." }, { status: 403 });

    if (plan.mode === "live") {
      const keys = await fetchSshKeys();
      if (!keys.some((key) => String(key.id) === String(parsed.data.sshKeyId))) {
        return NextResponse.json({ error: "That SSH key is not available to this emma Service App. Import a key from Launchpad and try again." }, { status: 400 });
      }
    }

    const vm = await provisionFromPlan({
      offer: plan.offer,
      name: parsed.data.name,
      sshKeyId: parsed.data.sshKeyId,
      mode: plan.mode,
      osId: plan.offer.osId,
    });
    return NextResponse.json({ vm }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The provision request failed.";
    const status = error instanceof EmmaApiError && error.status ? error.status : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
