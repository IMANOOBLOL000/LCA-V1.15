# LCA v1.17 Stable Full Fix

This build is intentionally **flat**: there is no `public/` folder.

Files:
- `index.html`
- `server.js`
- `package.json`
- `README.md`

Render:
- Build Command: `npm install`
- Start Command: `node server.js`
- Root Directory: leave blank unless the repository itself is inside a subfolder.

Important stability fixes:
- Serves the root `index.html` directly; no dependency on `public/index.html`.
- Uses a signed session cookie/token so normal page reloads do not force a login screen.
- Removes the client error handler that incorrectly redirected every JavaScript error to login.
- Uses one modal system with an X close button.
- Owner grants support Time, Points, Diamonds, and Owner Tokens. Blank username means yourself.
- Time passively increases at 1 per active minute.
- Exchange rates: 5 Time = 1 Diamond; 10 Time = 1 Owner Token.
- Create Server and Create Voice Server are separate working controls.
- Polls use separate question/answer boxes.
- Shops are grouped together.
- Includes achievements, daily rewards, rotating challenges, pets, voice options, and trading-plaza entry points.

This is a stable standalone rebuild. For permanent multi-instance database persistence, connect the API layer to your Supabase project rather than relying on the in-memory demo store.
