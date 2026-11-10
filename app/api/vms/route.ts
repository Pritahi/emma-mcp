import { NextResponse } from "next/server";
import { fetchVirtualMachines } from "@/lib/emma";
import { normalizeVm } from "@/lib/normalize";
import { hasEmmaCredentials } from "@/lib/status";
import { getAccessState } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessState(request);
  if (access.required && !access.authorized) return NextResponse.json({ error: access.message }, { status: 401 });
  if (!hasEmmaCredentials()) return NextResponse.json({ mode: "demo", vms: [] });
  try {
    const vms = await fetchVirtualMachines();
    return NextResponse.json({ mode: "live", vms: vms.map(normalizeVm) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load virtual machines." }, { status: 502 });
  }
}
