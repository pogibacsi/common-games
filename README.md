# Steam Common Games

Local web app for comparing Steam libraries across friends.

## Setup

1. Copy `.env.example` to `.env`.
2. Add your Steam Web API key:

```env
STEAM_API_KEY=your_key_here
SESSION_SECRET=generate_a_long_random_value_here
```

3. Install and run:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`.

## Notes

- Steam only returns libraries that are visible to the API caller.
- The app supports Steam64 IDs, `/profiles/{id}` links, `/id/{vanity}` links, and raw vanity names.
- Steam login uses Steam OpenID to identify the signed-in account. The friend picker still depends on Steam Web API friend-list visibility, so manual entry remains available when Steam does not return friends.
- For local dev, Steam auth defaults to `http://127.0.0.1:5174` for the API callback and accepts localhost frontend origins. Set `STEAM_AUTH_ORIGIN` and `APP_CLIENT_ORIGIN` when hosting it elsewhere.
- Free-game detection is best effort: it combines Steam owned-game data with `include_played_free_games` and a public Steam Store details check.
- Prices are checked against an EUR Steam storefront and displayed in the exact currency Steam returns rather than converting it.
