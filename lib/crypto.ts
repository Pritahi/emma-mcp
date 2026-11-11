import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignedPlan, SpotOffer, SpotSearchFilters, SourceMode } from "@/lib/types";

const DEV_SECRET = "emma-mcp-local-demo-signing-secret-change-before-production";
const PLAN_TTL_MS = 3 * 60 * 1000;

function secret(): string {
  const configured = process.env.PLAN_SIGNING_SECRET || process.env.EMMA_CLIENT_SECRET || process.env.EMMA_TOKEN || process.env.EMMA_ACCESS_TOKEN;
  // A public demo key is safe only for preview plans: live plans require emma credentials,
  // which become the signing fallback. Set PLAN_SIGNING_SECRET in real deployments.
  return configured || DEV_SECRET;
}

function signBody(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function createPlanToken(plan: Omit<SignedPlan, "version" | "expiresAt">, now = Date.now()): string {
  const payload: SignedPlan = { ...plan, version: 1, expiresAt: now + PLAN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signBody(body)}`;
}

export function verifyPlanToken(token: string, now = Date.now()): SignedPlan {
  const [body, supplied, ...extra] = token.split(".");
  if (!body || !supplied || extra.length) throw new Error("Invalid plan token.");
  const expected = signBody(body);
  const actualBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Plan signature is invalid. Run the search again.");
  }
  let plan: SignedPlan;
  try {
    plan = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedPlan;
  } catch {
    throw new Error("Plan payload is malformed.");
  }
  if (plan.version !== 1 || !plan.offer || !plan.intent || !["live", "demo"].includes(plan.mode)) {
    throw new Error("Plan payload is not recognized.");
  }
  if (typeof plan.expiresAt !== "number" || plan.expiresAt <= now) throw new Error("This plan expired. Search again to refresh current pricing.");
  return plan;
}

export interface SignedSpotOffer {
  version: 1;
  kind: "spot-offer";
  mode: SourceMode;
  expiresAt: number;
  filters: SpotSearchFilters;
  offer: SpotOffer;
}

export function createSpotOfferToken(input: {
  mode: SourceMode;
  filters: SpotSearchFilters;
  offer: SpotOffer;
}, now = Date.now()): string {
  const payload: SignedSpotOffer = {
    ...input,
    kind: "spot-offer",
    version: 1,
    expiresAt: now + PLAN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signBody(body)}`;
}

export function verifySpotOfferToken(token: string, now = Date.now()): SignedSpotOffer {
  const [body, supplied, ...extra] = token.split(".");
  if (!body || !supplied || extra.length) throw new Error("Invalid spot offer token. Run search_spot_offers again.");
  const expected = signBody(body);
  const actualBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Spot offer signature is invalid. Run search_spot_offers again.");
  }

  let plan: SignedSpotOffer;
  try {
    plan = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedSpotOffer;
  } catch {
    throw new Error("Spot offer payload is malformed.");
  }
  if (plan.version !== 1 || plan.kind !== "spot-offer" || !plan.offer || !plan.filters || !["live", "demo"].includes(plan.mode)) {
    throw new Error("Spot offer payload is not recognized.");
  }
  if (plan.offer.source !== plan.mode || !plan.offer.id || !Number.isFinite(plan.offer.pricePerHour)) {
    throw new Error("Spot offer payload is incomplete or has the wrong source mode.");
  }
  if (typeof plan.expiresAt !== "number" || plan.expiresAt <= now) {
    throw new Error("This spot offer expired. Run search_spot_offers again to refresh availability and price.");
  }
  return plan;
}
