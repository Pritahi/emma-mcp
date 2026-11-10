import { createPlanToken } from "@/lib/crypto";
import { parseIntent, regionMatches } from "@/lib/intent";
import { hourlyCost, formatCostLabels } from "@/lib/format";
import { DEMO_OFFERS } from "@/lib/demo-data";
import type { PlannedOffer } from "@/lib/types";

export function buildDemoPlan(prompt: string) {
  const intent = parseIntent(prompt);
  const hardware = DEMO_OFFERS.filter((offer) => offer.vCpu >= intent.minVcpu && offer.ramGb >= intent.minRamGb && offer.volumeGb >= intent.minVolumeGb);
  const regional = hardware.filter((offer) => regionMatches(offer, intent));
  const priced = regional.filter((offer) => {
    if (intent.maxPricePerHour === undefined) return true;
    if (offer.cost?.currency !== intent.currency) return false;
    const hourly = hourlyCost(offer.cost);
    return typeof hourly === "number" && hourly <= intent.maxPricePerHour!;
  });
  const matches = (intent.regionQuery || intent.continentQuery) ? (regional.length ? regional : []) : hardware;
  const finalMatches = intent.maxPricePerHour !== undefined ? priced : matches;
  const offers = [...finalMatches]
    .sort((a, b) => (hourlyCost(a.cost) ?? Number.POSITIVE_INFINITY) - (hourlyCost(b.cost) ?? Number.POSITIVE_INFINITY))
    .slice(0, 12)
    .map((offer) => {
      const labels = formatCostLabels(offer.cost);
      return { ...offer, planToken: createPlanToken({ mode: "demo", intent, offer }), ...labels } satisfies PlannedOffer;
    });

  return {
    mode: "demo" as const,
    intent,
    offers,
    matchCount: finalMatches.length,
    catalogCount: DEMO_OFFERS.length,
    note: "Sample catalog for preview only. No cloud API is contacted and no infrastructure is created.",
  };
}
