import { NextResponse } from "next/server";
import { fetchProviders } from "@/lib/emma";
import { demoModeAllowed, hasEmmaCredentials } from "@/lib/status";
import { getAccessState } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessState(request);
  if (access.required && !access.authorized) {
    return NextResponse.json({ mode: "locked", status: "locked", providerCount: 0, message: access.message });
  }
  if (!hasEmmaCredentials()) {
    return NextResponse.json({
      mode: demoModeAllowed() ? "demo" : "unconfigured",
      status: demoModeAllowed() ? "preview" : "not-connected",
      providerCount: 0,
      message: demoModeAllowed()
        ? "Preview mode — connect a Manage-scope emma Service App to query live catalogs and create real resources."
        : "Add emma service credentials to enable this app.",
    });
  }

  try {
    const providers = await fetchProviders();
    return NextResponse.json({
      mode: "live",
      status: "connected",
      providerCount: providers.length,
      message: "Connected to your emma project. All catalog results are live.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify emma credentials.";
    return NextResponse.json({ mode: "live", status: "error", providerCount: 0, message }, { status: 502 });
  }
}
