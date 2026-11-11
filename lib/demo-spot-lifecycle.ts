import type { SpotBenchmarkResult, SpotInstanceStatus, SpotOffer } from "@/lib/types";

const DEMO_PUBLIC_IP = "203.0.113.42";
const instances = new Map<string, { status: SpotInstanceStatus; benchmark: SpotBenchmarkResult }>();
let nextId = 1;

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "spot-demo";
}

export function createDemoSpotInstance(input: { offer: SpotOffer; name: string }) {
  if (input.offer.source !== "demo") throw new Error("Only preview offers can be used for a simulated spot launch.");
  const id = `demo-spot-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
  const name = slug(input.name);
  const status: SpotInstanceStatus = {
    id,
    name,
    status: "ON",
    mode: "demo",
    provider: input.offer.providerName,
    location: input.offer.regionLabel,
    os: `${input.offer.osType ?? "Linux"} ${input.offer.osVersion ?? ""}`.trim(),
    vCpu: input.offer.vCpu,
    ramGb: input.offer.ramGb,
    gpuType: input.offer.gpuType,
    gpuCount: input.offer.gpuCount,
    publicIpAddresses: [DEMO_PUBLIC_IP],
    privateIpAddresses: [],
    ipAddresses: [DEMO_PUBLIC_IP],
    sshPort: 22,
    sshReady: false,
  };
  const benchmark: SpotBenchmarkResult = {
    command: "SIMULATED: curl timing loop to https://example.com (3 requests)",
    stdout: [
      "[preview only — SSH was not opened and no benchmark ran on a cloud VM]",
      "request=1 total_seconds=0.041 http_status=200",
      "request=2 total_seconds=0.038 http_status=200",
      "request=3 total_seconds=0.040 http_status=200",
      "average_total_seconds=0.040",
    ].join("\n"),
    stderr: "",
    exitCode: 0,
    durationMs: 0,
    simulated: true,
  };
  instances.set(id, { status, benchmark });
  return {
    mode: "demo" as const,
    instance: status,
    benchmark,
    nextAction: `Call destroy_instance with instance_id=${id} to complete the simulated lifecycle.`,
    message: "Simulated preview result. No emma API call, SSH connection, or cloud resource was used.",
  };
}

export function getDemoSpotStatus(id: string): SpotInstanceStatus {
  const instance = instances.get(id);
  if (!instance) throw new Error(`No simulated spot instance ${id} exists in this MCP process.`);
  return instance.status;
}

export function getDemoSpotBenchmark(id: string): SpotBenchmarkResult | undefined {
  return instances.get(id)?.benchmark;
}

export function destroyDemoSpotInstance(id: string): { id: string; destroyed: true; mode: "demo"; message: string } {
  if (!instances.has(id)) throw new Error(`No simulated spot instance ${id} exists in this MCP process.`);
  instances.delete(id);
  return { id, destroyed: true, mode: "demo", message: "Simulated spot instance destroyed. No cloud resource existed." };
}

export function clearDemoSpotInstancesForTests(): void {
  instances.clear();
  nextId = 1;
}
