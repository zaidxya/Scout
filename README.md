# Scout Tracker

Node + Express + PostgreSQL (Neon). English/Arabic with RTL. Public dashboard; admin area behind a password.

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (Neon connection string, JWT_SECRET, first leader login).
3. `npm run dev` then open http://localhost:3000 (admin area: /leader.html)

The tables are created automatically on startup, and the first leader is created from LEADER_USERNAME / LEADER_PASSWORD if no leader exists yet.

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render: New > Web Service > pick the repo. Build command `npm install`, start command `npm start`.
3. Environment variables: DATABASE_URL, JWT_SECRET, LEADER_USERNAME, LEADER_PASSWORD, NODE_ENV=production.
