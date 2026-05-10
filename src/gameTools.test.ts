import { describe, expect, it } from "vitest";
import type { ComparedGame, CompareResult, RecommendationGame } from "../shared/types";
import { filterRecommendationCandidates, getRandomPickerCandidates, pickRandom } from "./gameTools";

const baseGame: ComparedGame = {
  appId: 1,
  name: "Game",
  owners: ["a"],
  missing: ["b", "c"],
  totalPlaytimeMinutes: 60,
  ownerPlaytimeMinutes: { a: 60 },
  steamUrl: "https://store.steampowered.com/app/1",
  freeStatus: "unknown",
  price: { status: "paid", countryCode: "DE", final: 999, finalFormatted: "9,99€" }
};

describe("getRandomPickerCandidates", () => {
  it("filters by owner count and price mode", () => {
    const freeGame: ComparedGame = {
      ...baseGame,
      appId: 2,
      owners: ["a", "b"],
      missing: ["c"],
      price: { status: "free", countryCode: "DE" },
      freeStatus: "verified-free"
    };
    const paidGame: ComparedGame = { ...baseGame, appId: 3, owners: ["a", "b", "c"], missing: [] };

    expect(getRandomPickerCandidates([baseGame, freeGame, paidGame], 2, "both").map((game) => game.appId)).toEqual([2, 3]);
    expect(getRandomPickerCandidates([baseGame, freeGame, paidGame], 2, "free").map((game) => game.appId)).toEqual([2]);
    expect(getRandomPickerCandidates([baseGame, freeGame, paidGame], 2, "paid").map((game) => game.appId)).toEqual([3]);
  });
});

describe("filterRecommendationCandidates", () => {
  it("excludes games owned by everyone but allows partially owned games", () => {
    const recommendations: RecommendationGame[] = [
      recommendation(10, "free"),
      recommendation(11, "free"),
      recommendation(12, "paid")
    ];
    const result: CompareResult = {
      users: [
        user("a"),
        user("b")
      ],
      commonGames: [{ ...baseGame, appId: 10, owners: ["a", "b"], missing: [] }],
      freeToAdd: [],
      allGames: [
        { ...baseGame, appId: 10, owners: ["a", "b"], missing: [] },
        { ...baseGame, appId: 11, owners: ["a"], missing: ["b"] }
      ],
      warnings: [],
      generatedAt: "2026-01-01T00:00:00Z"
    };

    expect(filterRecommendationCandidates(recommendations, "free", result).map((game) => game.appId)).toEqual([11]);
  });
});

describe("pickRandom", () => {
  it("returns null for empty lists and uses the supplied random source", () => {
    expect(pickRandom([])).toBeNull();
    expect(pickRandom(["a", "b", "c"], () => 0.5)).toBe("b");
  });
});

function recommendation(appId: number, kind: "free" | "paid"): RecommendationGame {
  return {
    appId,
    kind,
    name: `Game ${appId}`,
    description: "Good with friends.",
    steamUrl: `https://store.steampowered.com/app/${appId}`,
    price: { status: kind, countryCode: "DE" }
  };
}

function user(steamId: string): CompareResult["users"][number] {
  return {
    steamId,
    input: steamId,
    displayName: steamId,
    profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
    avatarUrl: "",
    gameCount: 1,
    visibleGameCount: 1,
    privateOrEmpty: false
  };
}
