import { describe, expect, it } from "vitest";
import { parseIntent, regionMatches } from "@/lib/intent";
import { buildDemoPlan } from "@/lib/demo";
import { DEMO_OFFERS } from "@/lib/demo-data";

describe("prompt intent compiler", () => {
  it("extracts compute, Europe and an hourly USD ceiling", () => {
    const intent = parseIntent("Find a 4-core, 16 GB VM in Europe for under $0.05/hr — Python service");
    expect(intent.minVcpu).toBe(4);
    expect(intent.minRamGb).toBe(16);
    expect(intent.continentQuery).toBe("Europe");
    expect(intent.maxPricePerHour).toBeCloseTo(0.05);
    expect(intent.currency).toBe("USD");
    expect(intent.name).toBe("python-dev-box");
  });

  it("understands the Germany Python dev-box quickstart", () => {
    const intent = parseIntent("Spin up a Python dev box in Germany with at least 8GB RAM");
    expect(intent.minVcpu).toBe(2);
    expect(intent.minRamGb).toBe(8);
    expect(intent.regionQuery).toBe("Germany");
    expect(intent.name).toBe("python-dev-box");
    expect(DEMO_OFFERS.filter((offer) => regionMatches(offer, intent)).every((offer) => offer.continent === "Europe")).toBe(true);
  });

  it("returns clearly marked demo matches without cloud credentials", () => {
    const plan = buildDemoPlan("Find a 4-core, 16 GB VM in Europe for under $0.05/hr");
    expect(plan.mode).toBe("demo");
    expect(plan.offers.length).toBeGreaterThan(0);
    expect(plan.offers.every((offer) => offer.source === "demo")).toBe(true);
    expect(plan.offers.every((offer) => offer.planToken.length > 20)).toBe(true);
    expect(plan.note).toMatch(/no cloud API is contacted/i);
    expect(plan.offers.every((offer) => (offer.cost?.perHour ?? Infinity) <= 0.05)).toBe(true);
  });

  it("does not silently broaden a region", () => {
    const intent = parseIntent("4 cores 16 GB in Japan");
    expect(DEMO_OFFERS.filter((offer) => regionMatches(offer, intent))).toHaveLength(0);
  });
});
