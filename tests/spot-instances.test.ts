import { describe, expect, it } from "vitest";
import { DEMO_SPOT_OFFERS } from "@/lib/demo-data";
import { buildSpotCreateBody, getSpotResourceId, normalizeSpotInstance } from "@/lib/spot-instances";
import type { SpotOffer } from "@/lib/types";

const liveOffer = (overrides: Partial<SpotOffer> = {}): SpotOffer => ({
  ...DEMO_SPOT_OFFERS[0],
  source: "live",
  ...overrides,
});

describe("spot create request", () => {
  it("creates the exact Linux configuration with the chosen SSH key, price, network and bootstrap script", () => {
    const body = buildSpotCreateBody({
      offer: liveOffer(),
      name: "  Benchmark: US-East  ",
      sshKeyId: 42,
      pricePerHour: 0.025,
      initScript: "#!/bin/bash\necho ready",
    });
    expect(body).toEqual({
      name: "benchmark-us-east",
      dataCenterId: "fsn1",
      osId: 1,
      cloudNetworkType: "isolated",
      vCpuType: "shared",
      vCpu: 4,
      ramGb: 16,
      volumeType: "ssd",
      volumeGb: 80,
      sshKeyId: 42,
      price: 0.025,
      initScript: "#!/bin/bash\necho ready",
    });
  });

  it("includes accelerator fields exactly for a GPU configuration", () => {
    const gpuOffer = DEMO_SPOT_OFFERS.find((offer) => offer.gpuType?.includes("T4"))!;
    const body = buildSpotCreateBody({
      offer: { ...gpuOffer, source: "live" },
      name: "gpu-test",
      sshKeyId: 7,
      pricePerHour: gpuOffer.pricePerHour,
      initScript: "#!/bin/bash\ntrue",
    });
    expect(body).toMatchObject({ acceleratorTypeId: gpuOffer.acceleratorTypeId, accelerators: 1 });
  });

  it("rejects Windows and non-live offers before making a cloud request", () => {
    expect(() => buildSpotCreateBody({
      offer: liveOffer({ osType: "Windows Server 2025" }),
      name: "windows",
      sshKeyId: 1,
      pricePerHour: 0.03,
      initScript: "#!/bin/bash\ntrue",
    })).toThrow(/only Linux/i);
    expect(() => buildSpotCreateBody({
      offer: DEMO_SPOT_OFFERS[0],
      name: "demo",
      sshKeyId: 1,
      pricePerHour: 0.03,
      initScript: "#!/bin/bash\ntrue",
    })).toThrow(/Only live offers/i);
  });
});

describe("spot instance normalization", () => {
  it("extracts public/private IPs, status, SSH user and a ready SSH command", () => {
    const status = normalizeSpotInstance({
      data: {
        id: 1234,
        name: "spot-test",
        status: "POWERED_ON",
        provider: { name: "Example Cloud" },
        location: { name: "Frankfurt", country: "Germany" },
        os: { type: "Ubuntu", version: "24.04" },
        userName: "ubuntu",
        vCpu: 8,
        ramGb: 32,
        networks: [
          { ip: "8.8.8.8", networkType: "PUBLIC" },
          { ip: "10.1.2.3", networkType: "PRIVATE" },
        ],
      },
    });
    expect(status).toMatchObject({
      id: "1234",
      status: "POWERED_ON",
      mode: "live",
      provider: "Example Cloud",
      location: "Frankfurt, Germany",
      os: "Ubuntu",
      vCpu: 8,
      ramGb: 32,
      publicIpAddresses: ["8.8.8.8"],
      privateIpAddresses: ["10.1.2.3"],
      sshUser: "ubuntu",
      sshReady: true,
      sshCommand: "ssh -p 22 ubuntu@8.8.8.8",
    });
  });

  it("does not treat a private or documentation-range address as an SSH target", () => {
    const status = normalizeSpotInstance({
      id: 456,
      status: "POWERED_ON",
      os: { type: "Ubuntu" },
      networks: [{ ip: "10.0.0.15", networkType: "PUBLIC" }],
    });
    expect(status.publicIpAddresses).toEqual([]);
    expect(status.privateIpAddresses).toEqual(["10.0.0.15"]);
    expect(status.sshReady).toBe(false);
    expect(status.sshCommand).toBeUndefined();
  });

  it("extracts an ID from a wrapped create response", () => {
    expect(getSpotResourceId({ data: { spotInstance: { id: 987 } } })).toBe("987");
    expect(getSpotResourceId({ data: {} })).toBeUndefined();
  });
});
