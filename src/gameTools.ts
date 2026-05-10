import type { ComparedGame, CompareResult, RecommendationGame, RecommendationKind } from "../shared/types";

export type PickerPriceFilter = "both" | "free" | "paid";

export function getRandomPickerCandidates(
  games: ComparedGame[],
  minOwners: number,
  priceFilter: PickerPriceFilter
): ComparedGame[] {
  return games.filter((game) => {
    if (game.owners.length < minOwners) return false;
    if (priceFilter === "free") return isFreeGame(game);
    if (priceFilter === "paid") return game.price.status === "paid";
    return true;
  });
}

export function isFreeGame(game: ComparedGame): boolean {
  return game.price.status === "free" || game.freeStatus === "verified-free" || game.freeStatus === "likely-free";
}

export function filterRecommendationCandidates(
  recommendations: RecommendationGame[],
  kind: RecommendationKind,
  result: CompareResult | null
): RecommendationGame[] {
  const ownedByEveryone = new Set(
    result?.allGames.filter((game) => game.owners.length === result.users.length).map((game) => game.appId) ?? []
  );
  return recommendations.filter((game) => game.kind === kind && !ownedByEveryone.has(game.appId));
}

export function pickRandom<T>(items: T[], random = Math.random): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(random() * items.length)];
}
