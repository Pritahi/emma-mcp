import type { ComputeOffer, SshKeySummary } from "@/lib/types";

const API_BASE = "https://api.emma.ms/external";
const REQUEST_TIMEOUT_MS = 30_000;
const PROVISION_TIMEOUT_MS = 240_000;

type JsonObject = Record<string, unknown>;

interface TokenCache {
  fingerprint: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

let tokenCache: TokenCache | undefined;

export class EmmaApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EmmaApiError";
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prop(object: unknown, ...names: string[]): unknown {
  if (!isObject(object)) return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(object, name)) return object[name];
    const found = Object.keys(object).find((key) => key.toLowerCase() === name.toLowerCase());
    if (found) return object[found];
  }
  return undefined;
}

function text(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listFrom(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isObject);
  if (!isObject(value)) return [];
  for (const key of ["content", "items", "results", "records", "data", "values"]) {
    const nested = prop(value, key);
    if (Array.isArray(nested)) return nested.filter(isObject);
    if (isObject(nested)) {
      const deep = listFrom(nested);
      if (deep.length) return deep;
    }
  }
  return [];
}

function parseJsonOrText(body: string): unknown {
  if (!body) return undefined;
  try { return JSON.parse(body) as unknown; } catch { return body; }
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.slice(0, 500);
  const message = prop(value, "message", "detail", "error_description", "error", "title");
  return text(message, fallback).slice(0, 500);
}

function authFingerprint(): string {
  return [process.env.EMMA_CLIENT_ID ?? "", process.env.EMMA_CLIENT_SECRET ?? "", process.env.EMMA_TOKEN ?? process.env.EMMA_ACCESS_TOKEN ?? ""].join("|");
}

function directToken(): string | undefined {
  return process.env.EMMA_TOKEN || process.env.EMMA_ACCESS_TOKEN || undefined;
}

function canRefreshWithClientSecret(): boolean {
  return Boolean(process.env.EMMA_CLIENT_ID && process.env.EMMA_CLIENT_SECRET);
}

async function requestJson(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new EmmaApiError(`Could not reach emma: ${reason}`);
  }
  const raw = await response.text();
  const parsed = parseJsonOrText(raw);
  if (!response.ok) {
    throw new EmmaApiError(errorMessage(parsed, `emma returned HTTP ${response.status}`), response.status);
  }
  return parsed;
}

async function issueAccessToken(force = false): Promise<string> {
  const fingerprint = authFingerprint();
  const direct = directToken();
  if (!force && direct && (!tokenCache || tokenCache.fingerprint !== fingerprint)) return direct;
  if (!force && tokenCache?.fingerprint === fingerprint && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.accessToken;

  const clientId = process.env.EMMA_CLIENT_ID;
  const clientSecret = process.env.EMMA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    if (direct) return direct;
    throw new EmmaApiError("emma is not connected. Add EMMA_CLIENT_ID and EMMA_CLIENT_SECRET to the server environment.");
  }

  let data: unknown;
  if (tokenCache?.fingerprint === fingerprint && tokenCache.refreshToken) {
    try {
      data = await requestJson(`${API_BASE}/v1/refresh-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refreshToken: tokenCache.refreshToken }),
      });
    } catch {
      tokenCache = undefined;
      data = undefined;
    }
  }
  if (!data) {
    data = await requestJson(`${API_BASE}/v1/issue-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
  }

  const accessToken = text(prop(data, "accessToken", "access_token"));
  if (!accessToken) throw new EmmaApiError("emma authentication succeeded without an access token.");
  const expiresIn = number(prop(data, "expiresIn", "expires_in"), 600);
  const refreshToken = text(prop(data, "refreshToken", "refresh_token")) || undefined;
  tokenCache = { fingerprint, accessToken, refreshToken, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
  return accessToken;
}

export async function emmaRequest(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  let accessToken = await issueAccessToken();
  const send = (token: string) => fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  let response: Response;
  try {
    response = await send(accessToken);
    if (response.status === 401 && canRefreshWithClientSecret()) {
      await response.arrayBuffer().catch(() => undefined);
      accessToken = await issueAccessToken(true);
      response = await send(accessToken);
    }
  } catch (error) {
    if (error instanceof EmmaApiError) throw error;
    const reason = error instanceof Error ? error.message : "network error";
    throw new EmmaApiError(`Could not reach emma: ${reason}`);
  }

  const raw = await response.text();
  const parsed = parseJsonOrText(raw);
  if (!response.ok) throw new EmmaApiError(errorMessage(parsed, `emma returned HTTP ${response.status}`), response.status);
  return parsed;
}

function queryPath(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function allVmConfigs(): Promise<JsonObject[]> {
  const all: JsonObject[] = [];
  const maxPages = 10;
  let totalPages = 1;
  for (let page = 0; page < maxPages && page < totalPages; page += 1) {
    const data = await emmaRequest(queryPath("/v1/vms-configs", { page, size: 100 }));
    const items = listFrom(data);
    all.push(...items);
    const pages = number(prop(data, "totalPages", "total_pages"), 1);
    totalPages = Math.max(1, pages);
    if (!items.length || prop(data, "last", "Last") === true) break;
  }
  return all;
}

function normalizeCost(value: unknown): ComputeOffer["cost"] {
  if (!isObject(value)) return undefined;
  const amount = Number(prop(value, "pricePerUnit", "price_per_unit", "amount", "price"));
  if (!Number.isFinite(amount)) return undefined;
  return {
    amount,
    currency: text(prop(value, "currency"), "USD").toUpperCase(),
    unit: text(prop(value, "unit", "period"), ""),
  };
}

function normalizeConfig(raw: JsonObject, locations: Map<number, JsonObject>): ComputeOffer {
  const locationId = number(prop(raw, "locationId", "location_id"), NaN);
  const location = locations.get(locationId);
  const providerName = text(prop(raw, "providerName", "provider_name"), text(prop(prop(raw, "provider"), "name"), "Cloud provider"));
  const locationName = text(prop(raw, "locationName", "location_name"), text(prop(location, "name"), "Unknown location"));
  const dataCenterId = text(prop(raw, "dataCenterId", "data_center_id"), "");
  const dataCenterName = text(prop(raw, "dataCenterName", "data_center_name"), dataCenterId || "Data center");
  const region = text(prop(location, "region"), text(prop(raw, "region"), ""));
  const continent = text(prop(location, "continent"), text(prop(raw, "continent"), ""));
  const osType = text(prop(raw, "osType", "os_type", "operatingSystem", "operating_system"), "");
  const osVersion = text(prop(raw, "osVersion", "os_version"), "");
  const providerIdNumber = number(prop(raw, "providerId", "provider_id"), NaN);
  const locationIdNumber = Number.isFinite(locationId) ? locationId : undefined;
  const cloudTypes = prop(raw, "cloudNetworkTypes", "cloud_network_types");
  const cloudNetworkTypes = Array.isArray(cloudTypes) ? cloudTypes.map((item) => String(item)) : [];
  const configId = prop(raw, "id", "configurationId", "configuration_id");
  const id = text(configId, `${providerName}-${dataCenterId}-${prop(raw, "vCpu", "v_cpu")}-${prop(raw, "ramGb", "ram_gb")}`);
  const osIdNumber = number(prop(raw, "osId", "os_id"), NaN);
  const vCpuType = text(prop(raw, "vCpuType", "v_cpu_type"), "Standard");
  const vCpu = number(prop(raw, "vCpu", "v_cpu"), 0);
  const ramGb = number(prop(raw, "ramGb", "ram_gb"), 0);
  const volumeGb = number(prop(raw, "volumeGb", "volume_gb"), 0);
  const volumeType = text(prop(raw, "volumeType", "volume_type"), "SSD");
  const regionLabel = [locationName, region && region.toLowerCase() !== locationName.toLowerCase() ? region : "", continent].filter(Boolean).join(", ");

  return {
    id,
    providerId: Number.isFinite(providerIdNumber) ? providerIdNumber : undefined,
    providerName,
    locationId: locationIdNumber,
    locationName,
    continent: continent || undefined,
    region: region || undefined,
    dataCenterId,
    dataCenterName,
    osId: Number.isFinite(osIdNumber) ? osIdNumber : undefined,
    osType: osType || undefined,
    osVersion: osVersion || undefined,
    vCpu,
    vCpuType,
    ramGb,
    volumeGb,
    volumeType,
    cloudNetworkTypes,
    cost: normalizeCost(prop(raw, "cost", "price")),
    regionLabel,
    source: "live",
  };
}

export async function fetchLiveCatalog(): Promise<{ offers: ComputeOffer[]; catalogCount: number }> {
  const [configs, rawLocations] = await Promise.all([
    allVmConfigs(),
    emmaRequest("/v1/locations"),
  ]);
  const locations = new Map<number, JsonObject>();
  for (const location of listFrom(rawLocations)) {
    const id = number(prop(location, "id"), NaN);
    if (Number.isFinite(id)) locations.set(id, location);
  }
  return { offers: configs.map((item) => normalizeConfig(item, locations)), catalogCount: configs.length };
}

export async function fetchProviders(): Promise<JsonObject[]> {
  return listFrom(await emmaRequest("/v1/providers"));
}

function normalizeSshKey(raw: JsonObject): SshKeySummary | undefined {
  const id = prop(raw, "id", "sshKeyId", "ssh_key_id");
  if (id === undefined || id === null) return undefined;
  return {
    id: typeof id === "number" || typeof id === "string" ? id : String(id),
    name: text(prop(raw, "name"), "SSH key"),
    fingerprint: text(prop(raw, "fingerprint"), "") || undefined,
    keyType: text(prop(raw, "keyType", "key_type"), "") || undefined,
    source: "live",
  };
}

export async function fetchSshKeys(): Promise<SshKeySummary[]> {
  return listFrom(await emmaRequest("/v1/ssh-keys")).map(normalizeSshKey).filter((key): key is SshKeySummary => Boolean(key));
}

export async function importSshKey(name: string, publicKey: string): Promise<SshKeySummary> {
  const trimmedName = name.trim().slice(0, 80);
  const trimmedKey = publicKey.trim();
  if (!trimmedName) throw new EmmaApiError("Give the SSH key a name.");
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521)\s+[A-Za-z0-9+/=]+(?:\s+.*)?$/.test(trimmedKey)) {
    throw new EmmaApiError("Paste a valid OpenSSH public key (ssh-ed25519, ssh-rsa, or ecdsa-sha2-...). Never paste a private key.");
  }
  const result = await emmaRequest("/v1/ssh-keys", {
    method: "POST",
    body: JSON.stringify({ name: trimmedName, key: trimmedKey }),
  });
  const keyObject = (isObject(result) && isObject(prop(result, "data")) ? prop(result, "data") : result) as unknown;
  const key = isObject(keyObject) ? normalizeSshKey(keyObject) : undefined;
  if (!key) throw new EmmaApiError("emma accepted the SSH key but did not return a key ID. Refresh the SSH key list and try again.");
  return key;
}

export async function createVirtualMachine(input: {
  offer: ComputeOffer;
  name: string;
  sshKeyId: number;
  osId?: number;
}): Promise<unknown> {
  const { offer } = input;
  if (!offer.dataCenterId) throw new EmmaApiError("This catalog entry is missing a data-center ID and cannot be provisioned.");
  const osId = input.osId ?? offer.osId;
  if (typeof osId !== "number" || !Number.isFinite(osId)) {
    throw new EmmaApiError("This offer has no operating-system ID. Refresh the catalog or choose another configuration.");
  }
  const network = offer.cloudNetworkTypes.find((type) => /isolat/i.test(type)) ?? offer.cloudNetworkTypes[0];
  if (!network) throw new EmmaApiError("emma did not report a supported network type for this configuration.");
  const body = {
    name: input.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 63) || "emma-dev-box",
    dataCenterId: offer.dataCenterId,
    osId,
    cloudNetworkType: network,
    vCpuType: offer.vCpuType,
    vCpu: offer.vCpu,
    ramGb: offer.ramGb,
    volumeType: offer.volumeType,
    volumeGb: offer.volumeGb,
    sshKeyId: input.sshKeyId,
  };
  return emmaRequest("/v1/vms", { method: "POST", body: JSON.stringify(body) }, PROVISION_TIMEOUT_MS);
}

export async function fetchVirtualMachines(): Promise<JsonObject[]> {
  return listFrom(await emmaRequest("/v1/vms"));
}

export function getString(value: unknown, ...names: string[]): string {
  return text(prop(value, ...names));
}

export function getNumber(value: unknown, ...names: string[]): number | undefined {
  const parsed = number(prop(value, ...names), NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractIps(value: unknown): string[] {
  const ips: string[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (depth > 6 || node === null || node === undefined) return;
    if (Array.isArray(node)) return node.forEach((item) => visit(item, depth + 1));
    if (!isObject(node)) return;
    for (const key of Object.keys(node)) {
      const item = node[key];
      if (/^(ip|ipAddress|ip_address|publicIp|public_ip|address)$/i.test(key) && typeof item === "string" && /^(\d{1,3}\.){3}\d{1,3}$/.test(item)) ips.push(item);
      else if (key.toLowerCase().includes("ip") || key.toLowerCase().includes("network")) visit(item, depth + 1);
    }
  };
  visit(value);
  return [...new Set(ips)];
}
