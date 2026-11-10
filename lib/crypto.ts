import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignedPlan } from "@/lib/types";

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
