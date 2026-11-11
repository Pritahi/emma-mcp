import { describe, expect, it } from "vitest";
import { createPlanToken, createSpotOfferToken, verifyPlanToken, verifySpotOfferToken } from "@/lib/crypto";
import { parseIntent } from "@/lib/intent";
import { DEMO_OFFERS, DEMO_SPOT_OFFERS } from "@/lib/demo-data";

describe("signed plans", () => {
  const makeToken = () => createPlanToken({ mode: "demo", intent: parseIntent("2 vCPU 8 GB RAM in Germany"), offer: DEMO_OFFERS[0] }, 10_000);

  it("round-trips a plan and enforces expiry", () => {
    const token = makeToken();
    const plan = verifyPlanToken(token, 10_001);
    expect(plan.mode).toBe("demo");
    expect(plan.offer.id).toBe(DEMO_OFFERS[0].id);
    expect(() => verifyPlanToken(token, plan.expiresAt)).toThrow(/expired/i);
  });

  it("rejects tampering", () => {
    const token = makeToken();
    const [body, signature] = token.split(".");
    const changed = `${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}.${signature}`;
    expect(() => verifyPlanToken(changed, 10_001)).toThrow(/signature/i);
  });
});

describe("signed spot offer tokens", () => {
  const makeToken = () => createSpotOfferToken({
    mode: "demo",
    filters: { minVcpu: 4, maxPricePerHour: 0.05, currency: "USD" },
    offer: DEMO_SPOT_OFFERS[0],
  }, 10_000);

  it("round-trips the exact offer and enforces the three-minute expiry", () => {
    const token = makeToken();
    const signed = verifySpotOfferToken(token, 10_001);
    expect(signed.mode).toBe("demo");
    expect(signed.offer.id).toBe(DEMO_SPOT_OFFERS[0].id);
    expect(signed.filters.maxPricePerHour).toBe(0.05);
    expect(() => verifySpotOfferToken(token, signed.expiresAt)).toThrow(/expired/i);
  });

  it("rejects an edited offer token", () => {
    const token = makeToken();
    const [body, signature] = token.split(".");
    const changed = `${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}.${signature}`;
    expect(() => verifySpotOfferToken(changed, 10_001)).toThrow(/signature/i);
  });
});
