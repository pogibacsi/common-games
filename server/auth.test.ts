import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionCookie, parseSteamClaimedId, verifySessionValue } from "./auth.js";
import type { SteamAuthUser } from "../shared/types.js";

const user: SteamAuthUser = {
  steamId: "76561198000000000",
  displayName: "Test User",
  profileUrl: "https://steamcommunity.com/profiles/76561198000000000",
  avatarUrl: "https://avatars.example/test.jpg"
};

describe("parseSteamClaimedId", () => {
  it("extracts Steam64 IDs from Steam OpenID claimed IDs", () => {
    expect(parseSteamClaimedId("https://steamcommunity.com/openid/id/76561198000000000")).toBe("76561198000000000");
  });

  it("rejects malformed or non-Steam claimed IDs", () => {
    expect(() => parseSteamClaimedId("https://example.com/openid/id/76561198000000000")).toThrow();
    expect(() => parseSteamClaimedId("https://steamcommunity.com/openid/id/not-a-steamid")).toThrow();
  });
});

describe("signed sessions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("verifies a signed session cookie value", () => {
    const cookie = createSessionCookie(user, "secret", false);
    const value = cookie.match(/^scg_session=([^;]+)/)?.[1] ?? "";

    expect(verifySessionValue(value, "secret")).toEqual(user);
  });

  it("rejects tampered signed session values", () => {
    const cookie = createSessionCookie(user, "secret", false);
    const value = cookie.match(/^scg_session=([^;]+)/)?.[1] ?? "";

    expect(verifySessionValue(`${value}tampered`, "secret")).toBeNull();
  });

  it("rejects expired signed session values", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cookie = createSessionCookie(user, "secret", false);
    const value = cookie.match(/^scg_session=([^;]+)/)?.[1] ?? "";

    vi.setSystemTime(new Date("2026-02-15T00:00:00Z"));
    expect(verifySessionValue(value, "secret")).toBeNull();
  });
});
