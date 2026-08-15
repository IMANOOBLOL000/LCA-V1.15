# LCA v1.16 — Clean Rebuild

This is a clean rebuild of the LCA app foundation.

## Deployment
Build command:
`npm install`

Start command:
`npm start`

The app listens on Render's `PORT` and `0.0.0.0`.

## Authentication
Sessions are restored before the login UI is shown, preventing a login flash on reload.

## Currency
- 1 active minute = 1 Time
- 5 Time = 1 Diamond
- 10 Time = 1 Owner Token
- Owner can grant unlimited Time, Points, Diamonds, and Owner Tokens.
- Blank grant username means the Owner's own account.

No `data.json` is required by this rebuild.
