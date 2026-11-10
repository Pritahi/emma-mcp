import { afterEach, describe, expect, it } from "vitest";
import { ACCESS_COOKIE_NAME, createAccessSession, getAccessState } from "@/lib/access";

const tracked = ["EMMA_CLIENT_ID", "EMMA_CLIENT_SECRET", "EMMA_TOKEN", "EMMA_ACCESS_TOKEN", "APP_PASSWORD", "APP_SESSION_SECRET", "PLAN_SIGNING_SECRET"] as const;
const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of tracked) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("live launch access gate", () => {
  it("locks live credentials until a signed session cookie is present", () => {
    process.env.EMMA_CLIENT_ID = "test-client";
    process.env.EMMA_CLIENT_SECRET = "test-secret";
    process.env.APP_PASSWORD = "correct-horse-battery-staple";
    process.env.APP_SESSION_SECRET = "a-long-random-session-secret";

    expect(getAccessState(new Request("https://example.test"))).toMatchObject({ required: true, authorized: false, configured: true });
    const session = createAccessSession();
    const request = new Request("https://example.test", { headers: { cookie: `${ACCESS_COOKIE_NAME}=${session.value}` } });
    expect(getAccessState(request)).toMatchObject({ required: true, authorized: true, configured: true });
  });

  it("fails closed when live credentials have no launch password", () => {
    process.env.EMMA_CLIENT_ID = "test-client";
    process.env.EMMA_CLIENT_SECRET = "test-secret";
    delete process.env.APP_PASSWORD;
    expect(getAccessState(new Request("https://example.test"))).toMatchObject({ required: true, authorized: false, configured: false });
  });
});
