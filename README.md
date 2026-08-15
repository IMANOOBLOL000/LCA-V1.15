# LCA v1.19 — Classic Full Feature Build

This build keeps the classic LCA layout and restores the full feature pack while fixing the authentication bug that caused feature buttons to say “Please log in again.”

## Included
- Classic LCA chat layout, Home, UPDATE LOG, Rules, servers, friends, profiles, reports, moderation and owner tools
- Persistent session restoration without a login-page flash on reload
- 100 achievements with badges and categories
- Daily Rewards calendar
- 100 daily + 100 weekly + 100 monthly rotating challenges
- Mic options: Voice Record and Voice-to-Text
- Scheduled messages, drafts, reminders, translation/tools already in the feature hub
- 100-pet marketplace with 5 daily pets and six rarities
- Pet rerolls and Legendary Pet Roll
- Trading Plaza with selling, bidding, and direct pet trading
- Leaderboards, levels, XP, status and following
- Points, Time, Diamonds, Owner Tokens and currency help
- Passive Time: 1 Time per active minute
- 5 Time = 1 Diamond
- 10 Time = 1 Owner Token
- Owner-only unlimited grants; blank username means yourself
- Server Owner rank system and saved rank licenses
- Clean Points Shop, Diamond Shop and Owners Shop

## Render
Build Command:
`npm install`

Start Command:
`node server.js`

No `public/` folder is required. No `data.json` file is included in the ZIP.

## Supabase
Set these Render environment variables if using Supabase persistence:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OWNER_USERNAME` (optional; defaults to `CEOIMANOOB`)
- `OWNER_PASSWORD` (optional; defaults to the existing owner password)

The app stores its complete state in the `lca_state` table/row used by the existing LCA setup.
