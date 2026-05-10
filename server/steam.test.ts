import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecommendations, fetchSteamFriends, parseCompareBody, parseSteamInput } from "./steam.js";

describe("parseSteamInput", () => {
  it("accepts Steam64 IDs", () => {
    expect(parseSteamInput("76561198000000000")).toEqual({
      original: "76561198000000000",
      kind: "steamid",
      value: "76561198000000000"
    });
  });

  it("accepts profile links", () => {
    expect(parseSteamInput("https://steamcommunity.com/profiles/76561198000000000/").value).toBe(
      "76561198000000000"
    );
  });

  it("accepts vanity links and raw vanity names", () => {
    expect(parseSteamInput("https://steamcommunity.com/id/cool_friend").value).toBe("cool_friend");
    expect(parseSteamInput("cool_friend").value).toBe("cool_friend");
  });

  it("rejects unrelated URLs", () => {
    expect(() => parseSteamInput("https://example.com/id/cool_friend")).toThrow();
  });
});

describe("parseCompareBody", () => {
  it("deduplicates entries and requires two users", () => {
    expect(parseCompareBody({ profiles: ["a", "b", "a"] })).toEqual(["a", "b"]);
    expect(() => parseCompareBody({ profiles: ["a", "a"] })).toThrow("two different");
  });
});

describe("fetchSteamFriends", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads friend IDs and enriches them with player summaries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ friendslist: { friends: [{ steamid: "76561198000000002", friend_since: 123 }] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          response: {
            players: [
              {
                steamid: "76561198000000002",
                personaname: "Friend",
                profileurl: "https://steamcommunity.com/profiles/76561198000000002",
                avatarfull: "https://avatars.example/friend.jpg"
              }
            ]
          }
        })
      );

    await expect(fetchSteamFriends("76561198000000000", "key")).resolves.toEqual([
      {
        steamId: "76561198000000002",
        displayName: "Friend",
        profileUrl: "https://steamcommunity.com/profiles/76561198000000002",
        avatarUrl: "https://avatars.example/friend.jpg",
        friendSince: 123
      }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchRecommendations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the hardcoded recommendation pool enriched with Steam prices", async () => {
    const freeAppIds = new Set([582500, 2551020, 1568590]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const appIds = (url.searchParams.get("appids") ?? "0").split(",");
      return jsonResponse(
        Object.fromEntries(
          appIds.map((appId) => [
            appId,
            {
              success: true,
              data: {
                name: `Game ${appId}`,
                short_description: `Steam description for ${appId}.`,
                is_free: freeAppIds.has(Number(appId)),
                price_overview: freeAppIds.has(Number(appId))
                  ? undefined
                  : {
                      currency: "EUR",
                      initial: 999,
                      final: 999,
                      discount_percent: 0,
                      final_formatted: "9,99€"
                    }
              }
            }
          ])
        )
      );
    });

    const recommendations = await fetchRecommendations();

    expect(recommendations.length).toBeGreaterThan(100);
    const weWereHere = recommendations.find((game) => game.appId === 582500);
    expect(weWereHere?.kind).toBe("free");
    expect(weWereHere?.price.status).toBe("free");
    const lethalCompany = recommendations.find((game) => game.appId === 1966720);
    expect(lethalCompany?.kind).toBe("paid");
    expect(lethalCompany?.price.status).toBe("paid");
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body
  } as Response;
}
