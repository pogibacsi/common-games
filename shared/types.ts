export interface SteamUserResult {
  steamId: string;
  input: string;
  displayName: string;
  profileUrl: string;
  avatarUrl: string;
  gameCount: number;
  visibleGameCount: number;
  privateOrEmpty: boolean;
  warning?: string;
}

export interface SteamAuthUser {
  steamId: string;
  displayName: string;
  profileUrl: string;
  avatarUrl: string;
}

export interface AuthStatusResponse {
  user: SteamAuthUser | null;
}

export interface SteamFriend {
  steamId: string;
  displayName: string;
  profileUrl: string;
  avatarUrl: string;
  friendSince?: number;
}

export interface FriendsResponse {
  friends: SteamFriend[];
  warning?: string;
}

export interface ComparedGame {
  appId: number;
  name: string;
  owners: string[];
  missing: string[];
  totalPlaytimeMinutes: number;
  ownerPlaytimeMinutes: Record<string, number>;
  steamUrl: string;
  freeStatus: "verified-free" | "likely-free" | "unknown";
  price: SteamPriceInfo;
}

export interface SteamPriceInfo {
  status: "free" | "paid" | "unavailable" | "not-checked";
  countryCode: "DE";
  currency?: string;
  initial?: number;
  final?: number;
  discountPercent?: number;
  initialFormatted?: string;
  finalFormatted?: string;
}

export type RecommendationKind = "free" | "paid";

export interface RecommendationGame {
  appId: number;
  name: string;
  steamUrl: string;
  description: string;
  kind: RecommendationKind;
  price: SteamPriceInfo;
}

export interface RecommendationsResponse {
  recommendations: RecommendationGame[];
}

export interface CompareResult {
  users: SteamUserResult[];
  commonGames: ComparedGame[];
  freeToAdd: ComparedGame[];
  allGames: ComparedGame[];
  warnings: string[];
  generatedAt: string;
}

export interface CompareRequestBody {
  profiles: string[];
}
