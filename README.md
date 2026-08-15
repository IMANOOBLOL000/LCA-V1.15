# LCA v1.16 — Stable Rebuild

This rebuild intentionally uses the older LCA layout: dark blue top bar, fixed left navigation, center chat/content area, and right People panel.

## Files
- `index.html` — complete UI and client logic
- `server.js` — Express server; serves `index.html` from the project root
- `package.json` — Node/Express setup
- `README.md` — deployment notes

**No `public/` folder. No `data.json`.**

## Render
Use:
- Build Command: `npm install`
- Start Command: `node server.js`

Do not use `node src/server.js`, `node /opt/render/project/src/server.js`, or a `public/index.html` path.

The server binds to `0.0.0.0` and uses Render's `PORT`.

## Included
- Older LCA navigation/layout
- Home, UPDATE LOG, Rules, Introduction
- Server + Voice Server creation
- Server Owner concept and owner tools
- Points, Time, Diamonds, Owner Tokens
- Passive Time/Points grind (1 per active minute)
- PD exchange: 5 Time -> 1 Diamond; 10 Time -> 1 Owner Token
- Owner unlimited giving; blank username means yourself
- Give Time, Points, Diamonds, Owner Tokens
- Currency help button
- Shops category
- Achievements (100)
- Daily Rewards calendar
- Daily/Weekly/Monthly challenge pools (100 each)
- Pet Marketplace with 100 pets and rarity pricing
- Legendary Pet Roll
- Trading Plaza foundation
- Polls/mic foundations and common navigation sections
- Rules + owner-only UPDATE LOG
- Audit log
- Login persistence with no login-page flash on reload

## Important
This is a stable front-end rebuild using browser localStorage for demo persistence. It does not replace a real multi-user Supabase backend. For production multi-user persistence, connect the same UI/API to Supabase after the stable deployment is verified.
