# LCA v1.16.1 — Blank Screen / Render Fix

Upload the contents of this folder to the root of the Render/GitHub project.

Required files:
- server.js
- package.json
- index.html
- public/index.html

Render:
- Build Command: npm install
- Start Command: node server.js

The server listens on process.env.PORT and 0.0.0.0.
The frontend is served from either /public/index.html or the root index.html.
A JavaScript failure can no longer leave a completely blank loading screen.
