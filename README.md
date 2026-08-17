# LCA v1.21 — Pet Market + Trading + Challenge Fix

This build keeps the LCA classic dark chat layout and adds the requested pet/trading/progression fixes.

## Included
- Random weighted Pet Marketplace using the requested rarity odds: Common 40%, Uncommon 30%, Rare 20%, Epic 6%, Legendary 3%, GOD 1%.
- Five unique pets per market refresh; reroll generates a genuinely new market.
- A pet can only be purchased/owned once.
- 100 readable pet names such as `Rabbit-common` and `Fox-rare`.
- Pet equip/unequip with point, diamond, and Owner Token multipliers.
- Trading Plaza with online/offline player lists, trade requests, inventory selection, two-sided offers, values, accept/unready, selling and bidding.
- Daily/weekly/monthly challenges with visible requirements and server-side completion checks. Monthly challenges are harder and can award Diamonds and Owner Tokens.
- Achievement/badge requirements and server-side claim validation.
- Daily reward calendar with a live countdown to the next reward reset.

## Render
Build command: `npm install`
Start command: `node server.js`

The server binds to `0.0.0.0` and uses Render's `PORT` environment variable. Render documents these settings for Node web services.

## Important
Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Render Environment Variables for persistent production storage. Do not put the service-role key in the ZIP or frontend.

## ZIP contents
- `index.html`
- `server.js`
- `package.json`
- `README.md`

There is intentionally **no `public/` folder and no `data.json`** in this ZIP.
