import { createPlanToken } from "@/lib/crypto";
import { hourlyCost, formatCostLabels } from "@/lib/format";
import { parseIntent, regionMatches } from "@/lib/intent";
import { fetchLiveCatalog } from "@/lib/emma";
import { fetchOperatingSystems } from "@/lib/emma-os";
import type { ComputeIntent, ComputeOffer, PlannedOffer, SourceMode } from "@/lib/types";

function matchesOs(offer: ComputeOffer, intent: ComputeIntent): boolean {
  const reported = `${offer.osType ?? ""} ${offer.osVersion ?? ""}`.toLowerCase();
  if (!reported) return true;
  const query = intent.osQuery.toLowerCase();
  if (query === "ubuntu") return reported.includes("ubuntu") || reported.includes("linux");
  return reported.includes(query) || reported.includes("linux");
}

function meetsPrice(offer: ComputeOffer, intent: ComputeIntent): boolean {
  if (intent.maxPricePerHour === undefined) return true;
  if (!offer.cost || offer.cost.currency.toUpperCase() !== intent.currency.toUpperCase()) return false;
  const price = hourlyCost(offer.cost);
  return typeof price === "number" && price <= intent.maxPricePerHour;
}

function rank(a: ComputeOffer, b: ComputeOffer): number {
  const priceA = hourlyCost(a.cost) ?? Number.POSITIVE_INFINITY;
  const priceB = hourlyCost(b.cost) ?? Number.POSITIVE_INFINITY;
  return priceA - priceB || a.providerName.localeCompare(b.providerName) || a.vCpu - b.vCpu;
}

function planned(offers: ComputeOffer[], intent: ComputeIntent, mode: SourceMode): PlannedOffer[] {
  return offers.slice(0, 12).map((offer) => {
    const labels = formatCostLabels(offer.cost);
    return { ...offer, planToken: createPlanToken({ mode, intent, offer }), ...labels };
  });
}

export async function buildLivePlan(prompt: string) {
  const intent = parseIntent(prompt);
  const { offers: catalogOffers, catalogCount } = await fetchLiveCatalog();
  let offers = catalogOffers;
  if (offers.some((offer) => !offer.osId)) {
    try {
      const operatingSystems = await fetchOperatingSystems();
      const wanted = intent.osQuery.toLowerCase();
      const os = operatingSystems.find((item) => `${item.name} ${item.type} ${item.version}`.toLowerCase().includes(wanted))
        ?? (wanted === "ubuntu" ? operatingSystems.find((item) => `${item.name} ${item.type}`.toLowerCase().includes("linux")) : undefined);
      if (os) offers = offers.map((offer) => offer.osId ? offer : { ...offer, osId: os.id, osType: os.name || os.type, osVersion: os.version });
    } catch {
      // Keep catalog results with their returned OS IDs; missing IDs are filtered out below.
    }
  }
  const hardware = offers.filter((offer) => Boolean(offer.osId && offer.dataCenterId && offer.cloudNetworkTypes.length) && offer.vCpu >= intent.minVcpu && offer.ramGb >= intent.minRamGb && offer.volumeGb >= intent.minVolumeGb && matchesOs(offer, intent));
  const regional = hardware.filter((offer) => regionMatches(offer, intent));
  const priced = regional.filter((offer) => meetsPrice(offer, intent));
  const matches = priced.sort(rank);
  if (!matches.length) {
    const requirements = [
      `${intent.minVcpu}+ vCPU`,
      `${intent.minRamGb}+ GB RAM`,
      intent.regionQuery ? intent.regionQuery : intent.continentQuery,
      intent.maxPricePerHour !== undefined ? `under ${intent.currency} ${intent.maxPricePerHour}/hr` : undefined,
    ].filter(Boolean).join(" · ");
    const details = !hardware.length
      ? "No live configuration meets the compute and OS requirements."
      : !regional.length
        ? "Compute matches exist, but none are in the requested location."
        : intent.maxPricePerHour !== undefined
          ? "Location and compute matches exist, but none meet the hourly budget (or have a comparable price)."
          : "No matching configuration was returned.";
    throw new Error(`${details} Requested: ${requirements}. Try widening the region, budget, or minimum resources.`);
  }
  return {
    mode: "live" as const,
    intent,
    offers: planned(matches, intent, "live"),
    matchCount: matches.length,
    catalogCount,
    note: "Live configurations and pricing from your emma project. Estimates are provider-reported and can change before provisioning.",
  };
}
