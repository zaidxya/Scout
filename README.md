# Jawlat Scout Tracker (جولات)

A small website for tracking scouts' activity. Leaders award XP for activities; everyone can see a public dashboard.
English and Arabic (with right-to-left layout) are built in, and the look follows the Jawlat logo (burgundy and sand).

## What it does

**Public dashboard (`/`)**: no login needed
- Searchable list of scouts, ranked by XP
- Per scout: display name, profile picture, XP total and activity history

**Leader area (`/leader.html`)**: password protected
- **Scouts**: add and delete scouts, award XP from the activity list (with an optional note), undo a mistaken entry, upload a profile picture, edit details
- **Activities**: manage the activity list. Starter list: Presence +5, Idea +3, Event +10, each with an English and an Arabic name
- **Leaders**: add or remove leaders, change your own password

**Who sees what**

| Data | Public | Leaders |
|---|---|---|
| Display name, profile picture, XP, activity history | yes | yes |
| Full name, phone, join date, date of birth, address, patrol/group, guardian name and phone, medical notes, other notes | no | yes |

## Tech

Node.js 18+, Express, PostgreSQL on Neon (`pg`), plain HTML/CSS/JavaScript on the front end.
Neon is Postgres, not SQLite, which is why the app uses `pg`. Passwords are hashed with bcrypt; login uses a 12-hour httpOnly cookie.

```
server.js        Express app and all API routes
db.js            Postgres connection (Neon)
schema.sql       Tables; applied automatically on every startup
public/
  index.html     Public dashboard
  leader.html    Leader area (scouts / activities / leaders tabs)
  common.js      Language switching, API helper, shared rendering
  style.css      Theme (colors are CSS variables at the top)
  i18n/          en.json and ar.json: all interface text
  logo.jpg, favicon.png
```

## Run locally

1. Install Node.js 18 or newer.
2. `npm install`
3. Copy `.env.example` to `.env` and fill in:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Neon connection string (keep `?sslmode=require`). Use the primary read-write endpoint, not a read replica |
| `JWT_SECRET` | Long random string. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `LEADER_USERNAME`, `LEADER_PASSWORD` | First leader account, created on startup only if no leader exists yet |
| `PORT` | Optional, defaults to 3000 |
| `NODE_ENV` | Set to `production` on Render (makes the login cookie HTTPS-only) |

4. `npm run dev`, then open http://localhost:3000 (leader area: http://localhost:3000/leader.html).

Tables are created and updated automatically, so updating the code never needs a manual migration.

## Deploy on Render

1. Push the project to GitHub (`.env` is git-ignored; never commit it).
2. Render: **New > Web Service**, pick the repo. Build command `npm install`, start command `npm start`.
3. Add the environment variables above, with `NODE_ENV=production`.
4. Use a separate Neon branch for local testing so test scouts don't appear on the live dashboard.

The free Render tier sleeps when idle, so the first visit after a quiet spell can take about 30 seconds. Data lives in Neon, so it is safe either way.

## API summary

- **Public:** `GET /api/scouts`, `GET /api/scouts/:id`, `GET /api/scouts/:id/photo`
- **Auth:** `POST /api/login`, `POST /api/logout`, `GET /api/me`, `PUT /api/me/password`
- **Leader only:**
  - Scouts: `POST /api/scouts`, `PUT /api/scouts/:id`, `DELETE /api/scouts/:id`, `GET /api/leader/scouts/:id` (private details), `PUT` and `DELETE /api/scouts/:id/photo`
  - XP: `POST /api/scouts/:id/xp`, `DELETE /api/xp/:id`
  - Activities: `GET`, `POST`, `DELETE /api/activities[/:id]`
  - Leaders: `GET`, `POST`, `DELETE /api/leaders[/:id]`

## Good to know

- Scouts don't have logins; leaders create and manage them. Scout names don't have to be unique.
- A scout's total XP is the sum of their activity history, so every award can be traced and undone.
- Each XP entry stores the activity's name and XP at award time, so editing or deleting an activity later doesn't change past records.
- Photos are cropped square, shrunk to 256px in the browser, and stored in the database.
- Login attempts are limited to 10 per 15 minutes per IP (kept in memory, so it resets on restart).
- There is no "forgot password" flow yet. Another leader can remove and re-add the account, or you can delete the row in Neon's SQL Editor.
- The public page shows children's names and photos to anyone with the link. Consider guardian consent and using first names or nicknames as the display name.

## Customizing

- **Colors:** edit the variables at the top of `public/style.css`.
- **Interface text:** edit `public/i18n/en.json` and `ar.json` (keep the same keys in both). A new language needs a new JSON file plus a small change in `common.js`.
- **Activities:** change them from the Activities tab, not in code.

## Troubleshooting

- `DATABASE_URL and JWT_SECRET are required`: `.env` is missing or not in the project folder.
- `cannot execute CREATE TABLE in a read-only transaction`: the connection string points at a read replica or read-only branch. Copy the string for the primary compute from Neon's **Connect** dialog.
- Forgot the first leader's password: run `DELETE FROM leaders;` in Neon's SQL Editor and restart. A new leader is created from `.env`.
- Port 3000 is in use: set `PORT=3001` in `.env`.
