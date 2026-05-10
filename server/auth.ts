import crypto from "node:crypto";
import type { Request, Response } from "express";
import type { SteamAuthUser } from "../shared/types.js";

const SESSION_COOKIE = "scg_session";
const OAUTH_STATE_COOKIE = "scg_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
const STEAM_CLAIMED_ID_RE = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})\/?$/;

export function parseSteamClaimedId(claimedId: string): string {
  const match = claimedId.match(STEAM_CLAIMED_ID_RE);
  if (!match) {
    throw new Error("Steam login response did not include a valid SteamID.");
  }
  return match[1];
}

export function createSessionCookie(user: SteamAuthUser, secret: string, secure: boolean): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = encodeBase64Url(JSON.stringify({ ...user, expiresAt }));
  const signature = sign(payload, secret);
  const attributes = [
    `${SESSION_COOKIE}=${payload}.${signature}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getSessionUser(request: Request, secret: string): SteamAuthUser | null {
  const cookie = parseCookieHeader(request.headers.cookie ?? "")[SESSION_COOKIE];
  if (!cookie) return null;
  return verifySessionValue(cookie, secret);
}

export function verifySessionValue(value: string, secret: string): SteamAuthUser | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !timingSafeEqual(signature, sign(payload, secret))) {
    return null;
  }

  try {
    const decoded = JSON.parse(decodeBase64Url(payload)) as SteamAuthUser & { expiresAt?: unknown };
    if (typeof decoded.expiresAt !== "number" || decoded.expiresAt <= Date.now()) return null;
    if (!/^\d{17}$/.test(decoded.steamId) || typeof decoded.displayName !== "string") return null;
    return {
      steamId: decoded.steamId,
      displayName: decoded.displayName,
      profileUrl: typeof decoded.profileUrl === "string" ? decoded.profileUrl : `https://steamcommunity.com/profiles/${decoded.steamId}`,
      avatarUrl: typeof decoded.avatarUrl === "string" ? decoded.avatarUrl : ""
    };
  } catch {
    return null;
  }
}

export function requireSession(request: Request, response: Response, secret: string): SteamAuthUser | null {
  const user = getSessionUser(request, secret);
  if (!user) {
    response.status(401).json({ error: "Sign in through Steam first." });
    return null;
  }
  return user;
}

export function isSafeClientOrigin(origin: string, configuredOrigin?: string): boolean {
  try {
    const url = new URL(origin);
    if (configuredOrigin) return url.origin === new URL(configuredOrigin).origin;
    return isLocalHostname(url.hostname) && /^https?:$/.test(url.protocol);
  } catch {
    return false;
  }
}

export function authOriginFromEnvOrRequest(request: Request, fallbackPort: number): string {
  const configured = process.env.STEAM_AUTH_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;

  const host = request.get("host") || `127.0.0.1:${fallbackPort}`;
  const hostname = host.split(":")[0];
  if (!isLocalHostname(hostname)) {
    throw new Error("STEAM_AUTH_ORIGIN must be configured for non-localhost deployments.");
  }

  const protocol = request.secure ? "https" : "http";
  return `${protocol}://${host}`;
}

export function createOAuthStateCookie(secure: boolean): { cookie: string; state: string } {
  const state = crypto.randomBytes(32).toString("base64url");
  const attributes = [
    `${OAUTH_STATE_COOKIE}=${state}`,
    "Path=/api/auth/steam",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}`
  ];
  if (secure) attributes.push("Secure");
  return { cookie: attributes.join("; "), state };
}

export function clearOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/api/auth/steam; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function verifyOAuthState(request: Request, candidate: string): boolean {
  if (!candidate) return false;
  const cookieValue = parseCookieHeader(request.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
  if (!cookieValue) return false;
  return timingSafeEqual(cookieValue, candidate);
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function parseCookieHeader(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      continue;
    }
  }
  return cookies;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
