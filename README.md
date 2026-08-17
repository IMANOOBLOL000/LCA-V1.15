# LCA v1.20 — Pet + Trading Upgrade

## Included
- Classic LCA layout and existing features
- Pet Marketplace with 100 named pets
- 5-pet daily market
- Reroll replaces the entire market immediately
- Five different rarities per market refresh (no repeated rarity slots)
- Pet names use readable names such as `Rabbit-rare`
- Pet images are embedded as SVG data images, so no `public/` folder or external image host is required
- Pet guide containing all 100 pets, images, values, and multipliers
- Equip up to 3 pets
- Point multipliers on all pet rarities
- Diamond multipliers from Rare through GOD
- Owner Token multipliers from Legendary through GOD
- Legendary Pet Roll
- Trading Plaza with two-sided offers, pet values, accept/unready, decline, requests, listings, and diamond purchases
- Existing achievements, daily rewards, challenges, voice tools, social tools, and leaderboards
- Existing LCA authentication/session restoration preserved

## Pet rarity prices
- Common: 3 Owner Tokens or 60 Diamonds
- Uncommon: 5 Owner Tokens or 100 Diamonds
- Rare: 10 Owner Tokens or 200 Diamonds
- Epic: 25 Owner Tokens or 500 Diamonds
- Legendary: 50 Owner Tokens or 1,000 Diamonds
- GOD: 250 Owner Tokens or 5,000 Diamonds

## Trading
Trading uses a two-sided offer flow: both players add pets, see pet values and total offer values, then both accept. A trade only completes after both sides accept and the server verifies that every offered pet is still owned.

## Render
Build command:
```
npm install
```
Start command:
```
node server.js
```

The project intentionally does **not** contain a `public/` folder or `data.json`. `index.html` is served directly from the repository root.

## Validation
- `node --check server.js` passes.
- All inline browser JavaScript blocks pass Node syntax validation.
- No Express wildcard route is used for the static fallback, avoiding the previous `Missing parameter name at index 1: *` crash.
