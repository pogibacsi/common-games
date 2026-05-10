import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import type { FriendsResponse, RecommendationsResponse } from "../shared/types.js";
import {
  authOriginFromEnvOrRequest,
  clearOAuthStateCookie,
  clearSessionCookie,
  createOAuthStateCookie,
  createSessionCookie,
  getSessionUser,
  isSafeClientOrigin,
  parseSteamClaimedId,
  requireSession,
  verifyOAuthState
} from "./auth.js";
import { compareSteamLibraries, fetchRecommendations, fetchSteamAuthUser, fetchSteamFriends, parseCompareBody } from "./steam.js";

const app = express();
const port = Number(process.env.PORT ?? 5174);
const apiKey = process.env.STEAM_API_KEY?.trim();
const configuredClientOrigin = process.env.APP_CLIENT_ORIGIN?.trim();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionSecret = process.env.SESSION_SECRET?.trim() || loadDevSessionSecret();

if (!process.env.SESSION_SECRET?.trim()) {
  console.warn("SESSION_SECRET is missing. Using a persistent local dev secret from .data/session-secret.");
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1");

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "interest-cohort=()");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https://*.steamstatic.com https://*.akamaihd.net https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com https://cdn.cloudflare.steamstatic.com https://steamcdn-a.akamaihd.net",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://steamcommunity.com"
    ].join("; ")
  );
  next();
});

const rateBuckets = new Map<string, { resetAt: number; count: number }>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { resetAt: now + windowMs, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 60_000).unref();

function clientIp(request: express.Request): string {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, hasApiKey: Boolean(apiKey) });
});

app.get("/api/auth/steam/start", (request, response) => {
  if (!rateLimit(`auth-start:${clientIp(request)}`, 20, 60_000)) {
    response.status(429).json({ error: "Too many login attempts. Please wait a moment." });
    return;
  }
  let authOrigin: string;
  try {
    authOrigin = authOriginFromEnvOrRequest(request, port);
  } catch {
    response.status(500).json({ error: "Server is missing STEAM_AUTH_ORIGIN configuration." });
    return;
  }
  const clientOrigin = safeClientOrigin(queryValue(request.query.client_origin));
  const isSecure = new URL(authOrigin).protocol === "https:";
  const { cookie: stateCookie, state } = createOAuthStateCookie(isSecure);

  const returnTo = new URL("/api/auth/steam/callback", authOrigin);
  returnTo.searchParams.set("client_origin", clientOrigin);
  returnTo.searchParams.set("state", state);

  const steamLoginUrl = new URL("https://steamcommunity.com/openid/login");
  steamLoginUrl.search = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo.toString(),
    "openid.realm": authOrigin,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
  }).toString();

  response.setHeader("Set-Cookie", stateCookie);
  response.redirect(steamLoginUrl.toString());
});

app.get("/api/auth/steam/callback", async (request, response) => {
  const clientOrigin = safeClientOrigin(queryValue(request.query.client_origin));
  if (!apiKey) {
    response.setHeader("Set-Cookie", clearOAuthStateCookie());
    response.redirect(authRedirectUrl(clientOrigin, "missing_api_key"));
    return;
  }

  try {
    if (!verifyOAuthState(request, queryValue(request.query.state))) {
      throw new Error("OAuth state mismatch.");
    }
    if (queryValue(request.query["openid.mode"]) !== "id_res") {
      throw new Error("Steam login was cancelled or did not complete.");
    }
    const valid = await verifySteamOpenId(request.query);
    if (!valid) {
      throw new Error("Steam login could not be verified.");
    }
    const steamId = parseSteamClaimedId(queryValue(request.query["openid.claimed_id"]));
    const user = await fetchSteamAuthUser(steamId, apiKey);
    const isSecureClient = new URL(clientOrigin).protocol === "https:";
    response.setHeader("Set-Cookie", [
      clearOAuthStateCookie(),
      createSessionCookie(user, sessionSecret, isSecureClient)
    ]);
    response.redirect(authRedirectUrl(clientOrigin, "success"));
  } catch {
    response.setHeader("Set-Cookie", clearOAuthStateCookie());
    response.redirect(authRedirectUrl(clientOrigin, "failed"));
  }
});

app.get("/api/auth/me", (request, response) => {
  response.json({ user: getSessionUser(request, sessionSecret) });
});

app.post("/api/auth/logout", (_request, response) => {
  response.setHeader("Set-Cookie", clearSessionCookie());
  response.json({ ok: true });
});

app.get("/api/friends", async (request, response) => {
  if (!apiKey) {
    response.status(500).json({ error: "Missing STEAM_API_KEY. Add it to .env and restart the app." });
    return;
  }

  const user = requireSession(request, response, sessionSecret);
  if (!user) return;

  if (!rateLimit(`friends:${user.steamId}`, 30, 60_000)) {
    response.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
    return;
  }

  try {
    const friends = await fetchSteamFriends(user.steamId, apiKey);
    response.json({ friends } satisfies FriendsResponse);
  } catch {
    response.json({
      friends: [],
      warning: "Could not load Steam friends. Manual Steam ID/profile entry still works."
    } satisfies FriendsResponse);
  }
});

app.get("/api/recommendations", async (request, response) => {
  if (!rateLimit(`recommendations:${clientIp(request)}`, 60, 60_000)) {
    response.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
    return;
  }

  try {
    const recommendations = await fetchRecommendations();
    response.json({ recommendations } satisfies RecommendationsResponse);
  } catch {
    response.status(500).json({ error: "Could not load recommendations." });
  }
});

app.post("/api/compare", async (request, response) => {
  if (!apiKey) {
    response.status(500).json({ error: "Missing STEAM_API_KEY. Add it to .env and restart the app." });
    return;
  }

  if (!rateLimit(`compare:${clientIp(request)}`, 10, 60_000)) {
    response.status(429).json({ error: "Too many compare requests. Please wait a moment and try again." });
    return;
  }

  try {
    const profiles = parseCompareBody(request.body);
    const result = await compareSteamLibraries(profiles, apiKey);
    response.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    const message = error instanceof Error ? error.message : "Steam comparison failed.";
    response.status(400).json({ error: message });
  }
});

if (!process.env.VERCEL) {
  const staticDir = path.resolve(__dirname, "../dist");
  app.use(express.static(staticDir));
  app.use((_request, response) => {
    response.sendFile(path.join(staticDir, "index.html"));
  });

  app.listen(port, "127.0.0.1", () => {
    console.log(`Steam Common Games API listening on http://127.0.0.1:${port}`);
  });
}

export default app;

function safeClientOrigin(candidate: string): string {
  if (candidate && isSafeClientOrigin(candidate, configuredClientOrigin)) {
    return new URL(candidate).origin;
  }
  if (configuredClientOrigin) return new URL(configuredClientOrigin).origin;
  return "http://127.0.0.1:5173";
}

function authRedirectUrl(clientOrigin: string, status: "success" | "failed" | "missing_api_key"): string {
  const url = new URL(clientOrigin);
  url.searchParams.set("steam_login", status);
  return url.toString();
}

async function verifySteamOpenId(query: Record<string, unknown>): Promise<boolean> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
  }
  params.set("openid.mode", "check_authentication");

  const response = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  if (!response.ok) return false;
  const body = await response.text();
  return /^is_valid:true$/m.test(body);
}

function queryValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function loadDevSessionSecret(): string {
  const dataDir = path.resolve(__dirname, "../.data");
  const secretPath = path.join(dataDir, "session-secret");
  try {
    return fs.readFileSync(secretPath, "utf8").trim();
  } catch {
    const secret = crypto.randomBytes(32).toString("base64url");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
    return secret;
  }
}
