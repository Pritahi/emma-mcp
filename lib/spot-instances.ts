import { isIP } from "node:net";
import { emmaRequest } from "@/lib/emma";
import { isLinuxSpotOffer } from "@/lib/spot-offers";
import type { SourceMode, SpotOffer, SpotInstanceStatus } from "@/lib/types";

const SPOT_MUTATION_TIMEOUT_MS = 240_000;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prop(value: unknown, ...names: string[]): unknown {
  if (!isObject(value)) return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
    const match = Object.keys(value).find((key) => key.toLowerCase() === name.toLowerCase());
    if (match) return value[match];
  }
  return undefined;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function numeric(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 5 && isObject(current); depth += 1) {
    if (prop(current, "id", "spotInstanceId", "spot_instance_id") !== undefined) break;
    const nested = prop(current, "data", "result", "spotInstance", "spot_instance");
    if (!isObject(nested) || nested === current) break;
    current = nested;
  }
  return current;
}

function inferSshUser(osType: string): string {
  const normalized = osType.toLowerCase();
  if (normalized.includes("ubuntu")) return "ubuntu";
  if (normalized.includes("debian")) return "debian";
  if (normalized.includes("fedora")) return "fedora";
  if (normalized.includes("rocky")) return "rocky";
  if (normalized.includes("alma")) return "almalinux";
  if (normalized.includes("centos")) return "centos";
  if (normalized.includes("amazon")) return "ec2-user";
  if (normalized.includes("red hat") || normalized.includes("rhel")) return "ec2-user";
  return "root";
}

function isRoutableAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 2 || b === 88 && c === 99 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
    if (/^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return false;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isRoutableAddress(mapped[1]);
    return true;
  }
  return false;
}

function extractInstanceNetworks(raw: unknown): { all: string[]; publicIps: string[]; privateIps: string[] } {
  const all: string[] = [];
  const publicIps: string[] = [];
  const privateIps: string[] = [];
  const networks = prop(raw, "networks", "network", "interfaces");
  const entries = Array.isArray(networks) ? networks : isObject(networks) ? Object.values(networks) : [];

  for (const entry of entries) {
    const ip = text(prop(entry, "ip", "ipAddress", "ip_address", "address"));
    if (!ip || !isIP(ip)) continue;
    if (!all.includes(ip)) all.push(ip);
    const type = text(prop(entry, "networkType", "network_type", "type", "name")).toLowerCase();
    const routable = isRoutableAddress(ip);
    if (/(public|external|internet)/.test(type) && routable) {
      if (!publicIps.includes(ip)) publicIps.push(ip);
    } else if (/(private|internal|multicloud|multi-cloud)/.test(type) || !routable) {
      if (!privateIps.includes(ip)) privateIps.push(ip);
    } else if (!publicIps.includes(ip)) {
      publicIps.push(ip);
    }
  }
  return { all, publicIps, privateIps };
}

export function normalizeSpotInstance(value: unknown, mode: SourceMode = "live"): SpotInstanceStatus {
  const raw = unwrap(value);
  const id = text(prop(raw, "id", "spotInstanceId", "spot_instance_id"), "unknown");
  const provider = prop(raw, "provider");
  const location = prop(raw, "location");
  const dataCenter = prop(raw, "dataCenter", "data_center");
  const os = prop(raw, "os", "operatingSystem", "operating_system");
  const osType = text(prop(os, "type", "name"), text(prop(raw, "osType", "os_type")));
  const networks = extractInstanceNetworks(raw);
  const status = text(prop(raw, "status", "state"), "UNKNOWN");
  const sshUser = text(prop(raw, "userName", "user_name", "username"), inferSshUser(osType)) || inferSshUser(osType);
  const publicIpAddresses = networks.publicIps;
  const sshHost = publicIpAddresses[0];
  const isRunning = /^(on|powered_on|running|active)$/i.test(status.trim());
  const locationLabel = [
    text(prop(location, "name", "country"), text(prop(dataCenter, "locationName", "location_name"))),
    text(prop(location, "country")),
  ].filter((part, index, array) => part && array.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index).join(", ");
  const gpu = prop(raw, "accelerator", "gpu");
  const gpuCount = numeric(prop(gpu, "accelerators", "gpuCount", "gpu_count") ?? prop(raw, "accelerators", "gpuCount", "gpu_count"));
  const gpuType = text(prop(gpu, "acceleratorType", "gpuType", "gpu_type") ?? prop(raw, "gpuType", "gpu_type")) || undefined;
  const ipAddresses = [...new Set(networks.all)];

  return {
    id,
    name: text(prop(raw, "name"), "spot-instance"),
    status,
    mode,
    provider: text(prop(raw, "providerName", "provider_name"), text(prop(provider, "name"))) || undefined,
    location: locationLabel || text(prop(raw, "locationName", "location_name"), text(prop(dataCenter, "name"))) || undefined,
    os: osType || undefined,
    vCpu: numeric(prop(raw, "vCpu", "v_cpu")),
    ramGb: numeric(prop(raw, "ramGb", "ram_gb")),
    gpuType,
    gpuCount,
    publicIpAddresses,
    privateIpAddresses: networks.privateIps,
    ipAddresses,
    sshUser: sshHost ? sshUser : undefined,
    sshPort: 22,
    sshCommand: sshHost ? `ssh -p 22 ${sshUser}@${sshHost}` : undefined,
    sshReady: Boolean(sshHost && isRunning),
  };
}

export function getSpotResourceId(value: unknown): string | undefined {
  const raw = unwrap(value);
  const id = prop(raw, "id", "spotInstanceId", "spot_instance_id");
  return id === undefined || id === null || String(id).trim() === "" ? undefined : String(id);
}

function assertLiveSpotId(id: string): string {
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
    throw new Error("A live emma spot instance ID must be a positive numeric ID. Use the ID returned by provision_spot.");
  }
  return trimmed;
}

function sanitizeName(name: string): string {
  const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
  if (!sanitized) throw new Error("Provide a spot instance name containing at least one letter or number.");
  return sanitized;
}

export function buildSpotCreateBody(input: {
  offer: SpotOffer;
  name: string;
  sshKeyId: number;
  pricePerHour: number;
  initScript: string;
  securityGroupId?: number;
}): Record<string, unknown> {
  const { offer } = input;
  if (offer.source !== "live") throw new Error("Only live offers can be sent to emma.");
  if (!isLinuxSpotOffer(offer)) throw new Error("SSH benchmarking uses bash and cloud-init; only Linux spot offers can be provisioned.");
  if (!offer.dataCenterId || !Number.isInteger(offer.osId)) throw new Error("The selected spot offer is missing a data-center or operating-system ID.");
  if (!Number.isInteger(input.sshKeyId) || input.sshKeyId <= 0) throw new Error("Choose a positive numeric SSH key ID.");
  if (!Number.isFinite(input.pricePerHour) || input.pricePerHour <= 0) throw new Error("The spot bid must be a positive hourly price.");
  const network = offer.cloudNetworkTypes.find((type) => type.toLowerCase() === "isolated")
    ?? offer.cloudNetworkTypes.find((type) => type.toLowerCase() === "default")
    ?? offer.cloudNetworkTypes.find((type) => type.toLowerCase() === "multi-cloud")
    ?? offer.cloudNetworkTypes[0];
  if (!network) throw new Error("emma did not report a supported network type for this spot configuration.");
  if (input.initScript.length > 10_000) throw new Error("emma accepts initScript values up to 10,000 characters.");

  const body: Record<string, unknown> = {
    name: sanitizeName(input.name),
    dataCenterId: offer.dataCenterId,
    osId: offer.osId,
    cloudNetworkType: network,
    vCpuType: offer.vCpuType.toLowerCase(),
    vCpu: offer.vCpu,
    ramGb: offer.ramGb,
    volumeType: offer.volumeType.toLowerCase(),
    volumeGb: offer.volumeGb,
    sshKeyId: input.sshKeyId,
    price: input.pricePerHour,
    initScript: input.initScript,
  };
  if (offer.acceleratorTypeId && offer.gpuCount > 0) {
    body.acceleratorTypeId = offer.acceleratorTypeId;
    body.accelerators = offer.gpuCount;
  }
  if (input.securityGroupId !== undefined) {
    if (!Number.isInteger(input.securityGroupId) || input.securityGroupId <= 0) throw new Error("securityGroupId must be a positive integer.");
    body.securityGroupId = input.securityGroupId;
  }
  return body;
}

export async function createLiveSpotInstance(input: Parameters<typeof buildSpotCreateBody>[0]): Promise<unknown> {
  const body = buildSpotCreateBody(input);
  return emmaRequest("/v1/spot-instances", {
    method: "POST",
    body: JSON.stringify(body),
  }, SPOT_MUTATION_TIMEOUT_MS);
}

export async function fetchLiveSpotStatus(id: string): Promise<SpotInstanceStatus> {
  const safeId = assertLiveSpotId(id);
  const raw = await emmaRequest(`/v1/spot-instances/${encodeURIComponent(safeId)}`);
  return normalizeSpotInstance(raw, "live");
}

export async function deleteLiveSpotInstance(id: string): Promise<void> {
  const safeId = assertLiveSpotId(id);
  await emmaRequest(`/v1/spot-instances/${encodeURIComponent(safeId)}`, { method: "DELETE" }, SPOT_MUTATION_TIMEOUT_MS);
}
