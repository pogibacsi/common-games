import { z } from "zod";
import recommendationsData from "./recommendations.json" with { type: "json" };
import type {
  CompareResult,
  ComparedGame,
  RecommendationGame,
  RecommendationKind,
  SteamAuthUser,
  SteamFriend,
  SteamPriceInfo,
  SteamUserResult
} from "../shared/types.js";

const STEAM_API_BASE = "https://api.steampowered.com";
const STORE_API_BASE = "https://store.steampowered.com/api/appdetails";
const REQUEST_TIMEOUT_MS = 12000;
const MAX_STORE_CHECKS = 400;
const STORE_PRICE_COUNTRY = "de";
const STORE_PRICE_COUNTRY_CODE = "DE";
const RECOMMENDATION_CACHE_TTL_MS = 60 * 60 * 1000;

const RECOMMENDATION_POOL: Array<{ appId: number; name: string; kind: RecommendationKind }> = [
  ...recommendationsData.free.map((entry) => ({ ...entry, kind: "free" as const })),
  ...recommendationsData.paid.map((entry) => ({ ...entry, kind: "paid" as const }))
];


let recommendationCache: { games: RecommendationGame[]; expiresAt: number } | null = null;

const compareRequestSchema = z.object({
  profiles: z
    .array(z.string().trim().min(1).max(400))
    .min(2, "Enter at least two Steam users.")
    .max(12, "Compare up to 12 users at a time.")
});

interface ParsedSteamInput {
  original: string;
  kind: "steamid" | "vanity";
  value: string;
}

interface SteamSummary {
  steamid: string;
  personaname?: string;
  profileurl?: string;
  avatarfull?: string;
}

interface SteamFriendEntry {
  steamid: string;
  relationship?: string;
  friend_since?: number;
}

interface SteamOwnedGame {
  appid: number;
  name?: string;
  playtime_forever?: number;
}

interface SteamStoreDetails {
  name?: string;
  short_description?: string;
  is_free?: boolean;
  price_overview?: {
    currency?: string;
    initial?: number;
    final?: number;
    discount_percent?: number;
    initial_formatted?: string;
    final_formatted?: string;
  };
}

interface LibraryFetchResult {
  baseGames: SteamOwnedGame[];
  withFreeGames: SteamOwnedGame[];
  warning?: string;
}

export function parseCompareBody(body: unknown): string[] {
  const parsed = compareRequestSchema.parse(body);
  const unique = Array.from(new Set(parsed.profiles.map((profile) => profile.trim()).filter(Boolean)));
  if (unique.length < 2) {
    throw new Error("Enter at least two different Steam users.");
  }
  return unique;
}

export function parseSteamInput(input: string): ParsedSteamInput {
  const trimmed = input.trim();
  if (/^\d{17}$/.test(trimmed)) {
    return { original: trimmed, kind: "steamid", value: trimmed };
  }

  const maybeUrl = trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(maybeUrl);
    const host = url.hostname.toLowerCase();
    if (host === "steamcommunity.com" || host === "www.steamcommunity.com") {
      const [type, id] = url.pathname.split("/").filter(Boolean);
      if (type === "profiles" && id && /^\d{17}$/.test(id)) {
        return { original: trimmed, kind: "steamid", value: id };
      }
      if (type === "id" && id && /^[a-zA-Z0-9_-]{2,64}$/.test(id)) {
        return { original: trimmed, kind: "vanity", value: id };
      }
    }
  } catch {
    // Fall through to raw vanity handling.
  }

  if (/^[a-zA-Z0-9_-]{2,64}$/.test(trimmed)) {
    return { original: trimmed, kind: "vanity", value: trimmed };
  }

  throw new Error(`Could not understand Steam profile input: ${trimmed}`);
}

export async function fetchSteamAuthUser(steamId: string, apiKey: string): Promise<SteamAuthUser> {
  const [summary] = await fetchPlayerSummaries([steamId], apiKey);
  return steamAuthUserFromSummary(summary, steamId);
}

export async function fetchSteamFriends(steamId: string, apiKey: string): Promise<SteamFriend[]> {
  const url = new URL(`${STEAM_API_BASE}/ISteamUser/GetFriendList/v0001/`);
  url.search = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    relationship: "friend"
  }).toString();
  const data = await fetchJson<{ friendslist?: { friends?: SteamFriendEntry[] } }>(url);
  const entries = data.friendslist?.friends ?? [];
  const steamIds = entries.map((friend) => friend.steamid).filter((id) => /^\d{17}$/.test(id));
  const summaries = await fetchPlayerSummaries(steamIds, apiKey);
  const summariesById = new Map(summaries.map((summary) => [summary.steamid, summary]));
  return entries
    .filter((entry) => /^\d{17}$/.test(entry.steamid))
    .map((entry) => {
      const summary = summariesById.get(entry.steamid);
      return {
        ...steamAuthUserFromSummary(summary, entry.steamid),
        friendSince: entry.friend_since
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function fetchRecommendations(): Promise<RecommendationGame[]> {
  if (recommendationCache && recommendationCache.expiresAt > Date.now()) {
    return recommendationCache.games;
  }

  const appIds = RECOMMENDATION_POOL.map((entry) => entry.appId);
  const details = await fetchStoreDetails(appIds);
  const games = RECOMMENDATION_POOL.map((entry) => {
    const detail = details.get(entry.appId);
    const price = detail
      ? priceInfoFromStoreDetails(detail)
      : ({ status: "unavailable", countryCode: STORE_PRICE_COUNTRY_CODE } satisfies SteamPriceInfo);
    return {
      appId: entry.appId,
      name: detail?.name ?? entry.name,
      kind: entry.kind,
      description: stripHtml(detail?.short_description ?? "Curated Steam recommendation."),
      steamUrl: `https://store.steampowered.com/app/${entry.appId}`,
      price
    } satisfies RecommendationGame;
  });

  recommendationCache = { games, expiresAt: Date.now() + RECOMMENDATION_CACHE_TTL_MS };
  return games;
}

export async function compareSteamLibraries(inputs: string[], apiKey: string): Promise<CompareResult> {
  const parsedInputs = inputs.map(parseSteamInput);
  const resolvedUsers = await resolveSteamIds(parsedInputs, apiKey);
  const summaries = await fetchPlayerSummaries(
    resolvedUsers.map((user) => user.steamId),
    apiKey
  );

  const libraries = await mapWithConcurrency(resolvedUsers, 4, async (user) => ({
    steamId: user.steamId,
    library: await fetchOwnedGames(user.steamId, apiKey)
  }));

  const summariesById = new Map(summaries.map((summary) => [summary.steamid, summary]));
  const librariesById = new Map(libraries.map((entry) => [entry.steamId, entry.library]));
  const warnings: string[] = [];

  const users: SteamUserResult[] = resolvedUsers.map((user) => {
    const summary = summariesById.get(user.steamId);
    const library = librariesById.get(user.steamId);
    const visibleGameCount = library?.withFreeGames.length ?? 0;
    const warning = library?.warning;
    if (warning) {
      warnings.push(`${summary?.personaname ?? user.steamId}: ${warning}`);
    }
    return {
      steamId: user.steamId,
      input: user.input,
      displayName: summary?.personaname ?? user.steamId,
      profileUrl: summary?.profileurl ?? `https://steamcommunity.com/profiles/${user.steamId}`,
      avatarUrl: summary?.avatarfull ?? "",
      gameCount: library?.baseGames.length ?? 0,
      visibleGameCount,
      privateOrEmpty: visibleGameCount === 0,
      warning
    };
  });

  const freePlayedAppIds = new Set<number>();
  const appMap = new Map<number, ComparedGame>();

  for (const user of resolvedUsers) {
    const library = librariesById.get(user.steamId);
    if (!library) continue;
    const baseIds = new Set(library.baseGames.map((game) => game.appid));
    for (const game of library.withFreeGames) {
      if (!baseIds.has(game.appid)) {
        freePlayedAppIds.add(game.appid);
      }
      const existing = appMap.get(game.appid);
      const playtime = game.playtime_forever ?? 0;
      if (existing) {
        existing.owners.push(user.steamId);
        existing.totalPlaytimeMinutes += playtime;
        existing.ownerPlaytimeMinutes[user.steamId] = playtime;
      } else {
        appMap.set(game.appid, {
          appId: game.appid,
          name: game.name ?? `App ${game.appid}`,
          owners: [user.steamId],
          missing: [],
          totalPlaytimeMinutes: playtime,
          ownerPlaytimeMinutes: { [user.steamId]: playtime },
          steamUrl: `https://store.steampowered.com/app/${game.appid}`,
          freeStatus: freePlayedAppIds.has(game.appid) ? "likely-free" : "unknown",
          price: { status: "not-checked", countryCode: STORE_PRICE_COUNTRY_CODE }
        });
      }
    }
  }

  const userIds = resolvedUsers.map((user) => user.steamId);
  const allGames = Array.from(appMap.values()).map((game) => ({
    ...game,
    owners: sortByInputOrder(game.owners, userIds),
    missing: userIds.filter((steamId) => !game.owners.includes(steamId)),
    freeStatus: freePlayedAppIds.has(game.appId) ? "likely-free" : game.freeStatus
  }));

  const storeCheckIds = [...allGames]
    .sort((a, b) => b.owners.length - a.owners.length || b.totalPlaytimeMinutes - a.totalPlaytimeMinutes)
    .slice(0, MAX_STORE_CHECKS)
    .map((game) => game.appId);
  const storePrices = await fetchStorePrices(storeCheckIds);

  const enrichedGames = allGames
    .map((game) => {
      const price = storePrices.get(game.appId) ?? game.price;
      return {
        ...game,
        price,
        freeStatus:
          price.status === "free"
            ? "verified-free"
            : price.status === "paid"
              ? "unknown"
              : game.freeStatus
      } satisfies ComparedGame;
    })
    .sort((a, b) => {
      const ownerDelta = b.owners.length - a.owners.length;
      if (ownerDelta !== 0) return ownerDelta;
      const playtimeDelta = b.totalPlaytimeMinutes - a.totalPlaytimeMinutes;
      if (playtimeDelta !== 0) return playtimeDelta;
      return a.name.localeCompare(b.name);
    });

  const commonGames = enrichedGames.filter((game) => game.owners.length === userIds.length);
  const freeToAdd = enrichedGames.filter(
    (game) => game.owners.length > 0 && game.owners.length < userIds.length && game.freeStatus !== "unknown"
  );

  return {
    users,
    commonGames,
    freeToAdd,
    allGames: enrichedGames,
    warnings,
    generatedAt: new Date().toISOString()
  };
}

async function resolveSteamIds(inputs: ParsedSteamInput[], apiKey: string): Promise<Array<{ input: string; steamId: string }>> {
  const resolved: Array<{ input: string; steamId: string }> = [];
  for (const input of inputs) {
    if (input.kind === "steamid") {
      resolved.push({ input: input.original, steamId: input.value });
      continue;
    }
    const url = new URL(`${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/`);
    url.search = new URLSearchParams({ key: apiKey, vanityurl: input.value }).toString();
    const data = await fetchJson<{ response?: { success?: number; steamid?: string; message?: string } }>(url);
    if (data.response?.success !== 1 || !data.response.steamid) {
      throw new Error(`Could not resolve vanity profile "${input.value}".`);
    }
    resolved.push({ input: input.original, steamId: data.response.steamid });
  }
  return resolved;
}

async function fetchPlayerSummaries(steamIds: string[], apiKey: string): Promise<SteamSummary[]> {
  if (steamIds.length === 0) return [];
  const url = new URL(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v0002/`);
  url.search = new URLSearchParams({ key: apiKey, steamids: steamIds.join(",") }).toString();
  const data = await fetchJson<{ response?: { players?: SteamSummary[] } }>(url);
  return data.response?.players ?? [];
}

function steamAuthUserFromSummary(summary: SteamSummary | undefined, fallbackSteamId: string): SteamAuthUser {
  return {
    steamId: summary?.steamid ?? fallbackSteamId,
    displayName: summary?.personaname ?? fallbackSteamId,
    profileUrl: summary?.profileurl ?? `https://steamcommunity.com/profiles/${fallbackSteamId}`,
    avatarUrl: summary?.avatarfull ?? ""
  };
}

async function fetchOwnedGames(steamId: string, apiKey: string): Promise<LibraryFetchResult> {
  try {
    const [baseGames, withFreeGames] = await Promise.all([
      fetchOwnedGamesVariant(steamId, apiKey, false),
      fetchOwnedGamesVariant(steamId, apiKey, true)
    ]);
    const warning =
      withFreeGames.length === 0
        ? "No visible games returned. The library may be private, restricted, or empty."
        : undefined;
    return { baseGames, withFreeGames, warning };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Steam library request failed.";
    return { baseGames: [], withFreeGames: [], warning: message };
  }
}

async function fetchOwnedGamesVariant(
  steamId: string,
  apiKey: string,
  includePlayedFreeGames: boolean
): Promise<SteamOwnedGame[]> {
  const url = new URL(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/`);
  url.search = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    format: "json",
    include_appinfo: "1",
    include_played_free_games: includePlayedFreeGames ? "1" : "0"
  }).toString();
  const data = await fetchJson<{ response?: { games?: SteamOwnedGame[] } }>(url);
  return data.response?.games ?? [];
}

async function fetchStorePrices(appIds: number[]): Promise<Map<number, SteamPriceInfo>> {
  const prices = new Map<number, SteamPriceInfo>();
  const uniqueIds = Array.from(new Set(appIds));

  const results = await mapWithConcurrency(uniqueIds, 3, async (appId) => {
    try {
      return [appId, await fetchStorePrice(appId)] as const;
    } catch {
      return [appId, { status: "unavailable", countryCode: STORE_PRICE_COUNTRY_CODE } satisfies SteamPriceInfo] as const;
    }
  });

  for (const [appId, price] of results) {
    prices.set(appId, price);
  }

  return prices;
}

async function fetchStoreDetails(appIds: number[]): Promise<Map<number, SteamStoreDetails>> {
  const details = new Map<number, SteamStoreDetails>();
  const uniqueIds = Array.from(new Set(appIds));
  const chunks = chunk(uniqueIds, 50);
  const results = await mapWithConcurrency(chunks, 3, async (chunkIds) => {
    try {
      return await fetchStoreDetailsBatch(chunkIds);
    } catch {
      return fetchStoreDetailsSingles(chunkIds);
    }
  });
  for (const result of results) {
    for (const [appId, detail] of result) {
      details.set(appId, detail);
    }
  }
  return details;
}

async function fetchStoreDetailsBatch(appIds: number[]): Promise<Map<number, SteamStoreDetails>> {
  const url = new URL(STORE_API_BASE);
  url.search = new URLSearchParams({
    appids: appIds.join(","),
    cc: STORE_PRICE_COUNTRY,
    l: "english",
    filters: "basic,price_overview"
  }).toString();
  const data = await fetchJson<Record<string, { success?: boolean; data?: SteamStoreDetails }>>(url);
  const details = new Map<number, SteamStoreDetails>();
  for (const appId of appIds) {
    const app = data[String(appId)];
    if (app?.success && app.data) details.set(appId, app.data);
  }
  if (details.size === 0 && appIds.length > 1) {
    return fetchStoreDetailsSingles(appIds);
  }
  return details;
}

async function fetchStoreDetailsSingles(appIds: number[]): Promise<Map<number, SteamStoreDetails>> {
  const results = await mapWithConcurrency(appIds, 8, async (appId) => {
    try {
      return [appId, await fetchStoreDetail(appId)] as const;
    } catch {
      return [appId, null] as const;
    }
  });
  const details = new Map<number, SteamStoreDetails>();
  for (const [appId, detail] of results) {
    if (detail) details.set(appId, detail);
  }
  return details;
}

async function fetchStoreDetail(appId: number): Promise<SteamStoreDetails | null> {
  const url = new URL(STORE_API_BASE);
  url.search = new URLSearchParams({
    appids: String(appId),
    cc: STORE_PRICE_COUNTRY,
    l: "english",
    filters: "basic,price_overview"
  }).toString();
  const data = await fetchJson<Record<string, { success?: boolean; data?: SteamStoreDetails }>>(url);
  const app = data[String(appId)];
  if (!app?.success || !app.data) return null;
  return app.data;
}

async function fetchStorePrice(appId: number): Promise<SteamPriceInfo> {
  const url = new URL(STORE_API_BASE);
  url.search = new URLSearchParams({
    appids: String(appId),
    cc: STORE_PRICE_COUNTRY,
    l: "english",
    filters: "basic,price_overview"
  }).toString();

  const data = await fetchJson<
    Record<
      string,
      {
        success?: boolean;
        data?: SteamStoreDetails;
      }
    >
  >(url);
  const app = data[String(appId)];
  if (!app?.success || !app.data) {
    return { status: "unavailable", countryCode: STORE_PRICE_COUNTRY_CODE };
  }

  return priceInfoFromStoreDetails(app.data);
}

function priceInfoFromStoreDetails(details: SteamStoreDetails): SteamPriceInfo {
  if (details.is_free) {
    return {
      status: "free",
      countryCode: STORE_PRICE_COUNTRY_CODE,
      initial: 0,
      final: 0,
      discountPercent: 0,
      finalFormatted: "Free"
    };
  }

  const overview = details.price_overview;
  if (!overview) {
    return { status: "unavailable", countryCode: STORE_PRICE_COUNTRY_CODE };
  }

  const final = overview.final ?? 0;
  return {
    status: final === 0 ? "free" : "paid",
    countryCode: STORE_PRICE_COUNTRY_CODE,
    currency: overview.currency,
    initial: overview.initial,
    final,
    discountPercent: overview.discount_percent,
    initialFormatted: overview.initial_formatted,
    finalFormatted: final === 0 ? "Free" : overview.final_formatted
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function fetchJson<T>(url: URL): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "steam-common-games-local/0.1",
        "Accept-Language": "en-GB,en;q=0.9"
      }
    });
    if (!response.ok) {
      throw new Error(`Steam request failed with HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map(mapper))));
  }
  return results;
}

function sortByInputOrder(values: string[], order: string[]): string[] {
  return [...values].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
