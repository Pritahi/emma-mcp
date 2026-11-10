import type { OfferCost } from "@/lib/types";

export function money(value: number, currency = "USD", digits = 3): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function hourlyCost(cost?: OfferCost): number | undefined {
  if (!cost || !Number.isFinite(cost.amount)) return undefined;
  if (typeof cost.perHour === "number" && Number.isFinite(cost.perHour)) return cost.perHour;
  const unit = cost.unit.toLowerCase();
  if (/hour|hr|hourly|^h$/.test(unit)) return cost.amount;
  if (/day|daily|^d$/.test(unit)) return cost.amount / 24;
  if (/week|weekly|^w$/.test(unit)) return cost.amount / 168;
  if (/month|monthly|^mo$/.test(unit)) return cost.amount / 730;
  if (/year|annual|annually|^yr$/.test(unit)) return cost.amount / 8760;
  return undefined;
}

export function formatCostLabels(cost?: OfferCost): { hourlyLabel: string; monthlyLabel: string } {
  if (!cost) return { hourlyLabel: "Price not reported", monthlyLabel: "—" };
  const currency = cost.currency || "USD";
  const perHour = hourlyCost(cost);
  if (typeof perHour === "number") {
    const perMonth = perHour * 730;
    return {
      hourlyLabel: `${money(perHour, currency, 4)}/hr`,
      monthlyLabel: `${money(perMonth, currency, 2)}/mo est.`,
    };
  }
  return {
    hourlyLabel: `${money(cost.amount, currency, 3)}/${cost.unit || "unit"}`,
    monthlyLabel: "Period unavailable",
  };
}
