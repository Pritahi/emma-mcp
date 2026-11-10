import { describe, expect, it } from "vitest";
import { createPlanToken, verifyPlanToken } from "@/lib/crypto";
import { parseIntent } from "@/lib/intent";
import { DEMO_OFFERS } from "@/lib/demo-data";

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
