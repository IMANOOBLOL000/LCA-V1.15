# LCA v1.18 — Stable Old-Design Fix

This build keeps the classic LCA layout (Servers / Social / Shops / Others, Home, UPDATE LOG, Rules, People panel, profile menu) and fixes the shop/currency/session problems.

## Render

**Build Command**

```text
npm install
```

**Start Command**

```text
node server.js
```

The app listens on Render's `PORT` and `0.0.0.0`.

## Important fixes

- Classic LCA design restored.
- No `public/` folder is required.
- No `data.json` is included in this download.
- Supabase-backed state/session persistence remains supported through the existing environment variables.
- Login/session restoration retries before showing the login screen.
- Login screen is hidden during startup so a normal reload does not flash the login page.
- Currency bar shows Points, Time, Owner Tokens, Diamonds, plus a currency help button.
- Passive Time: 1 Time per minute while the session is active.
- Time → Diamond: 5 Time = 1 Diamond.
- Time → Owner Token: 10 Time = 1 Owner Token.
- Owner can grant Time, Points, Diamonds, and Owner Tokens; blank target means the owner account.
- Shops are separated into Points Shop, Diamond Shop, Owners Shop, and PD Exchange.
- Owners Shop has real Buy & Grant buttons for MOD, ADMIN, SERVER ADMIN, and SERVER OWNER licenses.
- Server creators remain server owners for their own server.
- Existing Rules, UPDATE LOG, reports, moderation, profile, friends, server, and chat features remain in the classic interface.

## Environment

For persistent production state, keep the same Supabase environment variables already used by the LCA service:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OWNER_USERNAME` (optional; defaults to `CEOIMANOOB`)
- `OWNER_PASSWORD` (optional; defaults to the existing owner password)

If Supabase is not configured, the server can use its hidden local `.lca-db.json` fallback. That file is created automatically and is intentionally not included in the ZIP.
