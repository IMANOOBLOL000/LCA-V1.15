# LCA — Supabase Permanent Storage Update

This version stores the LCA database in Supabase instead of relying on Render's local filesystem.

## 1. Run the SQL

Open your Supabase project and go to **SQL Editor**. Paste the contents of `SUPABASE_SETUP.sql` and click **Run**.

## 2. Add Render environment variables

In Render → your LCA service → Environment, add:

`SUPABASE_URL`

Value:
`https://eemdkffmbwtlbtpksnep.supabase.co`

`SUPABASE_SERVICE_ROLE_KEY`

Value:
Your Supabase **service_role** secret key from Project Settings → API.

**Do NOT use the publishable key as the service-role key. Never put the service-role key in `index.html` or GitHub.**

## 3. Deploy

Replace `server.js`, `index.html`, `package.json`, and `README.md` in GitHub. Keep your existing `data.json` if you have one.

On the first startup, if the Supabase `lca_state` row does not exist, the server imports the existing local `data.json` when available and writes it to Supabase. After that, Supabase is the permanent source of truth.

## 4. What this fixes

- Accounts survive Render redeploys/restarts.
- Messages survive Render redeploys/restarts.
- Servers and memberships survive.
- Friends, profiles, backgrounds, points, bookmarks, roles, and other stored LCA state survive.
- Login sessions are stored in Supabase too, so a normal Render restart does not automatically log everyone out.

## Important security note

The service-role key has full database access. Put it only in Render Environment Variables. Do not commit it to GitHub and do not put it in browser JavaScript.
