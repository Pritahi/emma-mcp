import { createHmac, timingSafeEqual } from "node:crypto";
import { hasEmmaCredentials } from "@/lib/status";

const COOKIE_NAME = "emma_launch_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

type AccessState = {
  required: boolean;
  authorized: boolean;
  configured: boolean;
  message: string;
};

function sessionSecret(): string {
  return process.env.APP_SESSION_SECRET || process.env.APP_PASSWORD || process.env.PLAN_SIGNING_SECRET || "";
}

function hmac(value: string): string {
  const key = sessionSecret();
  if (!key) return "";
  return createHmac("sha256", key).update(value).digest("base64url");
}

function cookieValue(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  const entry = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!entry) return undefined;
  return decodeURIComponent(entry.slice(COOKIE_NAME.length + 1));
}

function isValidSession(token: string | undefined): boolean {
  if (!token || !sessionSecret()) return false;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length) return false;
  const expected = hmac(payload);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (!expected || actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof session.exp === "number" && session.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export function getAccessState(request: Request): AccessState {
  if (!hasEmmaCredentials()) {
    return { required: false, authorized: true, configured: true, message: "Preview mode is open; it has no live cloud credentials." };
  }
  if (!process.env.APP_PASSWORD) {
    return { required: true, authorized: false, configured: false, message: "Live cloud credentials are present, but the app is locked until APP_PASSWORD is set on the server." };
  }
  const authorized = isValidSession(cookieValue(request));
  return {
    required: true,
    authorized,
    configured: true,
    message: authorized ? "Live launch access granted." : "Enter the launch password configured by the workspace owner.",
  };
}

export function authorizePassword(value: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(value);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function createAccessSession(): { value: string; maxAge: number } {
  if (!process.env.APP_PASSWORD || !sessionSecret()) throw new Error("APP_PASSWORD and APP_SESSION_SECRET must be configured.");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString("base64url");
  return { value: `${payload}.${hmac(payload)}`, maxAge: SESSION_TTL_SECONDS };
}

export const ACCESS_COOKIE_NAME = COOKIE_NAME;
