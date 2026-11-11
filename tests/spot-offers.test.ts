import { describe, expect, it } from "vitest";
import { DEMO_SPOT_OFFERS } from "@/lib/demo-data";
import { filterAndRankSpotOffers, isLinuxSpotOffer, normalizeSpotConfiguration } from "@/lib/spot-offers";
import type { SpotOffer } from "@/lib/types";

describe("spot offer normalization", () => {
  it("normalizes provider, location, GPU, Linux OS and monthly cost to an hourly rate", () => {
    const offer = normalizeSpotConfiguration({
      id: "cfg-gpu-01",
      provider: { id: 17, name: "Example Cloud" },
      locationId: 31,
      dataCenterId: "fra-1",
      dataCenterName: "Frankfurt 1",
      os: { id: 12, family: "Linux", type: "Ubuntu", version: "24.04" },
      vCpuType: "standard",
      vCpu: 8,
      ramGb: 32,
      volumeGb: 200,
      volumeType: "ssd",
      cloudNetworkTypes: ["isolated", "multi-cloud"],
      accelerator: {
        acceleratorTypeId: "gpu-t4-id",
        acceleratorType: "NVIDIA T4",
        accelerators: 1,
        totalGpuMemoryGb: 16,
      },
      cost: { unit: "MONTHS", currency: "EUR", price: 73 },
    }, new Map([[31, { id: 31, name: "Frankfurt", country: "Germany", continent: "Europe" }]]));

    expect(offer).toMatchObject({
      id: "cfg-gpu-01",
      providerName: "Example Cloud",
      locationName: "Frankfurt",
      country: "Germany",
      continent: "Europe",
      dataCenterId: "fra-1",
      osId: 12,
      osType: "Ubuntu",
      osVersion: "24.04",
      vCpu: 8,
      ramGb: 32,
      gpuType: "NVIDIA T4",
      gpuCount: 1,
      acceleratorTypeId: "gpu-t4-id",
      pricePerHour: 0.1,
      currency: "EUR",
      source: "live",
    });
    expect(offer?.cost.perHour).toBe(0.1);
    expect(isLinuxSpotOffer(offer!)).toBe(true);
  });

  it("rejects a configuration whose billing unit cannot be safely converted to hourly", () => {
    const offer = normalizeSpotConfiguration({
      id: "unknown-unit",
      dataCenterId: "dc-1",
      osId: 1,
      osType: "Ubuntu",
      vCpu: 2,
      ramGb: 4,
      volumeGb: 40,
      cloudNetworkTypes: ["isolated"],
      cost: { unit: "per-request", currency: "USD", price: 1 },
    });
    expect(offer).toBeUndefined();
  });
});

describe("spot offer filters and ranking", () => {
  it("filters by minimum resources, GPU, region, currency and budget, then ranks by price", () => {
    const offers = [
      ...DEMO_SPOT_OFFERS,
      { ...DEMO_SPOT_OFFERS[0], id: "demo-windows", osType: "Windows Server 2025" } as SpotOffer,
    ];
    const matches = filterAndRankSpotOffers(offers, {
      minVcpu: 8,
      minRamGb: 16,
      minGpuCount: 1,
      gpuType: "t4",
      region: "Germany",
      maxPricePerHour: 0.25,
      currency: "USD",
    });
    expect(matches.map((offer) => offer.id)).toEqual(["demo-spot-gcp-fra-t4-8-32"]);
  });

  it("keeps currencies separate if no comparison currency is supplied", () => {
    const eurOffer = { ...DEMO_SPOT_OFFERS[0], id: "eur", currency: "EUR", pricePerHour: 0.01 };
    const usdOffer = { ...DEMO_SPOT_OFFERS[0], id: "usd", currency: "USD", pricePerHour: 0.02 };
    const ranked = filterAndRankSpotOffers([usdOffer, eurOffer], {});
    expect(ranked.map((offer) => offer.id)).toEqual(["eur", "usd"]);
  });
});
