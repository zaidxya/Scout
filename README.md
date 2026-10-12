# Scout Troop 2 Scout Tracker

A small website for tracking scouts' activity. Leaders award XP for activities; everyone can see a public dashboard.
English and Arabic are built in, and the look follows the troop logo. **Arabic is the default language, and the layout stays right-to-left in both languages** (switching language only changes the text).

`CHANGES.md` is the full history of every change, round by round. This README describes how the site works today.

## Working on this project (notes for the next conversation)

The project is handed over as a zip in a new conversation each time, so these Markdown files are the only handoff. With every change:
1. **Update the docs as part of the change:** add a section to `CHANGES.md` (what changed, why, files touched, new columns/routes/text keys) and fix anything in this README that the change makes outdated.
2. **Don't run tests unless asked:** no database, server, browser previews or test scripts. The owner tests on the site. Apply only the requested change, and check it against the related code by reading it (callers, element ids, text keys in both language files, server routes and fields).
3. **Save the whole project as a numbered zip** after each round, without `node_modules`, in the working folder (`Desktopscout-build`) next to the earlier ones: `scout-app-troops_NN (word).zip`, one number higher than the newest zip there, with one word in brackets that best describes that round's change (e.g. `scout-app-troops_35 (basket).zip`). The folder holds only the zips: extract the newest one to work on it. Builds up to 34 have no word.
4. **Frontend changes:** use the frontend design skill if it is available. Keep the look of the existing pages (CSS variables, cards, the RTL layout) and keep things simple.

## What it does

**Public dashboard (`/`)**: no login needed
- Searchable list of scouts of one troop, grouped by patrol, ordered by role priority (see below), then XP
- Per scout: display name, profile picture, roles (colored chips), XP total and activity history (including the note written with each award)
- A troop picker when there is more than one troop (the visitor's last choice is remembered)
- **Signed in?** A scout's page also shows their **private details** (full name, phone, join date, date of birth, address, guardian, medical and other notes, tags) as plain read-only text, with a link to the leader area, where all editing happens. Every signed-in account (admin, mod, leader, super admin) sees it for scouts of any troop; the edit button only appears where the account may edit (its own troop; any troop for the super admin and leaders). Visitors never see it.

**Depot (`/depot.html`)**: the shared inventory (item name in both languages, quantity, notes). Anyone can view and search it. Each item shows its quantity in a labelled box (red "out of stock" at 0), and the count above the list reads "Items listed: N" ("n of N" while searching). Admins, leaders and the super admin edit and remove items: rows stay read-only, and an **Edit** button opens one row at a time with Save / Cancel / Delete. Only the super admin adds items, through the **+ Add item** button (the form stays closed until it is needed).
**Reservations (by troop, with a basket):** every signed-in account (admins, mods, super admin) books depot items **for a troop**: admins and mods always for their own troop (every account belongs to one), the super admin and leaders pick the troop in the basket (defaults to the troop last used in the leader area, for a leader else their own). Items are put in the **reservation basket** with **Add to basket** (the button then reads "✓ In basket"; pressing it again takes the item out). The basket opens above the search box: who it is for, one from / to window for the whole basket, one line per item with its quantity, how many are free in that window (red when asking for more) and a × to remove it, an optional note, **Reserve the basket** and **Empty basket**. The basket (items, window, note) is kept in the browser, separately for each account (another account signing in on the same browser starts with an empty basket), until it is booked or emptied; a floating "Basket (N)" button brings it back into view after scrolling. The whole basket is booked at once or not at all: the server refuses it if any item would go over its quantity at any moment of the window (every overlapping booking counts). Windows are at most 60 days. Items show "Reserved now: N" while a booking is running, and an **Upcoming reservations** list under the inventory shows every booking that isn't over yet: the troop, the items × quantities, the window, "Reserved by {display name}" (the name on the booker's scout profile) and the note (your own troop's bookings have a coloured edge). A booking can be cancelled (whole) by the one who made it, by the admins of its troop, and by the super admin and leaders. Reservations are leader-only (visitors don't see them) and are written to the troop's activity log. A **Past reservations** section under it (closed until opened) is the reservation history: bookings that are over, latest first, up to 200, with the same details. Finished bookings are never deleted; a *cancelled* booking is removed for good and only appears in the activity log. Deleting a depot item removes it from every booking (a booking left empty is removed).

**Leader area (`/leader.html`)**: sign-in required. Tabs (what each account level sees is listed under "Account levels" below):
- **Scouts**: add scouts; edit their details; upload a profile picture; award XP from the troop's activity list or with a **Custom…** award (its own title and XP, a negative value deducts; with a date and an optional note) and undo a mistaken entry; put them in a patrol; give them roles and tags; **deactivate** them when they leave the movement (hidden from the dashboard and the default list, history kept, can be reactivated via "Show inactive"); **promote** them to another troop (XP and history go with them; their patrol, roles and tags are removed because those belong to the old troop). Only the super admin can delete a scout permanently. The search box matches name, full name, phone, patrol, role and tag names in both languages, ignoring Arabic spelling variants and diacritics.
- **Activities** (admins and the super admin; not leaders or mods): the troop's own activity list. Starter list: Presence +5, Idea +3, Event +10. A negative value (for example -5) deducts XP.
- **Patrols**: the troop's patrols (see "Patrols" below).
- **Attendance (الحضور)**: add a **meeting or an event** (type choice; the **title is required**) and choose its **XP for attending** (default 10) and **XP taken for not attending** (default 0); 0 = none. The list has a **search** (title, date, type) and a type filter. On a sheet each scout has two buttons, **Mark present** and **Mark absent** (pressing the lit one clears the mark; saved at once), and there are **Mark everyone present**, **Mark the rest absent** and **Clear all**. Per-scout attendance is shown as a percentage of the meetings and events held since they joined (absences don't change it). **Present** scouts get the attending XP as an entry "Attended <title>" (حضر <title>); **absent** scouts lose the absence XP as a negative entry "Absent: <title>" (غاب عن <title>); both appear in the scout's activity history and in the **leader activity log** (marking or clearing the whole sheet is one entry). Changing or clearing a mark takes its XP back and gives the new mark's; deleting the meeting/event removes everything; editing the date, title or XP values on the sheet updates entries already given (0 removes them, raising from 0 gives it to those already marked). Attendance marked before build 42 gave no XP.
- **Roles & tags**: colored roles with a priority (higher = listed first, for everyone) and tags. Roles are public; tags are leader-only. Admins and the super admin only (not leaders or mods).
- **Troops** (super admin): add, rename and delete troops, pick each troop's theme and the text next to its logo. A new troop can start empty or with a copy of another troop's activities and roles/tags.
- **Leaders** (super admin): add accounts (admin, leader or mod), delete them, reset their passwords.
- **Activity log (سجل النشاط)** (super admin): the latest 300 leader actions of the troop, newest first.

**My account (`/account.html`)**: from the header menu once signed in. Change your own username and/or password, and sign out.

**Troops**: every scout and every account belongs to one troop, except the super admin, who belongs to none. The super admin and **leaders** (who have a home troop) work in whichever troop is selected in the **troop switcher** above the tabs (the theme follows it; scouts and accounts are added to that troop; a leader starts in their home troop). Admins and mods only ever see and change their own troop. Activities, roles/tags, patrols and meetings are separate for each troop. All of this is enforced on the server.

**Leaders are scouts too**: every admin and mod account has its own scout profile that appears in the public list, earns XP and can have roles and tags. Adding an account creates the profile (optional display name, defaults to the username). Deleting an account keeps the scout profile; a profile can't be deleted, deactivated or promoted while its account exists.

**Who sees what**

| Data | Public | Leaders |
|---|---|---|
| Display name, profile picture, roles, patrol, XP, activity history and award notes | yes | yes |
| Tags, attendance, depot reservations | no | yes |
| Full name, phone, join date, date of birth, address, guardian name and phone, medical notes, other notes | no | yes |
| Deactivated scouts (including their photo) | no | yes |

## Account levels

There are four account levels (`leaders.role`: `super_admin`, `admin`, `leader`, `mod`). The level alone decides what an account may do; there are no separate permissions.

| | Super admin | Admin | Leader (قائد) | Mod (مسؤول) |
|---|---|---|---|---|
| Troop | none (all) | own | home troop, can switch | own |
| Switch between troops | yes | no | **yes** | no |
| Scouts, XP (list and custom awards), patrols, attendance | yes | yes | yes | yes (can't delete meetings) |
| Activities tab (add/delete the troop's award list) | yes | yes | **no** | no |
| Roles & tags | yes | yes | **no** | no |
| Depot: edit and remove items | yes | yes | yes | no |
| Depot: add items | yes | no | no | no |
| Reserve depot items, see reservations | yes | yes | yes | yes |
| Cancel reservations | any | its troop's, and own | any | own |
| Troops tab, delete a scout permanently | yes | no | no | no |
| Leaders tab (accounts), activity log | yes | no | no | no |

- **Super admin**: exactly one, the account created from `LEADER_USERNAME`. Belongs to no troop, has every right, can't be deleted.
- **Admin** (the default for new accounts): the everyday work in their own troop, including roles and tags.
- **Leader**: works like an admin but can jump between troops with the troop switcher, like the super admin; has no Activities, Roles & tags, Troops, Leaders or Activity log tabs (it can still award XP from the list) (and can't give roles/tags to scouts). Created by the super admin in the Leaders tab; the account belongs to a home troop (its scout profile and its place in the leaders' patrol are there).
- **Mod (مسؤول)**: the members and their activity only, and reserving depot items for their troop (and cancelling the bookings they made).

Roles (the colored chips) no longer carry permissions. `labels.permissions` stays in the database, unused. Old accounts keep their level; an account that had been given *manage_accounts* or *view_log* through a role (build 38 and before) loses that unless it is the super admin.

Existing databases are upgraded automatically on startup: the `LEADER_USERNAME` account (otherwise the oldest account) becomes the super admin. (Before build 39, old "leader" accounts were turned into admins on every startup; that step is gone, since "leader" is a real level now.)

## Sessions and passwords

- Signing in keeps you signed in until you sign out (the cookie lasts about 400 days and is renewed on every visit).
- **Changing or resetting a password signs that account out everywhere.** A reset from the Leaders tab ends all of that person's sessions at once; changing your own password in My account keeps the current browser signed in and signs out the others.
- To sign *everyone* out at once, change `JWT_SECRET` on Render.

**Resetting a password**
- Someone forgot theirs: the super admin opens the **Leaders** tab and presses *Reset password* next to the account.
- The super admin forgot theirs: nobody can reset it from the website. Use `reset-password.js`:
  1. On your computer, in the project folder with `.env` filled in (same `DATABASE_URL` as the live site), run `node reset-password.js <username> <new-password>` (8+ characters). It also works in Render's **Shell** tab, where `DATABASE_URL` is already set.
  2. No local setup? Run `node -e "console.log(require('bcryptjs').hashSync('NEW_PASSWORD', 12))"` and in Neon's SQL Editor run `UPDATE leaders SET password_hash = '<that hash>', session_v = session_v + 1 WHERE username = 'boss';`.

## Tech

Node.js 18+, Express, PostgreSQL on Neon (`pg`), `morgan` for request logging, `compression` for gzip, plain HTML/CSS/JavaScript on the front end (no build step).
Passwords are hashed with bcrypt; sessions are a signed token in an httpOnly cookie.

```
server.js          Express app, all API routes, account levels, audit logging, startup migrations
db.js              Postgres connection (Neon)
schema.sql         Tables; applied automatically on every startup
reset-password.js  Reset any account's password from the command line
public/
  index.html       Public dashboard
  leader.html      Leader area (all the tabs above)
  depot.html       Depot inventory
  account.html     My account (username, password, sign out)
  common.js        Language switching, API helper, header menu, themes, shared rendering, confirmBox() popup
  style.css        Main theme and troop themes (colors are CSS variables)
  i18n/            en.json and ar.json: all interface text (same keys in both)
  logo-*.png, favicon-v2.png
```

## Run locally

1. Install Node.js 18 or newer.
2. `npm install`
3. Copy `.env.example` to `.env` and fill in:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Neon connection string (keep `?sslmode=require`). Use the primary read-write endpoint, not a read replica |
| `JWT_SECRET` | Long random string. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `LEADER_USERNAME`, `LEADER_PASSWORD` | The super admin account, created on startup only if no account exists yet |
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

### Keeping the site awake (Render free plan)
Free Render services go to sleep after ~15 minutes without visitors, and the next visit waits 30-60 seconds while it wakes up. To avoid that, point a free uptime monitor (e.g. UptimeRobot or cron-job.org) at `https://YOUR-SITE.onrender.com/healthz` every 10 minutes. The Neon database also sleeps when idle; the first query after a nap can take a second or two.

## API summary

Every route below "Signed in" needs a session; the troop is the account's own (the super admin and leaders send `X-Troop` to pick one; an unknown value falls back to the leader's home troop). Errors come back as `{ "error": "<code>" }`, translated in the pages through `err_<code>` keys.

- **Public:** `GET /api/troops`, `GET /api/scouts?troop=` (active scouts with roles, never tags), `GET /api/scouts/:id`, `GET /api/scouts/:id/photo`, `GET /api/patrols?troop=`, `GET /api/depot`, `GET /healthz`
- **Auth:** `POST /api/login`, `POST /api/logout`, `GET /api/me`, `PUT /api/me/account` (own username and/or password)
- **Signed in:**
  - Scouts: `GET /api/leader/scouts` (search list), `GET /api/leader/scouts/:id` (private details and tags; the dashboard uses it too), `POST /api/scouts`, `PUT /api/scouts/:id`, `PUT /api/scouts/:id/active`, `PUT /api/scouts/:id/promote`, `PUT /api/scouts/:id/patrol`, `PUT` and `DELETE /api/scouts/:id/photo`, `DELETE /api/scouts/:id` (super admin)
  - XP: `POST /api/scouts/:id/xp`, `DELETE /api/xp/:id`
  - Activities: `GET`, `POST`, `DELETE /api/activities[/:id]` (not mods)
  - Roles and tags: `GET`, `POST`, `PUT`, `DELETE /api/labels[/:id]`, `PUT /api/scouts/:id/labels` (replaces a scout's full set) (admins and the super admin only)
  - Patrols: `POST`, `PUT`, `DELETE /api/patrols[/:id]`
  - Meetings: `GET`, `POST /api/meetings` (`date`, `title` (required), `kind`: `meeting` or `event`, `xp` 0-1000, `absent_xp` 0-1000), `GET`, `PUT`, `DELETE /api/meetings/:id` (delete: not mods), `PUT /api/meetings/:id/attendance[/:scoutId]` (`status`: `present`, `absent` or `none`; for everyone: all present / the rest absent / clear), `GET /api/attendance/summary`
  - Depot: `POST /api/depot` (super admin), `PUT`, `DELETE /api/depot/:id` (admins)
  - Depot reservations (bookings, per troop): `GET /api/depot/bookings` (bookings not over yet; `?past=1` for the history, latest 200, never cancellable, each with its troop, `items: [{item_id, quantity}]`, `mine`, `can_cancel`), `POST /api/depot/bookings` (`items: [{item_id, quantity}]` (1-100 items), `starts_at`, `ends_at` as ISO times, `note`, and `troop_id` for the super admin only; all or nothing: 409 `not_available` with `short: [{item_id, available}]` when an item hasn't enough), `DELETE /api/depot/bookings/:id` (the whole booking: who made it, the troop's admins, the super admin)
  - Troops: `POST`, `PUT`, `DELETE /api/troops[/:id]` (super admin)
  - Accounts: `GET`, `POST`, `DELETE /api/leaders[/:id]`, `PUT /api/leaders/:id/password` (super admin)
  - Activity log: `GET /api/audit` (super admin; latest 300 entries)

## Logs and usage tracking

- **Render dashboard:** open the service, then the **Logs** tab for app output, and the **Metrics** tab for CPU, memory, request counts and latency.
- **Request logs:** `morgan` prints one line per page and API request (skipping images, CSS/JS and photos), so they appear in Render's Logs tab even on the free tier. Failed logins are logged with the username tried and the IP.
- **Leader activity log:** stored in the `audit_log` table (leader username, action, scout or activity name, time). It never stores passwords or private scout details. If a leader is deleted, their past entries stay, with their username.
- **Not added yet:** visitor analytics for the public page. Privacy-friendly options are Plausible, Umami, GoatCounter or Cloudflare Web Analytics (one script tag in `index.html`).

## Good to know

- Scouts don't have logins; leaders create and manage them. Scout names don't have to be unique.
- A scout's total XP is the sum of their activity history, so every award can be traced and undone. Totals can go below zero.
- Each XP entry stores the activity's name and XP at award time, so editing or deleting an activity later doesn't change past records.
- Photos are cropped square, shrunk to 256px in the browser, and stored in the database.
- Failed sign-ins are limited to 10 per 15 minutes per IP (kept in memory, so it resets on restart). Successful sign-ins don't count.
- **Privacy:** the public page shows children's names, photos and award notes to anyone with the link. Consider guardian consent, use first names or nicknames as the display name, and keep award notes neutral.
- After deploying, a normal reload is enough: pages, scripts and language files are always revalidated.

## Patrols

Each troop can split its scouts into patrols ("patrol" in English; "طليعة" in Arabic, and "رهط" in Rovers-themed troops). Admins and mods manage them in the **Patrols** tab; any leader puts a scout in one from the scout's page. The dashboard and the leader's scout list show a heading per patrol.
Every troop also has one pre-made patrol for its leaders: **قيادة الفرقة** (Troop leadership), shown as **مجلس الشرف** (Honor council) in Rovers-themed troops. It is always listed first and can't be renamed or deleted. Every admin and mod account is listed in it automatically (and also under its own regular patrol, if it has one); the super admin never is. Other scouts can be put in it by hand.

## Customizing

- **Colors:** edit the variables in `public/style.css`. A new troop theme needs a `:root[data-theme=name]` block there, an entry in `THEMES` (and `TROOP_TINT`) in `common.js`, its key in `THEME_KEYS` in `server.js`, and a `theme_<name>` text in both language files.
- **Interface text:** edit `public/i18n/en.json` and `ar.json` (keep the same keys in both). Texts that name the patrol use `{unit}` / `{units}`.
- **Activities:** change them from the Activities tab, not in code.

## Troubleshooting

- `DATABASE_URL and JWT_SECRET are required`: `.env` is missing or not in the project folder.
- `cannot execute CREATE TABLE in a read-only transaction`: the connection string points at a read replica or read-only branch. Copy the string for the primary compute from Neon's **Connect** dialog.
- Forgot the super admin's password: see "Resetting a password" above. (Don't delete rows from `leaders` to get a fresh account: that removes every account.)
- Port 3000 is in use: set `PORT=3001` in `.env`.

## Ideas not done yet

- Changing an existing account between admin and mod (today: delete and re-add it).
- English wording to match the Arabic changes ("Scout list", "Leadership").
- Visitor analytics for the public page.
