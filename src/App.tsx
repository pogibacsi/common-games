import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Dices,
  ExternalLink,
  Gamepad2,
  LogIn,
  LogOut,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Shuffle,
  Trash2,
  Users,
  X
} from "lucide-react";
import { createRoot } from "react-dom/client";
import type {
  AuthStatusResponse,
  CompareResult,
  ComparedGame,
  FriendsResponse,
  RecommendationGame,
  RecommendationsResponse,
  SteamAuthUser,
  SteamFriend
} from "../shared/types";
import { filterRecommendationCandidates, getRandomPickerCandidates, pickRandom, type PickerPriceFilter } from "./gameTools";
import "./styles.css";

type TabKey = "common" | "free" | "all";
type SortKey = "owners" | "playtime" | "price" | "name";

interface SavedGroup {
  id: string;
  name: string;
  profiles: string[];
}

const STORAGE_KEY = "steam-common-games.groups";
const LAST_INPUT_KEY = "steam-common-games.last-input";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const DEFAULT_INPUT = "";

const tabLabels: Record<TabKey, string> = {
  common: "Everyone Has",
  free: "Free To Add",
  all: "All Matches"
};

function App() {
  const [profileText, setProfileText] = useState(DEFAULT_INPUT);
  const [groupName, setGroupName] = useState("");
  const [savedGroups, setSavedGroups] = useState<SavedGroup[]>([]);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("common");
  const [sortKey, setSortKey] = useState<SortKey>("owners");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [healthError, setHealthError] = useState("");
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authUser, setAuthUser] = useState<SteamAuthUser | null>(null);
  const [friends, setFriends] = useState<SteamFriend[]>([]);
  const [friendWarning, setFriendWarning] = useState("");
  const [friendQuery, setFriendQuery] = useState("");
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<"random" | "recommendations" | null>(null);
  const [minRandomOwners, setMinRandomOwners] = useState(2);
  const [randomPriceFilter, setRandomPriceFilter] = useState<PickerPriceFilter>("both");
  const [reelItems, setReelItems] = useState<ComparedGame[]>([]);
  const [reelOffset, setReelOffset] = useState(0);
  const [isReelSpinning, setIsReelSpinning] = useState(false);
  const [selectedRandomGame, setSelectedRandomGame] = useState<ComparedGame | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationGame[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState("");
  const [freeRecommendation, setFreeRecommendation] = useState<RecommendationGame | null>(null);
  const [paidRecommendation, setPaidRecommendation] = useState<RecommendationGame | null>(null);
  const [recommendationKind, setRecommendationKind] = useState<"free" | "paid">("free");
  const [maxPaidPriceCents, setMaxPaidPriceCents] = useState<number | null>(null);
  const [recommendationReelItems, setRecommendationReelItems] = useState<RecommendationGame[]>([]);
  const [recommendationReelOffset, setRecommendationReelOffset] = useState(0);
  const [recommendationReelIndex, setRecommendationReelIndex] = useState(0);
  const [recommendationMarkerPct, setRecommendationMarkerPct] = useState(50);
  const [recommendationDurationMs, setRecommendationDurationMs] = useState(0);
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendationGame | null>(null);
  const [isRecommendationReelSpinning, setIsRecommendationReelSpinning] = useState(false);
  const [reelIndex, setReelIndex] = useState(0);
  const [reelMarkerPct, setReelMarkerPct] = useState(50);
  const [reelDurationMs, setReelDurationMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const storedGroups = readCookie(STORAGE_KEY) ?? window.localStorage.getItem(STORAGE_KEY);
    const storedInput = readCookie(LAST_INPUT_KEY) ?? window.localStorage.getItem(LAST_INPUT_KEY);
    if (storedGroups) {
      try {
        setSavedGroups(JSON.parse(storedGroups) as SavedGroup[]);
        writeCookie(STORAGE_KEY, storedGroups, COOKIE_MAX_AGE_SECONDS);
      } catch {
        setSavedGroups([]);
      }
    }
    if (storedInput) {
      setProfileText(storedInput);
      writeCookie(LAST_INPUT_KEY, storedInput, COOKIE_MAX_AGE_SECONDS);
    }
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LAST_INPUT_KEY);
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((data: { hasApiKey?: boolean }) => setHasApiKey(Boolean(data.hasApiKey)))
      .catch(() => {
        setHealthError("API server is not running.");
        setHasApiKey(false);
      });
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data: AuthStatusResponse) => setAuthUser(data.user))
      .catch(() => setAuthUser(null));

    const params = new URLSearchParams(window.location.search);
    if (params.has("steam_login")) {
      params.delete("steam_login");
      const nextSearch = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);
    }
  }, []);

  useEffect(() => {
    writeCookie(LAST_INPUT_KEY, profileText, COOKIE_MAX_AGE_SECONDS);
  }, [profileText]);

  const profiles = useMemo(
    () =>
      profileText
        .split(/\r?\n|,/)
        .map((line) => line.trim())
        .filter(Boolean),
    [profileText]
  );

  const userById = useMemo(() => new Map(result?.users.map((user) => [user.steamId, user]) ?? []), [result]);

  const selectedProfileIds = useMemo(() => new Set(profiles.filter((profile) => /^\d{17}$/.test(profile))), [profiles]);

  const filteredFriends = useMemo(() => {
    const normalizedQuery = friendQuery.trim().toLowerCase();
    if (!normalizedQuery) return friends;
    return friends.filter(
      (friend) => friend.displayName.toLowerCase().includes(normalizedQuery) || friend.steamId.includes(normalizedQuery)
    );
  }, [friendQuery, friends]);

  const selectedGames = useMemo(() => {
    if (!result) return [];
    const source =
      activeTab === "common" ? result.commonGames : activeTab === "free" ? result.freeToAdd : result.allGames;
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? source.filter((game) => game.name.toLowerCase().includes(normalizedQuery) || String(game.appId).includes(normalizedQuery))
      : source;
    return [...filtered].sort((a, b) => sortGames(a, b, sortKey));
  }, [activeTab, query, result, sortKey]);
  const totalPages = Math.max(1, Math.ceil(selectedGames.length / 15));
  const pagedGames = useMemo(() => selectedGames.slice((page - 1) * 15, page * 15), [page, selectedGames]);

  const comparedUserCount = result?.users.length ?? profiles.length;
  const randomOwnerLimit = Math.max(1, comparedUserCount);
  const randomCandidates = useMemo(
    () => getRandomPickerCandidates(result?.allGames ?? [], Math.min(minRandomOwners, randomOwnerLimit), randomPriceFilter),
    [minRandomOwners, randomOwnerLimit, randomPriceFilter, result]
  );
  const freeRecommendationCandidates = useMemo(
    () => filterRecommendationCandidates(recommendations, "free", result),
    [recommendations, result]
  );
  const paidRecommendationCandidates = useMemo(
    () => filterRecommendationCandidates(recommendations, "paid", result, maxPaidPriceCents),
    [recommendations, result, maxPaidPriceCents]
  );
  const activeRecommendationCandidates = recommendationKind === "free" ? freeRecommendationCandidates : paidRecommendationCandidates;

  const addProfiles = useCallback((entries: string[]) => {
    setProfileText((current) => mergeProfileEntries(current, entries));
  }, []);

  const removeProfile = useCallback((entry: string) => {
    setProfileText((current) => removeProfileEntry(current, entry));
  }, []);

  useEffect(() => {
    if (authUser && !profiles.includes(authUser.steamId)) {
      addProfiles([authUser.steamId]);
    }
  }, [addProfiles, authUser, profiles]);

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    setFriendWarning("");
    try {
      const response = await fetch("/api/friends");
      if (!response.ok) throw new Error("Could not load Steam friends.");
      const data = (await response.json()) as FriendsResponse;
      setFriends(data.friends);
      setFriendWarning(data.warning ?? "");
    } catch (friendsError) {
      setFriends([]);
      setFriendWarning(friendsError instanceof Error ? friendsError.message : "Could not load Steam friends.");
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authUser) {
      void loadFriends();
    } else {
      setFriends([]);
      setFriendWarning("");
    }
  }, [authUser, loadFriends]);

  useEffect(() => {
    setMinRandomOwners((current) => Math.min(Math.max(1, current), randomOwnerLimit));
  }, [randomOwnerLimit]);

  useEffect(() => {
    if (result) {
      setMinRandomOwners(result.users.length);
    }
  }, [result?.generatedAt]);

  useEffect(() => {
    setReelItems(buildReelItems(randomCandidates, 44));
    setReelOffset(0);
    setReelIndex(0);
    setReelMarkerPct(50);
    setReelDurationMs(0);
    setSelectedRandomGame(null);
  }, [randomCandidates]);

  useEffect(() => {
    setRecommendationReelItems(buildReelItems(activeRecommendationCandidates, 44));
    setRecommendationReelOffset(0);
    setRecommendationReelIndex(0);
    setRecommendationMarkerPct(50);
    setRecommendationDurationMs(0);
    setSelectedRecommendation(null);
  }, [activeRecommendationCandidates]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, query, sortKey, result?.generatedAt]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setRecommendationsLoading(true);
    setRecommendationsError("");
    fetch("/api/recommendations")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load recommendations.");
        return response.json();
      })
      .then((data: RecommendationsResponse) => setRecommendations(data.recommendations))
      .catch((recommendationError) => {
        setRecommendations([]);
        setRecommendationsError(recommendationError instanceof Error ? recommendationError.message : "Could not load recommendations.");
      })
      .finally(() => setRecommendationsLoading(false));
  }, []);

  useEffect(() => {
    if (freeRecommendation && !freeRecommendationCandidates.some((game) => game.appId === freeRecommendation.appId)) {
      setFreeRecommendation(null);
    }
  }, [freeRecommendation, freeRecommendationCandidates]);

  useEffect(() => {
    if (paidRecommendation && !paidRecommendationCandidates.some((game) => game.appId === paidRecommendation.appId)) {
      setPaidRecommendation(null);
    }
  }, [paidRecommendation, paidRecommendationCandidates]);

  const compareLibraries = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles }),
        signal: abortRef.current.signal
      });
      const data = (await response.json()) as CompareResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data && data.error ? data.error : "Steam comparison failed.");
      }
      setResult(data as CompareResult);
      setActiveTab("common");
    } catch (comparisonError) {
      if (comparisonError instanceof DOMException && comparisonError.name === "AbortError") return;
      setError(comparisonError instanceof Error ? comparisonError.message : "Steam comparison failed.");
    } finally {
      setIsLoading(false);
    }
  }, [profiles]);

  const saveGroup = () => {
    const trimmedName = groupName.trim() || `Group ${savedGroups.length + 1}`;
    const nextGroups = [
      { id: crypto.randomUUID(), name: trimmedName, profiles },
      ...savedGroups.filter((group) => group.name !== trimmedName)
    ].slice(0, 12);
    setSavedGroups(nextGroups);
    writeCookie(STORAGE_KEY, JSON.stringify(nextGroups), COOKIE_MAX_AGE_SECONDS);
    setGroupName("");
  };

  const startSteamLogin = () => {
    window.location.href = `/api/auth/steam/start?client_origin=${encodeURIComponent(window.location.origin)}`;
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
  };

  const spinRandomWheel = (stageWidth: number) => {
    if (isReelSpinning || randomCandidates.length === 0) return;
    const winnerIndex = reelIndex + randomInt(18, 34);
    const reelStep = 190;
    const markerPct = 50;
    const durationMs = randomInt(3800, 6400);
    const reelPool = extendReelItems(reelItems, randomCandidates, winnerIndex + 10);
    const markerPx = stageWidth * (markerPct / 100);
    const nextOffset = markerPx - (winnerIndex * reelStep + reelStep / 2) + randomInt(-46, 46);
    setReelItems(reelPool);
    setReelMarkerPct(markerPct);
    setReelDurationMs(durationMs);
    setSelectedRandomGame(null);
    setIsReelSpinning(true);
    window.setTimeout(() => {
      setReelOffset(nextOffset);
    }, 120);
    window.setTimeout(() => {
      setSelectedRandomGame(reelPool[winnerIndex]);
      setReelIndex(winnerIndex);
      setIsReelSpinning(false);
    }, durationMs + 180);
  };

  const spinRecommendationReel = (stageWidth: number) => {
    if (isRecommendationReelSpinning || activeRecommendationCandidates.length === 0) return;
    const winnerIndex = recommendationReelIndex + randomInt(18, 34);
    const reelStep = 190;
    const markerPct = 50;
    const durationMs = randomInt(3800, 6400);
    const reelPool = extendReelItems(recommendationReelItems, activeRecommendationCandidates, winnerIndex + 10);
    const markerPx = stageWidth * (markerPct / 100);
    const nextOffset = markerPx - (winnerIndex * reelStep + reelStep / 2) + randomInt(-46, 46);
    setRecommendationReelItems(reelPool);
    setRecommendationMarkerPct(markerPct);
    setRecommendationDurationMs(durationMs);
    setSelectedRecommendation(null);
    setIsRecommendationReelSpinning(true);
    window.setTimeout(() => {
      setRecommendationReelOffset(nextOffset);
    }, 120);
    window.setTimeout(() => {
      const winner = reelPool[winnerIndex];
      setSelectedRecommendation(winner);
      setRecommendationReelIndex(winnerIndex);
      if (recommendationKind === "free") {
        setFreeRecommendation(winner);
      } else {
        setPaidRecommendation(winner);
      }
      setIsRecommendationReelSpinning(false);
    }, durationMs + 180);
  };

  const deleteGroup = (id: string) => {
    const nextGroups = savedGroups.filter((group) => group.id !== id);
    setSavedGroups(nextGroups);
    writeCookie(STORAGE_KEY, JSON.stringify(nextGroups), COOKIE_MAX_AGE_SECONDS);
  };

  return (
    <main className="app-shell">
      <section className="command-panel">
        <div className="brand-block">
          <div className="brand-mark">
            <Users size={22} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Steam Common Games</p>
            <h1>Find a game to play together.</h1>
          </div>
        </div>

        <SteamLoginPanel user={authUser} onLogin={startSteamLogin} onLogout={logout} />

        <FriendPicker
          user={authUser}
          friends={filteredFriends}
          selectedProfileIds={selectedProfileIds}
          query={friendQuery}
          warning={friendWarning}
          isLoading={friendsLoading}
          onQueryChange={setFriendQuery}
          onRefresh={loadFriends}
          onToggleFriend={(friend, selected) => {
            if (selected) {
              addProfiles([friend.steamId]);
            } else {
              removeProfile(friend.steamId);
            }
          }}
        />

        <ComparingList profiles={profiles} authUser={authUser} friends={friends} onRemove={removeProfile} />

        <div className="command-row">
          <button className="primary-button" onClick={compareLibraries} disabled={isLoading || profiles.length < 2}>
            {isLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
            Compare
          </button>
          <button className="icon-button" onClick={compareLibraries} disabled={isLoading || profiles.length < 2} title="Refresh">
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="save-row">
          <input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Group name"
            aria-label="Group name"
          />
          <button className="icon-button" onClick={saveGroup} disabled={profiles.length < 2} title="Save group">
            <Save size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="saved-groups" aria-label="Saved groups">
          {savedGroups.map((group) => (
            <div className="saved-group" key={group.id}>
              <button className="saved-group-main" onClick={() => setProfileText(group.profiles.join("\n"))}>
                <span>{group.name}</span>
                <small>{group.profiles.length} users</small>
              </button>
              <button className="ghost-icon" onClick={() => deleteGroup(group.id)} title="Delete group">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <StatusBlock hasApiKey={hasApiKey} healthError={healthError} error={error} />
      </section>

      <section className="result-panel">
        <ResultHeader result={result} isLoading={isLoading} />
        <ToolLauncher
          hasResult={Boolean(result)}
          onOpen={setActiveTool}
        />

        {result ? (
          <>
            <UserStrip result={result} />
            <WarningsStrip warnings={result.warnings} />
            <div className="toolbar">
              <div className="tabs" role="tablist" aria-label="Result views">
                {(["common", "free", "all"] as TabKey[]).map((tab) => (
                  <button
                    key={tab}
                    className={activeTab === tab ? "active" : ""}
                    onClick={() => setActiveTab(tab)}
                    role="tab"
                    aria-selected={activeTab === tab}
                  >
                    {tabLabels[tab]}
                    <span>{tabCount(result, tab)}</span>
                  </button>
                ))}
              </div>
              <div className="filters">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search games" />
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} aria-label="Sort games">
                  <option value="owners">Owners</option>
                  <option value="playtime">Combined playtime</option>
                  <option value="price">Store price</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>
            <GameTable games={pagedGames} users={result.users.map((user) => user.steamId)} userById={userById} tab={activeTab} />
            <Pagination page={page} totalPages={totalPages} totalItems={selectedGames.length} onPageChange={setPage} />
          </>
        ) : (
          <div className="empty-state">
            <div className="matrix-preview" aria-hidden="true">
              {Array.from({ length: 36 }).map((_, index) => (
                <span key={index} className={index % 4 === 0 || index % 7 === 0 ? "on" : ""} />
              ))}
            </div>
            <p>Waiting for at least two Steam profiles.</p>
          </div>
        )}
      </section>
      <ToolDialog open={activeTool === "recommendations"} title="Together Wildcard" onClose={() => setActiveTool(null)}>
        <RecommendationPanel
          isLoading={recommendationsLoading}
          error={recommendationsError}
          freeGame={freeRecommendation}
          paidGame={paidRecommendation}
          freeCount={freeRecommendationCandidates.length}
          paidCount={paidRecommendationCandidates.length}
          recommendationKind={recommendationKind}
          activeCandidates={activeRecommendationCandidates}
          reelItems={recommendationReelItems}
          reelOffset={recommendationReelOffset}
          markerPct={recommendationMarkerPct}
          durationMs={recommendationDurationMs}
          isSpinning={isRecommendationReelSpinning}
          selectedGame={selectedRecommendation}
          maxPaidPriceCents={maxPaidPriceCents}
          onKindChange={setRecommendationKind}
          onMaxPaidPriceChange={setMaxPaidPriceCents}
          onSpin={spinRecommendationReel}
        />
      </ToolDialog>
      <ToolDialog open={activeTool === "random"} title="Owned Game Picker" onClose={() => setActiveTool(null)}>
        {result ? (
          <RandomPickerPanel
            result={result}
            minOwners={Math.min(minRandomOwners, randomOwnerLimit)}
            priceFilter={randomPriceFilter}
            candidates={randomCandidates}
            reelItems={reelItems}
            reelOffset={reelOffset}
            markerPct={reelMarkerPct}
            durationMs={reelDurationMs}
            isSpinning={isReelSpinning}
            selectedGame={selectedRandomGame}
            onMinOwnersChange={setMinRandomOwners}
            onPriceFilterChange={setRandomPriceFilter}
            onSpin={spinRandomWheel}
          />
        ) : (
          <div className="tool-empty">Compare at least two Steam users before using the random selector.</div>
        )}
      </ToolDialog>
      <footer className="app-credit" aria-label="Credit">
        Made by Barnabas Polgar
      </footer>
    </main>
  );
}

function StatusBlock({ hasApiKey, healthError, error }: { hasApiKey: boolean | null; healthError: string; error: string }) {
  if (error) {
    return (
      <div className="status error">
        <AlertCircle size={17} aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }
  if (healthError || hasApiKey === false) {
    return (
      <div className="status warning">
        <AlertCircle size={17} aria-hidden="true" />
        <span>{healthError || "Missing STEAM_API_KEY in .env."}</span>
      </div>
    );
  }
  if (hasApiKey) {
    return null;
  }
  return null;
}

function SteamLoginPanel({
  user,
  onLogin,
  onLogout
}: {
  user: SteamAuthUser | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  if (!user) {
    return (
      <button className="steam-login-button" onClick={onLogin}>
        <LogIn size={18} aria-hidden="true" />
        Sign in through Steam
      </button>
    );
  }

  return (
    <div className="steam-session">
      <a href={safeSteamUrl(user.profileUrl)} target="_blank" rel="noopener noreferrer" className="steam-session-user">
        {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar-fallback">{initials(user.displayName)}</span>}
        <span>
          <strong>{user.displayName}</strong>
          <small>Signed in</small>
        </span>
      </a>
      <button className="ghost-icon" onClick={onLogout} title="Log out">
        <LogOut size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function FriendPicker({
  user,
  friends,
  selectedProfileIds,
  query,
  warning,
  isLoading,
  onQueryChange,
  onRefresh,
  onToggleFriend
}: {
  user: SteamAuthUser | null;
  friends: SteamFriend[];
  selectedProfileIds: Set<string>;
  query: string;
  warning: string;
  isLoading: boolean;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onToggleFriend: (friend: SteamFriend, selected: boolean) => void;
}) {
  if (!user) return null;

  return (
    <section className="friend-picker" aria-label="Steam friends">
      <div className="friend-picker-header">
        <span>Steam friends</span>
        <button className="ghost-icon" onClick={onRefresh} disabled={isLoading} title="Refresh friends">
          <RefreshCw className={isLoading ? "spin" : ""} size={15} aria-hidden="true" />
        </button>
      </div>
      <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search friends" />
      {warning ? (
        <div className="friend-warning">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{warning}</span>
        </div>
      ) : null}
      <div className="friend-list">
        {isLoading ? <span className="friend-empty">Loading friends...</span> : null}
        {!isLoading && friends.length === 0 ? <span className="friend-empty">No friends found.</span> : null}
        {!isLoading
          ? friends.slice(0, 250).map((friend) => {
              const checked = selectedProfileIds.has(friend.steamId);
              return (
                <label className="friend-row" key={friend.steamId}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => onToggleFriend(friend, event.target.checked)}
                  />
                  {friend.avatarUrl ? <img src={friend.avatarUrl} alt="" /> : <span className="avatar-fallback">{initials(friend.displayName)}</span>}
                  <span>
                    <strong>{friend.displayName}</strong>
                    <small>{friend.steamId}</small>
                  </span>
                </label>
              );
            })
          : null}
      </div>
    </section>
  );
}

function ComparingList({
  profiles,
  authUser,
  friends,
  onRemove
}: {
  profiles: string[];
  authUser: SteamAuthUser | null;
  friends: SteamFriend[];
  onRemove: (profile: string) => void;
}) {
  const peopleById = new Map<string, SteamAuthUser | SteamFriend>();
  if (authUser) peopleById.set(authUser.steamId, authUser);
  for (const friend of friends) peopleById.set(friend.steamId, friend);

  return (
    <section className="comparing-panel" aria-label="Comparing friends">
      <div className="field-label">Comparing friends</div>
      <div className="selected-people">
        {profiles.length === 0 ? <span className="selected-empty">Sign in and select friends to compare.</span> : null}
        {profiles.map((profile) => {
          const person = peopleById.get(profile);
          const label = person?.displayName ?? profile;
          const isSelf = authUser?.steamId === profile;
          return (
            <div className="selected-person" key={profile}>
              {person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <span className="avatar-fallback">{initials(label)}</span>}
              <span>
                <strong>{isSelf ? `${label} (you)` : label}</strong>
                <small>{profile}</small>
              </span>
              <button className="ghost-icon" onClick={() => onRemove(profile)} disabled={isSelf} title={isSelf ? "You are always included" : "Remove"}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ToolLauncher({
  hasResult,
  onOpen
}: {
  hasResult: boolean;
  onOpen: (tool: "random" | "recommendations") => void;
}) {
  return (
    <div className="tool-launcher" aria-label="Game tools">
      <button onClick={() => onOpen("recommendations")}>
        <Dices size={17} aria-hidden="true" />
        <span>
          <strong>Together Wildcard</strong>
          <small>Discover an easy, low-commitment Steam game your group can jump into together.</small>
        </span>
      </button>
      <button onClick={() => onOpen("random")} disabled={!hasResult}>
        <Gamepad2 size={17} aria-hidden="true" />
        <span>
          <strong>Owned Game Picker</strong>
          <small>
            {hasResult
              ? "Pick from games your compared players already own, so the group can jump into something immediately."
              : "Compare friends first to pick from games the group already owns."}
          </small>
        </span>
      </button>
    </div>
  );
}

function ToolDialog({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="tool-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="tool-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="tool-dialog-header">
          <div>
            <p className="eyebrow">Steam Common Games</p>
            <h2>{title}</h2>
          </div>
          <button className="ghost-icon" onClick={onClose} title="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

const MAX_PRICE_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "≤ €5", value: 500 },
  { label: "≤ €10", value: 1000 },
  { label: "≤ €20", value: 2000 },
  { label: "≤ €40", value: 4000 },
  { label: "Any", value: null }
];

function RecommendationPanel({
  isLoading,
  error,
  freeGame,
  paidGame,
  freeCount,
  paidCount,
  recommendationKind,
  activeCandidates,
  reelItems,
  reelOffset,
  markerPct,
  durationMs,
  isSpinning,
  selectedGame,
  maxPaidPriceCents,
  onKindChange,
  onMaxPaidPriceChange,
  onSpin
}: {
  isLoading: boolean;
  error: string;
  freeGame: RecommendationGame | null;
  paidGame: RecommendationGame | null;
  freeCount: number;
  paidCount: number;
  recommendationKind: "free" | "paid";
  activeCandidates: RecommendationGame[];
  reelItems: RecommendationGame[];
  reelOffset: number;
  markerPct: number;
  durationMs: number;
  isSpinning: boolean;
  selectedGame: RecommendationGame | null;
  maxPaidPriceCents: number | null;
  onKindChange: (kind: "free" | "paid") => void;
  onMaxPaidPriceChange: (value: number | null) => void;
  onSpin: (stageWidth: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setShowAll(false);
  }, [recommendationKind]);

  const displayedPick = selectedGame?.kind === recommendationKind ? selectedGame : recommendationKind === "free" ? freeGame : paidGame;

  const handleSeeAll = () => {
    const confirmed = window.confirm(
      "Heads up: peeking at the full list takes the fun out of rolling for a random surprise. Sure you want to spoil it?"
    );
    if (confirmed) setShowAll(true);
  };

  return (
    <section className="tool-panel recommendation-panel in-dialog" aria-label="Steam recommendations">
      <div className="tool-heading spacious">
        <span>
          <Dices size={17} aria-hidden="true" />
          Discover an easy, low-commitment Steam game your group can jump into together.
        </span>
        {isLoading ? <small>Loading Steam games...</small> : null}
      </div>
      {error ? (
        <div className="tool-empty">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="recommendation-reel-panel">
          <div className="segmented-control price-toggle">
            <button className={recommendationKind === "free" ? "active free-mode" : "free-mode"} onClick={() => onKindChange("free")}>
              Free
            </button>
            <button className={recommendationKind === "paid" ? "active paid-mode" : "paid-mode"} onClick={() => onKindChange("paid")}>
              Paid
            </button>
          </div>
          {recommendationKind === "paid" && !showAll ? (
            <div className="max-price-filter" role="group" aria-label="Max price filter">
              <span className="max-price-label">Max price</span>
              <div className="segmented-control max-price-options">
                {MAX_PRICE_OPTIONS.map((option) => (
                  <button
                    key={option.label}
                    className={maxPaidPriceCents === option.value ? "active" : ""}
                    onClick={() => onMaxPaidPriceChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {showAll ? (
            <RecommendationsList candidates={activeCandidates} onBack={() => setShowAll(false)} />
          ) : (
            <>
              <div className="reel-stage" style={{ "--marker-left": `${markerPct}%` } as CSSProperties}>
                <div className="reel-marker" aria-hidden="true" />
                <div
                  className={isSpinning ? "game-reel spinning" : "game-reel"}
                  style={{ "--reel-offset": `${reelOffset}px`, "--reel-duration": `${durationMs}ms` } as CSSProperties}
                >
                  {reelItems.map((game, index) => (
                    <div className="reel-card" key={`${game.appId}-${index}`}>
                      <img src={steamHeaderImage(game.appId)} alt="" loading="lazy" />
                      <span>{game.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button className="primary-button" onClick={(event) => onSpin(reelStageWidth(event.currentTarget))} disabled={isSpinning || activeCandidates.length === 0}>
                {isSpinning ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Shuffle size={18} aria-hidden="true" />}
                Spin wildcard
              </button>
              <button className="ghost-button see-all-button" onClick={handleSeeAll} disabled={activeCandidates.length === 0}>
                See all {activeCandidates.length} games
              </button>
              {displayedPick ? (
                <RecommendationCard
                  kind={recommendationKind}
                  game={displayedPick}
                  count={recommendationKind === "free" ? freeCount : paidCount}
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function RecommendationsList({
  candidates,
  onBack
}: {
  candidates: RecommendationGame[];
  onBack: () => void;
}) {
  return (
    <div className="recommendation-all-list">
      <button className="ghost-button back-button" onClick={onBack}>
        ← Back to spin
      </button>
      <ul>
        {candidates.map((game) => (
          <li key={game.appId}>
            <img src={steamHeaderImage(game.appId)} alt="" loading="lazy" />
            <div className="all-list-info">
              <strong>{game.name}</strong>
              <p>{game.description}</p>
              <span className={`price-pill ${game.price.status}`}>{priceInfoLabel(game.price)}</span>
            </div>
            <a
              className="icon-link"
              href={safeSteamUrl(game.steamUrl)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open on Steam"
            >
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecommendationCard({
  kind,
  game,
  count
}: {
  kind: "free" | "paid";
  game: RecommendationGame | null;
  count: number;
}) {
  return (
    <article className="recommendation-card">
      <div>
        <p className="tool-label">{kind === "free" ? "Free pick" : "Paid pick"}</p>
        {game ? (
          <>
            <h3>{game.name}</h3>
            <p>{game.description}</p>
          </>
        ) : (
          <>
            <h3>No pick available</h3>
            <p>{count === 0 ? "No matching Steam games are available for this mode." : "Loading recommendation."}</p>
          </>
        )}
      </div>
      <div className="recommendation-actions">
        <span className={`price-pill ${game?.price.status ?? "not-checked"}`}>{game ? priceInfoLabel(game.price) : "Unavailable"}</span>
        {game ? (
          <a className="icon-link" href={safeSteamUrl(game.steamUrl)} target="_blank" rel="noopener noreferrer" title="Open on Steam">
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function RandomPickerPanel({
  result,
  minOwners,
  priceFilter,
  candidates,
  reelItems,
  reelOffset,
  markerPct,
  durationMs,
  isSpinning,
  selectedGame,
  onMinOwnersChange,
  onPriceFilterChange,
  onSpin
}: {
  result: CompareResult;
  minOwners: number;
  priceFilter: PickerPriceFilter;
  candidates: ComparedGame[];
  reelItems: ComparedGame[];
  reelOffset: number;
  markerPct: number;
  durationMs: number;
  isSpinning: boolean;
  selectedGame: ComparedGame | null;
  onMinOwnersChange: (value: number) => void;
  onPriceFilterChange: (value: PickerPriceFilter) => void;
  onSpin: (stageWidth: number) => void;
}) {
  const reelStyle = {
    "--reel-offset": `${reelOffset}px`
  } as CSSProperties;

  return (
    <section className="tool-panel random-panel in-dialog" aria-label="Random game selector">
      <div className="tool-heading spacious">
        <span>
          <Shuffle size={17} aria-hidden="true" />
          Pick from games your compared players already own, so the group can jump into something immediately.
        </span>
      </div>
      <div className="random-reel-layout">
        <div className="reel-stage" style={{ "--marker-left": `${markerPct}%` } as CSSProperties}>
          <div className="reel-marker" aria-hidden="true" />
          <div
            className={isSpinning ? "game-reel spinning" : "game-reel"}
            style={{ ...reelStyle, "--reel-duration": `${durationMs}ms` } as CSSProperties}
          >
            {reelItems.map((game, index) => (
              <div className="reel-card" key={`${game.appId}-${index}`}>
                <img src={steamHeaderImage(game.appId)} alt="" loading="lazy" />
                <span>{game.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="random-controls">
          <label className="number-control select-control">
            <span>Owned by at least this many compared players</span>
            <select value={minOwners} onChange={(event) => onMinOwnersChange(Number(event.target.value))}>
              {Array.from({ length: result.users.length }, (_, index) => index + 1).map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented-control price-toggle" aria-label="Random price filter">
            {(["both", "free", "paid"] as PickerPriceFilter[]).map((filter) => (
              <button key={filter} className={priceFilter === filter ? "active" : ""} onClick={() => onPriceFilterChange(filter)}>
                {filter === "both" ? "Both" : filter === "free" ? "Free" : "Paid"}
              </button>
            ))}
          </div>
          <button className="primary-button" onClick={(event) => onSpin(reelStageWidth(event.currentTarget))} disabled={isSpinning || candidates.length === 0}>
            {isSpinning ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Shuffle size={18} aria-hidden="true" />}
            Spin
          </button>
          {selectedGame ? (
            <div className="winner-card">
              <p className="tool-label">Selected game</p>
              <img src={steamHeaderImage(selectedGame.appId)} alt="" />
              <strong>{selectedGame.name}</strong>
              <span>
                {selectedGame.owners.length}/{result.users.length} owners - {formatMinutes(selectedGame.totalPlaytimeMinutes)} combined
              </span>
              <a href={safeSteamUrl(selectedGame.steamUrl)} target="_blank" rel="noopener noreferrer">
                Open on Steam
              </a>
            </div>
          ) : candidates.length === 0 ? (
            <div className="tool-empty">No games match these filters.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ResultHeader({ result }: { result: CompareResult | null; isLoading: boolean }) {
  return (
    <header className="result-header">
      <div>
        <p className="eyebrow">Library Matrix</p>
        <h2>{result ? `${result.users.length} users compared` : "No comparison yet"}</h2>
      </div>
    </header>
  );
}

function UserStrip({ result }: { result: CompareResult }) {
  return (
    <div className="user-strip">
      {result.users.map((user) => (
        <a href={safeSteamUrl(user.profileUrl)} target="_blank" rel="noopener noreferrer" className="user-chip" key={user.steamId}>
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar-fallback">{initials(user.displayName)}</span>}
          <span>
            <strong>{user.displayName}</strong>
            <small>{user.visibleGameCount} games</small>
          </span>
          {user.warning ? <AlertCircle size={15} aria-label={user.warning} /> : null}
        </a>
      ))}
    </div>
  );
}

function WarningsStrip({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="warnings-strip">
      {warnings.slice(0, 3).map((warning) => (
        <span key={warning}>
          <AlertCircle size={15} aria-hidden="true" />
          {warning}
        </span>
      ))}
      {warnings.length > 3 ? <span>+{warnings.length - 3} more</span> : null}
    </div>
  );
}

function GameTable({
  games,
  users,
  userById,
  tab
}: {
  games: ComparedGame[];
  users: string[];
  userById: Map<string, CompareResult["users"][number]>;
  tab: TabKey;
}) {
  if (games.length === 0) {
    return <p className="table-empty">{tab === "free" ? "No free candidates found." : "No games in this view."}</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Game</th>
            <th>Owners</th>
            <th>Missing</th>
            <th>Combined Playtime</th>
            <th>Store Price</th>
            <th aria-label="Steam link" />
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <tr key={game.appId}>
              <td>
                <div className="game-cell">
                  <strong>{game.name}</strong>
                </div>
              </td>
              <td>
                <PresenceDots users={users} present={new Set(game.owners)} userById={userById} />
              </td>
              <td>
                <MissingList missing={game.missing} userById={userById} />
              </td>
              <td>
                <PlaytimeCell game={game} userById={userById} />
              </td>
              <td>
                <PriceCell game={game} />
              </td>
              <td>
                <a className="icon-link" href={safeSteamUrl(game.steamUrl)} target="_blank" rel="noopener noreferrer" title="Open on Steam">
                  <ExternalLink size={17} aria-hidden="true" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  totalItems,
  onPageChange
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * 15 + 1;
  const end = Math.min(page * 15, totalItems);

  return (
    <nav className="pagination-bar" aria-label="Game table pages">
      <span>
        Showing {start}-{end} of {totalItems}
      </span>
      <div>
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}>
          Previous
        </button>
        <strong>
          {page} / {totalPages}
        </strong>
        <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
          Next
        </button>
      </div>
    </nav>
  );
}

function PresenceDots({
  users,
  present,
  userById
}: {
  users: string[];
  present: Set<string>;
  userById: Map<string, CompareResult["users"][number]>;
}) {
  return (
    <div className="presence-dots">
      {users.map((steamId) => {
        const user = userById.get(steamId);
        const isPresent = present.has(steamId);
        const label = user?.displayName ?? steamId;
        return (
          <span key={steamId} className={isPresent ? "present" : ""} title={label} aria-label={label}>
            {isPresent && user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : null}
            {isPresent && !user?.avatarUrl ? initials(label) : null}
          </span>
        );
      })}
    </div>
  );
}

function MissingList({ missing, userById }: { missing: string[]; userById: Map<string, CompareResult["users"][number]> }) {
  if (missing.length === 0) return <span className="muted-text">None</span>;
  return (
    <div className="missing-list">
      {missing.slice(0, 3).map((steamId) => (
        <span key={steamId}>{userById.get(steamId)?.displayName ?? steamId}</span>
      ))}
      {missing.length > 3 ? <span>+{missing.length - 3}</span> : null}
    </div>
  );
}

function PlaytimeCell({ game, userById }: { game: ComparedGame; userById: Map<string, CompareResult["users"][number]> }) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(null);
  const details = game.owners.map((steamId) => ({
    steamId,
    name: userById.get(steamId)?.displayName ?? steamId,
    minutes: game.ownerPlaytimeMinutes[steamId] ?? 0
  }));
  const showTooltip = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const tooltipWidth = 300;
    const estimatedHeight = Math.min(240, 34 + details.length * 30);
    const hasRoomBelow = window.innerHeight - rect.bottom > estimatedHeight + 14;
    const placement = hasRoomBelow || rect.top < estimatedHeight + 14 ? "bottom" : "top";
    const top = placement === "bottom" ? rect.bottom + 8 : Math.max(10, rect.top - estimatedHeight - 8);
    const maxLeft = Math.max(10, window.innerWidth - tooltipWidth - 10);
    const left = Math.min(maxLeft, Math.max(10, rect.left));
    setTooltipPosition({ top, left, placement });
  };

  return (
    <div
      className="playtime-cell"
      ref={triggerRef}
      tabIndex={0}
      onMouseEnter={showTooltip}
      onFocus={showTooltip}
      onMouseLeave={() => setTooltipPosition(null)}
      onBlur={() => setTooltipPosition(null)}
    >
      <span>{formatMinutes(game.totalPlaytimeMinutes)}</span>
      {tooltipPosition ? (
        <div
          className={`playtime-tooltip fixed ${tooltipPosition.placement}`}
          role="tooltip"
          style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
        >
          {details.map((detail) => (
            <div key={detail.steamId}>
              <span>{detail.name}</span>
              <strong>{formatDetailedMinutes(detail.minutes)}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PriceCell({ game }: { game: ComparedGame }) {
  const discount = game.price.discountPercent ?? 0;
  return (
    <div className={`price-cell ${game.price.status}`}>
      <strong>{priceLabel(game)}</strong>
      {discount > 0 && game.price.initialFormatted ? (
        <small>
          <span>{game.price.initialFormatted}</span>
          -{discount}%
        </small>
      ) : null}
    </div>
  );
}

function sortGames(a: ComparedGame, b: ComparedGame, sortKey: SortKey) {
  if (sortKey === "name") return a.name.localeCompare(b.name);
  if (sortKey === "playtime") return b.totalPlaytimeMinutes - a.totalPlaytimeMinutes || a.name.localeCompare(b.name);
  if (sortKey === "price") return priceSortValue(a) - priceSortValue(b) || a.name.localeCompare(b.name);
  return b.owners.length - a.owners.length || b.totalPlaytimeMinutes - a.totalPlaytimeMinutes || a.name.localeCompare(b.name);
}

function priceSortValue(game: ComparedGame) {
  if (game.price.status === "free") return 0;
  if (typeof game.price.final === "number") return game.price.final;
  return Number.MAX_SAFE_INTEGER;
}

function tabCount(result: CompareResult, tab: TabKey) {
  if (tab === "common") return result.commonGames.length;
  if (tab === "free") return result.freeToAdd.length;
  return result.allGames.length;
}

function formatMinutes(minutes: number) {
  if (minutes <= 0) return "0h";
  const hours = Math.round(minutes / 60);
  return `${hours.toLocaleString()}h`;
}

function formatDetailedMinutes(minutes: number) {
  if (minutes <= 0) return "0h";
  const hours = minutes / 60;
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours).toLocaleString()}h`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function mergeProfileEntries(current: string, entries: string[]) {
  const next = normalizeProfileEntries(current);
  for (const entry of entries) {
    if (!next.includes(entry)) next.push(entry);
  }
  return next.join("\n");
}

function removeProfileEntry(current: string, entry: string) {
  return normalizeProfileEntries(current)
    .filter((profile) => profile !== entry)
    .join("\n");
}

function normalizeProfileEntries(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildReelItems<T>(games: T[], targetLength = 42) {
  if (games.length === 0) return [];
  const shuffled = shuffle(games);
  const length = Math.max(18, targetLength);
  return Array.from({ length }, (_, index) => shuffled[index % shuffled.length]);
}

function extendReelItems<T>(currentItems: T[], candidates: T[], minimumLength: number) {
  const next = currentItems.length > 0 ? [...currentItems] : buildReelItems(candidates, 44);
  while (next.length < minimumLength) {
    next.push(...buildReelItems(candidates, 44));
  }
  return next;
}

function shuffle<T>(values: T[]) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function reelStageWidth(button: HTMLButtonElement) {
  const panel = button.closest(".random-reel-layout, .recommendation-reel-panel");
  const stage = panel?.querySelector(".reel-stage");
  return stage instanceof HTMLElement ? stage.getBoundingClientRect().width : 720;
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  return (
    document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(prefix))
      ?.slice(prefix.length)
      ? decodeURIComponent(
          document.cookie
            .split(";")
            .map((cookie) => cookie.trim())
            .find((cookie) => cookie.startsWith(prefix))
            ?.slice(prefix.length) ?? ""
        )
      : null
  );
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function steamHeaderImage(appId: number) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

function priceLabel(game: ComparedGame) {
  return priceInfoLabel(game.price);
}

function priceInfoLabel(price: ComparedGame["price"]) {
  if (price.status === "free") return "Free";
  if (price.finalFormatted) return price.finalFormatted;
  if (price.status === "paid" && typeof price.final === "number") {
    return `${price.final.toLocaleString("de-DE")} ${price.currency ?? ""}`.trim();
  }
  if (price.status === "not-checked") return "Not checked";
  return "Unavailable";
}

function safeSteamUrl(url: string) {
  return /^https:\/\/(store\.steampowered\.com|steamcommunity\.com)\//i.test(url) ? url : "https://store.steampowered.com";
}

createRoot(document.getElementById("root")!).render(<App />);
