import { z } from "zod";
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
  { appId: 2551020, name: "One-armed robber", kind: "free" },
  { appId: 1977530, name: "One-armed cook", kind: "free" },
  { appId: 3809440, name: "Cheese Rolling", kind: "free" },
  { appId: 1173370, name: "Slapshot: Rebound", kind: "free" },
  { appId: 1568590, name: "Goose Goose Duck", kind: "free" },
  { appId: 2709570, name: "Supermarket Together", kind: "free" },
  { appId: 1782210, name: "Crab Game", kind: "free" },
  { appId: 843380, name: "Super Animal Royale", kind: "free" },
  { appId: 2239140, name: "Grapples Galore", kind: "free" },
  { appId: 2994020, name: "Puck", kind: "free" },
  { appId: 582500, name: "We Were Here", kind: "free" },
  { appId: 823130, name: "Totally Accurate Battlegrounds", kind: "free" },
  { appId: 1088150, name: "Scribble It!", kind: "free" },
  { appId: 265630, name: "Fistful of Frags", kind: "free" },
  { appId: 2084050, name: "Unsolved Case", kind: "free" },
  { appId: 1453490, name: "Deducto", kind: "free" },
  { appId: 1568540, name: "Smithworks", kind: "free" },
  { appId: 1966720, name: "Lethal Company", kind: "paid" },
  { appId: 553850, name: "Helldivers 2", kind: "paid" },
  { appId: 1426210, name: "It Takes Two", kind: "paid" },
  { appId: 728880, name: "Overcooked! 2", kind: "paid" },
  { appId: 620, name: "Portal 2", kind: "paid" },
  { appId: 550, name: "Left 4 Dead 2", kind: "paid" },
  { appId: 739630, name: "Phasmophobia", kind: "paid" },
  { appId: 548430, name: "Deep Rock Galactic", kind: "paid" },
  { appId: 105600, name: "Terraria", kind: "paid" },
  { appId: 413150, name: "Stardew Valley", kind: "paid" },
  { appId: 1086940, name: "Baldur's Gate 3", kind: "paid" },
  { appId: 582010, name: "Monster Hunter: World", kind: "paid" },
  { appId: 1623730, name: "Palworld", kind: "paid" },
  { appId: 648800, name: "Raft", kind: "paid" },
  { appId: 242760, name: "The Forest", kind: "paid" },
  { appId: 1326470, name: "Sons of the Forest", kind: "paid" },
  { appId: 252490, name: "Rust", kind: "paid" },
  { appId: 892970, name: "Valheim", kind: "paid" },
  { appId: 322330, name: "Don't Starve Together", kind: "paid" },
  { appId: 4000, name: "Garry's Mod", kind: "paid" },
  { appId: 341800, name: "Keep Talking and Nobody Explodes", kind: "paid" },
  { appId: 1172620, name: "Sea of Thieves", kind: "paid" },
  { appId: 286160, name: "Tabletop Simulator", kind: "paid" },
  { appId: 945360, name: "Among Us", kind: "paid" },
  { appId: 1599600, name: "PlateUp!", kind: "paid" },
  { appId: 1260320, name: "Party Animals", kind: "paid" },
  { appId: 285900, name: "Gang Beasts", kind: "paid" },
  { appId: 477160, name: "Human: Fall Flat", kind: "paid" },
  { appId: 880940, name: "Pummel Party", kind: "paid" },
  { appId: 331670, name: "The Jackbox Party Pack", kind: "paid" },
  { appId: 962130, name: "Grounded", kind: "paid" },
  { appId: 1203620, name: "Enshrouded", kind: "paid" },
  { appId: 49520, name: "Borderlands 2", kind: "paid" },
  { appId: 397540, name: "Borderlands 3", kind: "paid" },
  { appId: 239140, name: "Dying Light", kind: "paid" },
  { appId: 534380, name: "Dying Light 2 Stay Human", kind: "paid" },
  { appId: 1282100, name: "Remnant II", kind: "paid" },
  { appId: 617290, name: "Remnant: From the Ashes", kind: "paid" },
  { appId: 632360, name: "Risk of Rain 2", kind: "paid" },
  { appId: 218620, name: "Payday 2", kind: "paid" },
  { appId: 1272080, name: "Payday 3", kind: "paid" },
  { appId: 1144200, name: "Ready or Not", kind: "paid" },
  { appId: 493520, name: "GTFO", kind: "paid" },
  { appId: 1604030, name: "V Rising", kind: "paid" },
  { appId: 1621690, name: "Core Keeper", kind: "paid" },
  { appId: 108600, name: "Project Zomboid", kind: "paid" },
  { appId: 251570, name: "7 Days to Die", kind: "paid" },
  { appId: 346110, name: "Ark: Survival Evolved", kind: "paid" },
  { appId: 2399830, name: "Ark: Survival Ascended", kind: "paid" },
  { appId: 526870, name: "Satisfactory", kind: "paid" },
  { appId: 427520, name: "Factorio", kind: "paid" },
  { appId: 1435790, name: "Escape Simulator", kind: "paid" },
  { appId: 1222700, name: "A Way Out", kind: "paid" },
  { appId: 1016920, name: "Unrailed!", kind: "paid" },
  { appId: 996770, name: "Moving Out", kind: "paid" },
  { appId: 252110, name: "Lovers in a Dangerous Spacetime", kind: "paid" },
  { appId: 268910, name: "Cuphead", kind: "paid" },
  { appId: 204360, name: "Castle Crashers", kind: "paid" },
  { appId: 238460, name: "BattleBlock Theater", kind: "paid" },
  { appId: 291650, name: "Pit People", kind: "paid" },
  { appId: 42910, name: "Magicka", kind: "paid" },
  { appId: 238370, name: "Magicka 2", kind: "paid" },
  { appId: 690640, name: "Trine 4: The Nightmare Prince", kind: "paid" },
  { appId: 471550, name: "Nine Parchments", kind: "paid" },
  { appId: 435150, name: "Divinity: Original Sin 2", kind: "paid" },
  { appId: 552500, name: "Warhammer: Vermintide 2", kind: "paid" },
  { appId: 1361210, name: "Warhammer 40,000: Darktide", kind: "paid" },
  { appId: 1304930, name: "The Outlast Trials", kind: "paid" },
  { appId: 2881650, name: "Content Warning", kind: "paid" },
  { appId: 416500, name: "PAC-MAN 256", kind: "paid" },
  { appId: 877570, name: "Heave Ho", kind: "paid" },
  { appId: 674940, name: "Stick Fight: The Game", kind: "paid" },
  { appId: 965680, name: "Boomerang Fu", kind: "paid" },
  { appId: 312530, name: "Duck Game", kind: "paid" },
  { appId: 386940, name: "Ultimate Chicken Horse", kind: "paid" },
  { appId: 207140, name: "SpeedRunners", kind: "paid" },
  { appId: 240460, name: "Mount Your Friends", kind: "paid" },
  { appId: 431240, name: "Golf With Your Friends", kind: "paid" },
  { appId: 571740, name: "Golf It!", kind: "paid" },
  { appId: 394690, name: "Tower Unite", kind: "paid" },
  { appId: 381210, name: "Dead by Daylight", kind: "paid" },
  { appId: 1433140, name: "The Texas Chain Saw Massacre", kind: "paid" },
  { appId: 594650, name: "Hunt: Showdown 1896", kind: "paid" },
  { appId: 221100, name: "DayZ", kind: "paid" },
  { appId: 107410, name: "Arma 3", kind: "paid" },
  { appId: 393380, name: "Squad", kind: "paid" },
  { appId: 686810, name: "Hell Let Loose", kind: "paid" },
  { appId: 505460, name: "Foxhole", kind: "paid" },
  { appId: 602960, name: "Barotrauma", kind: "paid" },
  { appId: 848450, name: "Subnautica: Below Zero", kind: "paid" },
  { appId: 275850, name: "No Man's Sky", kind: "paid" },
  { appId: 359320, name: "Elite Dangerous", kind: "paid" },
  { appId: 361420, name: "Astroneer", kind: "paid" },
  { appId: 244850, name: "Space Engineers", kind: "paid" },
  { appId: 387990, name: "Scrap Mechanic", kind: "paid" },
  { appId: 573090, name: "Stormworks: Build and Rescue", kind: "paid" },
  { appId: 585420, name: "Trailmakers", kind: "paid" },
  { appId: 552100, name: "Brick Rigs", kind: "paid" },
  { appId: 1167630, name: "Teardown", kind: "paid" },
  { appId: 284160, name: "BeamNG.drive", kind: "paid" },
  { appId: 271590, name: "Grand Theft Auto V", kind: "paid" },
  { appId: 1174180, name: "Red Dead Redemption 2", kind: "paid" },
  { appId: 1245620, name: "Elden Ring", kind: "paid" },
  { appId: 1091500, name: "Cyberpunk 2077", kind: "paid" },
  { appId: 990080, name: "Hogwarts Legacy", kind: "paid" },
  { appId: 292030, name: "The Witcher 3: Wild Hunt", kind: "paid" },
  { appId: 377160, name: "Fallout 4", kind: "paid" },
  { appId: 489830, name: "The Elder Scrolls V: Skyrim Special Edition", kind: "paid" },
  { appId: 976730, name: "Halo: The Master Chief Collection", kind: "paid" },
  { appId: 1551360, name: "Forza Horizon 5", kind: "paid" },
  { appId: 2195250, name: "EA Sports FC 24", kind: "paid" },
  { appId: 2338770, name: "NBA 2K24", kind: "paid" },
  { appId: 1364780, name: "Street Fighter 6", kind: "paid" },
  { appId: 1778820, name: "Tekken 8", kind: "paid" },
  { appId: 1971870, name: "Mortal Kombat 1", kind: "paid" },
  { appId: 1384160, name: "Guilty Gear -Strive-", kind: "paid" },
  { appId: 678950, name: "Dragon Ball FighterZ", kind: "paid" },
  { appId: 1687950, name: "Persona 5 Royal", kind: "paid" },
  { appId: 638970, name: "Yakuza 0", kind: "paid" },
  { appId: 2072450, name: "Like a Dragon: Infinite Wealth", kind: "paid" },
  { appId: 1145360, name: "Hades", kind: "paid" },
  { appId: 1145350, name: "Hades II", kind: "paid" },
  { appId: 367520, name: "Hollow Knight", kind: "paid" },
  { appId: 588650, name: "Dead Cells", kind: "paid" },
  { appId: 646570, name: "Slay the Spire", kind: "paid" },
  { appId: 250900, name: "The Binding of Isaac: Rebirth", kind: "paid" },
  { appId: 311690, name: "Enter the Gungeon", kind: "paid" },
  { appId: 418530, name: "Spelunky 2", kind: "paid" },
  { appId: 504230, name: "Celeste", kind: "paid" },
  { appId: 653530, name: "Return of the Obra Dinn", kind: "paid" },
  { appId: 753640, name: "Outer Wilds", kind: "paid" },
  { appId: 632470, name: "Disco Elysium", kind: "paid" },
  { appId: 264710, name: "Subnautica", kind: "paid" },
  { appId: 294100, name: "RimWorld", kind: "paid" },
  { appId: 975370, name: "Dwarf Fortress", kind: "paid" },
  { appId: 255710, name: "Cities: Skylines", kind: "paid" },
  { appId: 949230, name: "Cities: Skylines II", kind: "paid" },
  { appId: 703080, name: "Planet Zoo", kind: "paid" },
  { appId: 493340, name: "Planet Coaster", kind: "paid" },
  { appId: 1244460, name: "Jurassic World Evolution 2", kind: "paid" },
  { appId: 813780, name: "Age of Empires II: Definitive Edition", kind: "paid" },
  { appId: 1466860, name: "Age of Empires IV", kind: "paid" },
  { appId: 289070, name: "Sid Meier's Civilization VI", kind: "paid" },
  { appId: 281990, name: "Stellaris", kind: "paid" },
  { appId: 394360, name: "Hearts of Iron IV", kind: "paid" },
  { appId: 1158310, name: "Crusader Kings III", kind: "paid" },
  { appId: 1142710, name: "Total War: WARHAMMER III", kind: "paid" },
  { appId: 261550, name: "Mount & Blade II: Bannerlord", kind: "paid" },
  { appId: 268500, name: "XCOM 2", kind: "paid" },
  { appId: 368260, name: "Marvel's Midnight Suns", kind: "paid" }
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
