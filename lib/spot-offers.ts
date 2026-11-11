import { emmaRequest } from "@/lib/emma";
import type { OfferCost, SpotOffer, SpotSearchFilters } from "@/lib/types";

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

function hourlyRate(amount: number, unit: string): number | undefined {
  const normalized = unit.toLowerCase().replace(/[^a-z]/g, "");
  if (/^(h|hr|hrs|hour|hours|hourly)$/.test(normalized)) return amount;
  if (/^(d|day|days|daily)$/.test(normalized)) return amount / 24;
  if (/^(w|wk|week|weeks|weekly)$/.test(normalized)) return amount / 168;
  if (/^(mo|mon|month|months|monthly)$/.test(normalized)) return amount / 730;
  if (/^(y|yr|year|years|annual|annually)$/.test(normalized)) return amount / 8760;
  return undefined;
}

function spotCost(raw: JsonObject): { cost: OfferCost; pricePerHour: number } | undefined {
  const costObject = prop(raw, "cost");
  const cost = isObject(costObject) ? costObject : undefined;
  const directHourly = numeric(prop(raw, "pricePerHour", "price_per_hour", "hourlyPrice", "hourly_price"));
  const amount = directHourly ?? numeric(prop(cost, "pricePerUnit", "price", "amount") ?? prop(raw, "pricePerUnit", "price", "amount"));
  if (amount === undefined || amount <= 0) return undefined;

  const unit = directHourly !== undefined ? "hour" : text(prop(cost, "unit", "period"), text(prop(raw, "priceUnit", "price_unit", "unit"), ""));
  const currency = text(prop(cost, "currency"), text(prop(raw, "currency"), "USD")).toUpperCase();
  const perHour = directHourly ?? hourlyRate(amount, unit);
  if (perHour === undefined || !Number.isFinite(perHour) || perHour <= 0) return undefined;

  return {
    cost: { amount, currency, unit: unit || "unknown", perHour },
    pricePerHour: perHour,
  };
}

function findLocation(raw: JsonObject, locations: Map<number, JsonObject>): JsonObject | undefined {
  const location = prop(raw, "location");
  const dc = prop(raw, "dataCenter", "data_center");
  const id = numeric(prop(raw, "locationId", "location_id") ?? prop(dc, "locationId", "location_id") ?? prop(location, "id"));
  return id === undefined ? (isObject(location) ? location : undefined) : locations.get(id) ?? (isObject(location) ? location : undefined);
}

export function normalizeSpotConfiguration(raw: JsonObject, locations: Map<number, JsonObject> = new Map()): SpotOffer | undefined {
  const dc = prop(raw, "dataCenter", "data_center");
  const provider = prop(raw, "provider");
  const os = prop(raw, "os", "operatingSystem", "operating_system");
  const location = findLocation(raw, locations);
  const providerName = text(prop(raw, "providerName", "provider_name"), text(prop(provider, "name"), text(prop(dc, "providerName", "provider_name"), "Cloud provider")));
  const providerId = numeric(prop(raw, "providerId", "provider_id") ?? prop(provider, "id") ?? prop(dc, "providerId", "provider_id"));
  const locationId = numeric(prop(raw, "locationId", "location_id") ?? prop(location, "id") ?? prop(dc, "locationId", "location_id"));
  const locationName = text(prop(raw, "locationName", "location_name"), text(prop(dc, "locationName", "location_name"), text(prop(location, "name"), "Unknown location")));
  const country = text(prop(location, "country"), text(prop(raw, "country"), "")) || undefined;
  const continent = text(prop(location, "continent"), text(prop(raw, "continent"), "")) || undefined;
  const region = text(prop(raw, "region"), text(prop(location, "region"), "")) || undefined;
  const dataCenterId = text(prop(raw, "dataCenterId", "data_center_id"), text(prop(dc, "id"), ""));
  const dataCenterName = text(prop(raw, "dataCenterName", "data_center_name"), text(prop(dc, "name"), dataCenterId));
  const osId = numeric(prop(raw, "osId", "os_id") ?? prop(os, "id"));
  const vCpu = numeric(prop(raw, "vCpu", "v_cpu")) ?? 0;
  const ramGb = numeric(prop(raw, "ramGb", "ram_gb")) ?? 0;
  const volumeGb = numeric(prop(raw, "volumeGb", "volume_gb")) ?? 0;
  const volumeType = text(prop(raw, "volumeType", "volume_type"), "ssd");
  const vCpuType = text(prop(raw, "vCpuType", "v_cpu_type"), "standard");
  const rawNetworks = prop(raw, "cloudNetworkTypes", "cloud_network_types");
  const cloudNetworkTypes = Array.isArray(rawNetworks)
    ? rawNetworks.map((item) => String(item)).filter(Boolean)
    : typeof rawNetworks === "string" ? [rawNetworks] : [];
  const accelerator = prop(raw, "accelerator", "gpu");
  const gpuCount = numeric(prop(accelerator, "accelerators", "gpuCount", "gpu_count") ?? prop(raw, "accelerators", "gpuCount", "gpu_count")) ?? 0;
  const acceleratorTypeId = text(prop(accelerator, "acceleratorTypeId", "accelerator_type_id") ?? prop(raw, "acceleratorTypeId", "accelerator_type_id"), "") || undefined;
  const gpuType = text(prop(accelerator, "acceleratorType", "acceleratorTypeName", "gpuType", "gpu_type") ?? prop(raw, "acceleratorType", "gpuType", "gpu_type"), "") || undefined;
  const gpuMemoryGb = numeric(prop(accelerator, "totalGpuMemoryGb", "total_gpu_memory_gb", "gpuMemoryGb")) ?? undefined;
  const price = spotCost(raw);
  const osType = text(prop(raw, "osType", "os_type"), text(prop(os, "type", "family", "name"), "")) || undefined;
  const osVersion = text(prop(raw, "osVersion", "os_version"), text(prop(os, "version"), "")) || undefined;

  if (!dataCenterId || osId === undefined || !Number.isInteger(osId) || !cloudNetworkTypes.length || vCpu <= 0 || ramGb <= 0 || volumeGb <= 0 || !price) {
    return undefined;
  }

  const id = text(prop(raw, "id", "configurationId", "configuration_id"), `${providerId ?? providerName}-${dataCenterId}-${vCpu}-${ramGb}-${volumeGb}-${acceleratorTypeId ?? "cpu"}`);
  const regionParts = [locationName, country, continent].filter((item, index, array) => item && array.findIndex((other) => other?.toLowerCase() === item.toLowerCase()) === index);
  const regionLabel = regionParts.join(", ") || dataCenterName;

  return {
    id,
    providerId,
    providerName,
    locationId,
    locationName,
    country,
    continent,
    region,
    dataCenterId,
    dataCenterName: dataCenterName || dataCenterId,
    osId,
    osType,
    osVersion,
    cloudNetworkTypes,
    vCpuType,
    vCpu,
    ramGb,
    volumeGb,
    volumeType,
    acceleratorTypeId,
    gpuType,
    gpuCount,
    gpuMemoryGb,
    cost: price.cost,
    pricePerHour: price.pricePerHour,
    currency: price.cost.currency,
    regionLabel,
    source: "live",
  };
}

export function isLinuxSpotOffer(offer: SpotOffer): boolean {
  const os = `${offer.osType ?? ""} ${offer.osVersion ?? ""}`.toLowerCase();
  if (/\bwindows\b/i.test(os)) return false;
  return /linux|ubuntu|debian|fedora|rocky|alma(?:linux)?|centos|red\s*hat|\brhel\b|\barch(?:linux)?\b/i.test(os);
}

export function filterAndRankSpotOffers(offers: SpotOffer[], filters: SpotSearchFilters): SpotOffer[] {
  const regionQuery = filters.region?.trim().toLowerCase();
  const gpuQuery = filters.gpuType?.trim().toLowerCase();
  const currency = filters.currency?.trim().toUpperCase();
  return offers
    .filter((offer) => {
      if (!isLinuxSpotOffer(offer)) return false;
      if (filters.minVcpu !== undefined && offer.vCpu < filters.minVcpu) return false;
      if (filters.minRamGb !== undefined && offer.ramGb < filters.minRamGb) return false;
      if (filters.minGpuCount !== undefined && offer.gpuCount < filters.minGpuCount) return false;
      if (gpuQuery && (!offer.gpuType || !offer.gpuType.toLowerCase().includes(gpuQuery))) return false;
      if (regionQuery) {
        const searchable = [offer.locationName, offer.country, offer.region, offer.continent, offer.dataCenterName, offer.dataCenterId, offer.regionLabel]
          .filter(Boolean).join(" ").toLowerCase();
        if (!searchable.includes(regionQuery)) return false;
      }
      if (currency && offer.currency.toUpperCase() !== currency) return false;
      if (filters.maxPricePerHour !== undefined && offer.pricePerHour > filters.maxPricePerHour) return false;
      return true;
    })
    .sort((a, b) => {
      if (!currency && a.currency !== b.currency) return a.currency.localeCompare(b.currency);
      return a.pricePerHour - b.pricePerHour
        || a.providerName.localeCompare(b.providerName)
        || a.vCpu - b.vCpu
        || a.ramGb - b.ramGb;
    });
}

function queryPath(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function getAllSpotConfigurations(filters: SpotSearchFilters): Promise<JsonObject[]> {
  const all: JsonObject[] = [];
  const maxPages = 20;
  let totalPages = 1;
  for (let page = 0; page < maxPages && page < totalPages; page += 1) {
    const params = {
      page,
      size: 100,
      vCpuMin: filters.minVcpu,
      ramGbMin: filters.minRamGb,
      acceleratorsMin: filters.minGpuCount ?? (filters.gpuType ? 1 : undefined),
    };
    const data = await emmaRequest(queryPath("/v1/spots-configs", params));
    const entries = listFrom(data);
    all.push(...entries);
    totalPages = Math.max(1, numeric(prop(data, "totalPages", "total_pages")) ?? 1);
    if (!entries.length || prop(data, "last") === true) break;
  }
  return all;
}

export async function fetchLiveSpotOffers(filters: SpotSearchFilters): Promise<{ offers: SpotOffer[]; catalogCount: number }> {
  const [configs, rawLocations] = await Promise.all([
    getAllSpotConfigurations(filters),
    emmaRequest("/v1/locations"),
  ]);
  const locations = new Map<number, JsonObject>();
  for (const location of listFrom(rawLocations)) {
    const id = numeric(prop(location, "id"));
    if (id !== undefined) locations.set(id, location);
  }
  const offers = configs
    .map((config) => normalizeSpotConfiguration(config, locations))
    .filter((offer): offer is SpotOffer => Boolean(offer));
  return { offers, catalogCount: configs.length };
}
