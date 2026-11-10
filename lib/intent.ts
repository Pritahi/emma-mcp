import type { ComputeIntent } from "@/lib/types";

const COUNTRY_ALIASES: Record<string, string[]> = {
  germany: ["germany", "frankfurt", "berlin", "munich", "muenchen", "hamburg", "dusseldorf", "düsseldorf", "nuremberg", "nürnberg", "de-"],
  france: ["france", "paris", "marseille", "lyon", "strasbourg", "fr-"],
  netherlands: ["netherlands", "amsterdam", "rotterdam", "nl-"],
  ireland: ["ireland", "dublin", "ie-"],
  sweden: ["sweden", "stockholm", "se-"],
  finland: ["finland", "helsinki", "fi-"],
  poland: ["poland", "warsaw", "krakow", "pl-"],
  "united kingdom": ["united kingdom", "uk", "london", "manchester", "gb-"],
  usa: ["united states", "usa", "us", "virginia", "ashburn", "oregon", "california", "new york", "us-"],
  canada: ["canada", "montreal", "toronto", "quebec", "ca-"],
  japan: ["japan", "tokyo", "osaka", "jp-"],
  singapore: ["singapore", "sg-"],
  australia: ["australia", "sydney", "melbourne", "au-"],
};

const CONTINENTS: Record<string, string> = {
  europe: "Europe",
  eu: "Europe",
  european: "Europe",
  asia: "Asia",
  apac: "Asia",
  "north america": "North America",
  "south america": "South America",
  africa: "Africa",
  oceania: "Oceania",
};

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "emma-dev-box";
}

function parseRegion(prompt: string): { regionQuery?: string; continentQuery?: string } {
  const match = prompt.match(/\b(?:in|near|around|within)\s+(?:the\s+)?([a-z][a-z\s-]{1,32}?)(?=\s+(?:under|below|at\s+most|with|using|and\s+at\s+least|at\s+least|for|on|with\s+at\s+least)\b|[,.;]|$)/i);
  if (!match) return {};
  const query = match[1].trim().replace(/\s+/g, " ").replace(/\b(?:a|an|the)\b/gi, "").trim();
  const normalized = query.toLowerCase();
  if (CONTINENTS[normalized]) return { continentQuery: CONTINENTS[normalized] };
  return query ? { regionQuery: query } : {};
}

function parsePrice(prompt: string): { maxPricePerHour?: number; currency: string } {
  const currency = /€|\beur\b|\beuros?\b/i.test(prompt) ? "EUR" : /£|\bgbp\b|\bpounds?\b/i.test(prompt) ? "GBP" : "USD";
  const match = prompt.match(/\b(?:under|below|less\s+than|no\s+more\s+than|at\s+most|<=)\s*[$€£]?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(?:h|hr|hour)|per\s+hour|hourly)?\b/i);
  if (!match) return { currency };
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return { currency };
  const unitMatch = prompt.match(new RegExp(`${match[1].replace(".", "\\.")}\\s*(?:\\/\\s*(h|hr|hour|day|month|mo)|per\\s+(hour|day|month)|hourly)`, "i"));
  const unit = unitMatch?.[1]?.toLowerCase() ?? unitMatch?.[2]?.toLowerCase();
  const factor = unit === "day" ? 24 : unit === "month" || unit === "mo" ? 730 : 1;
  return { maxPricePerHour: amount / factor, currency };
}

function parseMinimum(prompt: string, kind: "cpu" | "ram" | "volume", fallback: number): number {
  const cpuMatch = prompt.match(/\b(\d+)\s*(?:-\s*)?(?:v?cpu(?:s)?|cores?|core)\b/i);
  if (kind === "cpu" && cpuMatch) return Math.max(1, Math.min(256, Number(cpuMatch[1])));

  const unit = kind === "ram" ? "(?:gb|gib|g)\\s*(?:of\\s*)?(?:ram|memory)" : "(?:gb|gib|g)\\s*(?:of\\s*)?(?:disk|storage|volume)";
  const explicit = prompt.match(new RegExp(`(?:at\\s+least\\s+)?(\\d+)\\s*${unit}`, "i"));
  if (explicit) return Math.max(kind === "ram" ? 1 : 10, Math.min(32768, Number(explicit[1])));

  if (kind === "ram") {
    const genericGb = prompt.match(/\b(\d+)\s*(?:gb|gib)\b/i);
    if (genericGb) return Math.max(1, Math.min(32768, Number(genericGb[1])));
  }
  return fallback;
}

function parseName(prompt: string): string {
  const explicit = prompt.match(/\b(?:name|call\s+it|named)\s+["']?([a-z0-9][a-z0-9 _-]{1,40})/i)?.[1];
  if (explicit) return toSlug(explicit.trim().replace(/["'].*$/, ""));
  const lower = prompt.toLowerCase();
  if (lower.includes("python")) return "python-dev-box";
  if (/\b(?:gpu|cuda|machine learning|ml)\b/.test(lower)) return "gpu-worker";
  if (/\b(?:database|postgres|mysql)\b/.test(lower)) return "data-node";
  if (/\b(?:web|site|api|server)\b/.test(lower)) return "web-node";
  return "emma-dev-box";
}

export function parseIntent(promptText: string): ComputeIntent {
  const prompt = promptText.trim().replace(/\s+/g, " ").slice(0, 500);
  const region = parseRegion(prompt);
  const price = parsePrice(prompt);
  const minVcpu = parseMinimum(prompt, "cpu", /\b(?:dev\s+box|developer|python)\b/i.test(prompt) ? 2 : 2);
  const minRamGb = parseMinimum(prompt, "ram", /\b(?:dev\s+box|developer|python)\b/i.test(prompt) ? 8 : 8);
  const minVolumeGb = parseMinimum(prompt, "volume", 50);

  return {
    prompt,
    name: parseName(prompt),
    minVcpu,
    minRamGb,
    minVolumeGb,
    osQuery: /\b(?:debian|ubuntu|fedora|rocky|almalinux)\b/i.exec(prompt)?.[0] ?? "Ubuntu",
    ...region,
    ...price,
  };
}

export function regionMatches(
  offer: { locationName: string; dataCenterName: string; region?: string; continent?: string },
  intent: ComputeIntent,
): boolean {
  if (intent.continentQuery) {
    return (offer.continent ?? "").toLowerCase().includes(intent.continentQuery.toLowerCase());
  }
  if (!intent.regionQuery) return true;
  const query = intent.regionQuery.toLowerCase().trim();
  const text = `${offer.locationName} ${offer.dataCenterName} ${offer.region ?? ""} ${offer.continent ?? ""}`.toLowerCase();
  if (text.includes(query)) return true;
  const aliases = COUNTRY_ALIASES[query];
  if (aliases) return aliases.some((alias) => text.includes(alias));
  return false;
}
