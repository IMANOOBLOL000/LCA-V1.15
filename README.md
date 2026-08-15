# LCA — Lucien's Chatting App (Stable Rebuild)

This build is the stable LCA feature-pack rebuild with the previous LCA-style layout and the requested major features, including:

- Home, UPDATE LOG, and Rules
- Servers, voice servers, friends, DMs, roles, reports, moderation, and owner controls
- Points, Time, Diamonds, and Owner Tokens
- Passive Time earning: 1 Time per active minute
- Time exchange: 5 Time → 1 Diamond; 10 Time → 1 Owner Token
- Owner-only unlimited grants for Time, Diamonds, Points, and Owner Tokens; blank username targets the owner account
- Points Shop, Diamond Shop, Owners Shop, and PD Exchange
- Achievements, daily rewards, daily/weekly/monthly challenges
- Pet Marketplace and Legendary Pet Roll
- Trading plaza/listings/bidding
- Polls, voice record / voice-to-text UI, message reactions/replies/bookmarks, search, reminders, scheduled messages, and more
- Supabase persistence when the Render environment variables are configured

## Render settings

**Build Command**
```text
npm install
```

**Start Command**
```text
node server.js
```

No `public/` folder is required. `index.html` is intentionally at the repository root and `server.js` serves it directly.

## Important deployment fix

The stable server does **not** use the Express wildcard route `app.get("*")`. That route can trigger the `path-to-regexp` error shown by Render (`Missing parameter name at index 1: *`) with newer Express/path-to-regexp combinations. Static files are served from the repository root instead.

## Supabase environment variables

Set these in Render if using Supabase persistence:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OWNER_USERNAME` (optional; defaults to `CEOIMANOOB`)
- `OWNER_PASSWORD` (optional; defaults to the existing owner password)

Do not upload `node_modules` or `data.json` with this ZIP.
