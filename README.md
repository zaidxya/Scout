# Jawlat Scout Tracker

Node + Express + PostgreSQL (Neon). English/Arabic with RTL. The dashboard (display name, photo, XP, activity log) is public;
everything else about a scout, plus managing scouts, activities and leaders, is behind the leader login.

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (Neon connection string, JWT_SECRET, first leader login).
3. `npm run dev`, then open http://localhost:3000 (leader area: /leader.html)

Tables are created/updated automatically on startup. The first leader is created from LEADER_USERNAME / LEADER_PASSWORD if no
leader exists yet; after that, add more leaders from the Leaders tab. Starter activities: Presence 5, Idea 3, Event 10.

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render: New > Web Service > pick the repo. Build command `npm install`, start command `npm start`.
3. Environment variables: DATABASE_URL, JWT_SECRET, LEADER_USERNAME, LEADER_PASSWORD, NODE_ENV=production.
