import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchSshKeys, importSshKey } from "@/lib/emma";
import { DEMO_SSH_KEYS } from "@/lib/demo-data";
import { demoModeAllowed, hasEmmaCredentials } from "@/lib/status";
import { getAccessState } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessState(request);
  if (access.required && !access.authorized) return NextResponse.json({ error: access.message }, { status: 401 });
  if (hasEmmaCredentials()) {
    try { return NextResponse.json({ mode: "live", keys: await fetchSshKeys() }); }
    catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not list SSH keys." }, { status: 502 });
    }
  }
  if (demoModeAllowed()) return NextResponse.json({ mode: "demo", keys: DEMO_SSH_KEYS });
  return NextResponse.json({ mode: "unconfigured", keys: [] });
}

const schema = z.object({ name: z.string().trim().min(1).max(80), publicKey: z.string().trim().min(30).max(8000) });

export async function POST(request: Request) {
  const access = getAccessState(request);
  if (access.required && !access.authorized) return NextResponse.json({ error: access.message }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a JSON body with a key name and public key." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a key name and a valid OpenSSH public key. Private keys are not accepted." }, { status: 400 });

  if (hasEmmaCredentials()) {
    try { return NextResponse.json({ mode: "live", key: await importSshKey(parsed.data.name, parsed.data.publicKey) }, { status: 201 }); }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 400;
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import this SSH key." }, { status });
    }
  }
  if (!demoModeAllowed()) return NextResponse.json({ error: "emma is not connected." }, { status: 503 });
  return NextResponse.json({ mode: "demo", key: { ...DEMO_SSH_KEYS[0], name: parsed.data.name } }, { status: 201 });
}
