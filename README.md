# Jawlat Scout Tracker (جولات)

A small website for tracking scouts' activity. Leaders award XP for activities; everyone can see a public dashboard.
English and Arabic are built in, and the look follows the Jawlat logo (burgundy and sand). **Arabic is the default language, and the layout stays right-to-left in both languages** (switching language only changes the text).

## What it does

**Public dashboard (`/`)**: no login needed
- Searchable list of scouts, ordered by role priority (see below), then XP
- Per scout: display name, profile picture, roles (colored chips), XP total and activity history

**Troops**: the site can hold several troops (a troop is a group of scouts of similar age, e.g. Rovers). Every scout and every leader account belongs to one troop. The public dashboard shows one troop at a time (a picker appears when there is more than one; the last choice is remembered). Leaders and admins only ever see and change the scouts of their own troop; the super admin sees all troops, picks the troop when adding scouts and leaders, and manages the troops themselves in the **Troops** tab. **Activities and roles/tags are shared by all troops and can only be changed by the super admin** (everyone else sees the activity list read-only). Patrols (smaller groups inside a troop) are not built yet; the troop layer is designed so they can be added underneath. Existing databases are upgraded automatically: everything that already exists is moved into a first troop called "Rovers" (rename it in the Troops tab).

**Leaders are scouts too**: every leader account has its own scout profile that appears in the public list, earns XP and can have roles and tags like any scout. Adding a leader creates the profile (optional display name, defaults to the username). Existing leaders get a profile automatically on the next startup. Removing a leader keeps their scout profile; a leader's profile can't be deleted while the leader exists.

**Leader area (`/leader.html`)**: password protected
- **Search and filter**: the scout list has a search box (name, full name, phone, role and tag names in both languages; Arabic spelling variants and diacritics are ignored) plus role and tag filters
- **Roles & tags tab**: create colored roles with a priority (higher priority = listed first, for everyone) (e.g. Patrol leader) and tags (e.g. First aid) with English and Arabic names. Assign them from a scout's page. Roles are shown on the public dashboard (and searchable there); tags are visible to leaders only
- **Scouts**: add and delete scouts, award XP from the activity list (with an optional note), undo a mistaken entry, upload a profile picture, edit details
- **Activities**: the shared activity list (everyone reads it; only the super admin changes it). Starter list: Presence +5, Idea +3, Event +10, each with an English and an Arabic name. Use a negative value (for example -5) for activities that deduct XP
- **Leaders**: add or remove leaders, change your own password
- **Activity log (سجل النشاط)**: the latest 300 leader actions (logins, scout changes, XP awarded or undone, activity and leader changes), newest first

The header shows the logged-in leader's username next to the "القيادة" title. Delete and undo actions ask for confirmation in a styled popup (not the browser's default box).

**Who sees what**

| Data | Public | Leaders |
|---|---|---|
| Display name, profile picture, roles, XP, activity history | yes | yes |
| Tags | no | yes |
| Full name, phone, join date, date of birth, address, guardian name and phone, medical notes, other notes | no | yes |

## Account levels and password reset

| Level | Can add/delete leaders | Can reset others' passwords |
|---|---|---|
| **Super admin** (exactly one: the account created from `LEADER_USERNAME`) | yes, in any troop, including admins | yes, for admins and leaders |
| **Admin** (created by the super admin) | leaders of their own troop only | leaders of their own troop only |
| **Leader** | no (the Leaders tab only shows "change my password") | no |

The super admin can't be deleted, and nobody can delete their own account. Every check is enforced on the server, not only hidden in the page.
Existing databases are upgraded automatically on startup: the `LEADER_USERNAME` account (otherwise the oldest account) becomes the super admin and everyone else stays a leader.

**Resetting a password**
- A leader or admin who forgot theirs: the super admin (or an admin, for leaders) opens the **Leaders** tab and presses *Reset password* next to the account.
- The super admin forgot theirs: nobody can reset it from the website. Use `reset-password.js`:
  1. On your computer, in the project folder with `.env` filled in (same `DATABASE_URL` as the live site), run `node reset-password.js <username> <new-password>` (8+ characters).
  2. No local setup? Run `node -e "console.log(require('bcryptjs').hashSync('NEW_PASSWORD', 12))"` and in Neon's SQL Editor run `UPDATE leaders SET password_hash = '<that hash>' WHERE username = 'boss';`.
- Someone already logged in stays logged in for up to 12 hours after a reset; change `JWT_SECRET` on Render to log everyone out at once.

## Tech

Node.js 18+, Express, PostgreSQL on Neon (`pg`), `morgan` for request logging, plain HTML/CSS/JavaScript on the front end.
Neon is Postgres, not SQLite, which is why the app uses `pg`. Passwords are hashed with bcrypt; login uses a 12-hour httpOnly cookie.

```
server.js        Express app, all API routes, audit logging, morgan request logs
db.js            Postgres connection (Neon)
schema.sql       Tables; applied automatically on every startup
public/
  index.html     Public dashboard
  leader.html    Leader area (scouts / activities / leaders tabs)
  common.js      Language switching, API helper, shared rendering, confirmBox() popup
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

- **Public:** `GET /api/scouts`, `GET /api/scouts/:id` (both include the scout's roles, never tags), `GET /api/scouts/:id/photo`
- **Auth:** `POST /api/login`, `POST /api/logout`, `GET /api/me`, `PUT /api/me/password`
- **Leader only:**
  - Scouts: `POST /api/scouts`, `PUT /api/scouts/:id`, `DELETE /api/scouts/:id`, `GET /api/leader/scouts/:id` (private details), `PUT` and `DELETE /api/scouts/:id/photo`
  - XP: `POST /api/scouts/:id/xp`, `DELETE /api/xp/:id`
  - Activities: `GET`, `POST`, `DELETE /api/activities[/:id]`
  - Leaders: `GET`, `POST`, `DELETE /api/leaders[/:id]`
  - Search list: `GET /api/leader/scouts` (private search fields, leader flag, role/tag ids)
  - Roles and tags: `GET`, `POST`, `PUT` (color, priority), `DELETE /api/labels[/:id]`, `PUT /api/scouts/:id/labels` (replaces a scout's full set)
  - Activity log: `GET /api/audit` (latest 300 entries)

## Logs and usage tracking

- **Render dashboard:** open the service, then the **Logs** tab for app output, and the **Metrics** tab for CPU, memory, request counts and latency.
- **Request logs:** `morgan` prints one line per page and API request (skipping images, CSS/JS and photos), so they appear in Render's Logs tab even on the free tier. Render's own per-request HTTP logs need a paid workspace. Failed logins are logged with the username tried and the IP.
- **Leader activity log:** stored in the `audit_log` table (leader username, action, scout or activity name, time). It never stores passwords or private scout details. If a leader is deleted, their past entries stay, with their username.
- **Not added yet:** visitor analytics for the public page. Privacy-friendly options are Plausible, Umami, GoatCounter or Cloudflare Web Analytics (one script tag in `index.html`). Scouts have no logins, so per-user tracking isn't possible there.

## Good to know

- Scouts don't have logins; leaders create and manage them. Scout names don't have to be unique.
- A scout's total XP is the sum of their activity history, so every award can be traced and undone.
- Each XP entry stores the activity's name and XP at award time, so editing or deleting an activity later doesn't change past records.
- The XP unit is written "XP" in the Arabic text too.
- Photos are cropped square, shrunk to 256px in the browser, and stored in the database.
- Login attempts are limited to 10 per 15 minutes per IP (kept in memory, so it resets on restart).
- **Forgot a password?** See "Account levels and password reset" below.
- The public page shows children's names and photos to anyone with the link. Consider guardian consent and using first names or nicknames as the display name.

## Recent changes (handoff notes)

For picking this project up in a new conversation. Full detail is in `CHANGES.md`.

- Arabic is the default and the layout stays RTL in both languages. To make it LTR in both, change `dir = 'rtl'` in `common.js`.
- Arabic wording: leader area is "القيادة", the dashboard link is "قائمة الكشاف", logout is "تسجيل خروج", and the XP unit is "XP". The English labels were not changed (still "Dashboard", "Leader area").
- Header: the leader's username sits next to "القيادة" with a thin divider on its left.
- Confirmation popup (`confirmBox()` in `common.js`, styles at the end of `style.css`) replaces `confirm()` in the four delete/undo actions. Cancel is focused by default; Esc and the backdrop cancel.
- Request logging and the activity log tab were added (see above). Run `npm install` after pulling these changes so `morgan` is installed.
- None of this has been run against a real database yet. Only syntax checks were done, so test on a separate Neon branch first. After deploying, hard refresh (Ctrl+Shift+R) to avoid cached pages.

**Latest round (leaders as scouts, roles/tags, search):** new tables `labels` and `scout_labels`, new column `leaders.scout_id` (all applied automatically on startup). New text keys are in both JSON files. Like the earlier changes, this was syntax-checked only, so test on a separate Neon branch first.

Ideas not done yet: a display name for leaders (the header shows the username), English wording to match the Arabic changes ("Scout list", "Leadership"), and visitor analytics.

## Customizing

- **Colors:** edit the variables at the top of `public/style.css`.
- **Interface text:** edit `public/i18n/en.json` and `ar.json` (keep the same keys in both). A new language needs a new JSON file plus a small change in `common.js`.
- **Activities:** change them from the Activities tab, not in code.

## Troubleshooting

- `DATABASE_URL and JWT_SECRET are required`: `.env` is missing or not in the project folder.
- `cannot execute CREATE TABLE in a read-only transaction`: the connection string points at a read replica or read-only branch. Copy the string for the primary compute from Neon's **Connect** dialog.
- Forgot the first leader's password: run `DELETE FROM leaders;` in Neon's SQL Editor and restart. A new leader is created from `.env`.
- Port 3000 is in use: set `PORT=3001` in `.env`.

### Keeping the site awake (Render free plan)
Free Render services go to sleep after ~15 minutes without visitors, and the next visit waits 30-60 seconds while it wakes up. To avoid that, point a free uptime monitor (e.g. UptimeRobot or cron-job.org) at `https://YOUR-SITE.onrender.com/healthz` every 10 minutes. The Neon database also sleeps when idle; the first query after a nap can take a second or two.
