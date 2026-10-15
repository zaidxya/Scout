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

**Home page (`/`)**: no login needed; the first thing a visitor sees. It holds what the leaders post, **the same for every troop**, and it is also where posts are written:
- A **news ticker** across the top: every post marked "Show in the ticker", scrolling (with none, the bar stays and says "No news for the time being"; steadily at about 60 px per second on phones, slower for longer text on wider screens; it pauses on hover or focus, stops scrolling for people who prefer reduced motion, and a headline scrolls to its post below).
- **Quick links** to the scout list, the depot and the weekly reports: cards with a short description on wide screens, small plain buttons on phones, with the text centred in each.
- **Coming up**: activities and events with a date from today on, soonest first.
- **News and updates**: everything else, pinned posts first then newest first (past activities and events end up here), 12 at a time with "Show more".
- **Writing posts** (admins, leaders and the super admin; not mods): an **Add a post** button opens the form right on the home page, and each post they may change has **Edit** and **Delete** buttons. A post has a type (**news**, **activity** or **event**), a title, details, an optional date (activities and events with a date show under "Coming up" until that day), "Show in the ticker", "Pin to the top" and **which troops it is about** (tick boxes: one troop, **several** for a joint event, or **All troops**; a post shows the names of its troops as tags, and is public to everyone). The super admin and leaders tick any troops; an admin's own troop is always ticked and locked (it may add the other troops that take part, but can't post only for others, or for all) and an admin changes only the posts its own troop is part of; nobody else can post on behalf of troops they aren't in except the super admin and leaders. Mods don't write posts. Writes are logged in the activity log (added / edited / deleted a post).
- Old links to a scout (`/#12`) are forwarded to the scout list (`/scouts.html#12`).

**Scout list / dashboard (`/scouts.html`)**: no login needed (this used to be the home page, `/`)
- Searchable list of scouts of one troop, grouped by patrol, ordered by role priority (see below), then XP
- Per scout: display name, profile picture, roles (colored chips), XP total and activity history (including the note written with each award)
- A troop picker when there is more than one troop (the visitor's last choice is remembered)
- **On phones** (width up to 760px) opening a scout shows their page **on its own screen at the top** (the list is hidden) with a **← Back to the list** button, and the phone's own back button does the same; going back returns to the same spot in the list. The list is shown alone until a scout is opened. The leader area's Scouts tab works the same way. Wider screens keep the list and the page side by side. (`openDetailView` / `closeDetailView` in `common.js`, the `show-detail` class on the `.cols` element, styles at the end of `style.css`.)
- **Signed in?** A scout's page also shows their **private details** (full name, phone, join date, date of birth, address, guardian, medical notes, interests / hobbies, tags) as plain read-only text, with a link to the leader area, where all editing happens. **Admins and mods only get this for scouts of their own troop** (another troop's scout shows just the public page); the super admin and leaders get it for every troop. Visitors never see it.

**Weekly reports (`/reports.html`)**: **public**: anyone can read them (`GET /api/reports` needs no session; the page is in the header menu and on the home page for everyone). Visitors who are not signed in see the reports only, with a note to sign in to write; the form appears once signed in. The troops meet every **Saturday**, and each troop writes **one report per Saturday** on what it did. The page lists the weeks (this week and the last three, plus any older week that has a report), newest first, with **every troop's report under each week** (or "No report yet"); the form on top picks a week (the last 52 Saturdays) and a troop, loads the report if one exists (so there is only ever one per troop and week) and saves or deletes it. **Admins and mods write, edit and delete only their own troop's report** (the troop choice is fixed to theirs, and the server uses their own troop whatever is sent); the super admin and leaders can write for any troop. Everyone, signed in or not, can read all of them (the author is shown by scout name only, never a login username). Saved reports show who wrote them and are logged in the activity log.

**Depot (`/depot.html`)**: the shared inventory (item name in both languages, quantity, notes). Anyone can view and search it. Each item shows its quantity in a labelled box (red "out of stock" at 0), and the count above the list reads "Items listed: N" ("n of N" while searching). Admins, leaders and the super admin edit and remove items: rows stay read-only, and an **Edit** button opens one row at a time with Save / Cancel / Delete. Only the super admin adds items, through the **+ Add item** button (the form stays closed until it is needed).
**Taking items (by troop, with a basket):** every signed-in account (admins, mods, leaders, super admin) **takes** depot items out **at once, for a troop**: admins and mods always for their own troop (every account belongs to one), the super admin and leaders pick the troop in the basket (defaults to the troop last used in the leader area, for a leader else their own). Items go into the **basket** with **Add to basket** (the button then reads "✓ In basket"; pressing it again takes the item out). The basket opens above the search box: who it is for, **Taken at** (the current date and time by default; it follows the clock until it is edited, and can be set to an earlier time, never the future), one line per item with its quantity, how many are available now (red when asking for more) and a × to remove it, an optional note, **Take now** and **Empty basket**. The basket (items, note) is kept in the browser, separately for each account, until it is taken or emptied; a floating "Basket (N)" button brings it back into view. The whole basket is taken or nothing: the server refuses it if any item has less available than asked (stock minus everything that is out and not yet put back). Items show "Taken now: N" while some are out. Under the inventory, **Taken right now** lists every take that hasn't been put back (troop, items × quantities, when, who took it, the note; your own troop's have a coloured edge) with a **Put back** button (the whole take) for the one who took it, the admins of its troop, and the super admin and leaders. A **History (put back)** section (closed until opened) lists what was put back, latest first, up to 200. Taking and putting back are leader-only (visitors only see the inventory) and are written to the troop's activity log. Deleting a depot item removes it from every take (a take left empty is removed).

**Leader area (`/leader.html`)**: sign-in required. Tabs (what each account level sees is listed under "Account levels" below):
- **Add scout** (its own tab right after Scouts; every account level that has Scouts): the whole scout form, with the same fields as a scout's details (display name, full name, phone, join date, date of birth, guardian name and phone, address, medical notes, interests / hobbies). Only the display name is required. You land on the Scouts tab with the new scout open, where the picture, patrol, roles and tags are set.
- **Scouts**: edit their details; upload a profile picture, and **hide it on the dashboard** with a button next to it (the picture is kept and still shows in the leader area; the dashboard shows the initial-letter avatar instead); award XP from the troop's activity list or with a **Custom…** award (its own title and XP, a negative value deducts; with a date and an optional note) and undo a mistaken entry; put them in a patrol; give them roles and tags (shown in the order they were given, the newest at the end of the row, so adding one doesn't move the others); **deactivate** them when they leave the movement (hidden from the dashboard and the default list, history kept, can be reactivated via "Show inactive"); **promote** them to a troop of a **higher level** only (XP and history go with them; their patrol, roles and tags are removed because those belong to the old troop). Only the super admin can delete a scout permanently. The search box matches name, full name, phone, patrol, role and tag names in both languages, ignoring Arabic spelling variants and diacritics.
- **Activities** (admins and the super admin; not leaders or mods): the troop's own activity list. Starter list: Presence +5, Idea +3, Event +10. A negative value (for example -5) deducts XP.
- **Patrols**: the troop's patrols (see "Patrols" below).
- **Attendance (الحضور)**: **admins, leaders and the super admin** add a **meeting, an event or a patrol meeting** (type choice; the **title is required**; a **patrol meeting** (**اجتماع طليعة**, **اجتماع رهط** in Rovers-themed troops) also needs the patrol, and its sheet lists only that patrol's scouts; its type and patrol can't be changed afterwards) and choose its **XP for attending** (default 10) and **XP taken for absence without an excuse** (default 0); 0 = none. **Mods** see every meeting, event and patrol meeting and every scout's mark, but **mark attendance only for their own patrol's scouts** (the other buttons are greyed out); they can add only **patrol meetings, for their own patrol** (the type and patrol aren't chosen: the form has just date, title and XP), and that is all they can create: they can't edit or delete any meeting, event or patrol meeting (not even their own). A patrol meeting counts only for the scouts of its patrol in the attendance percentages. The list has a **search** (title, date, type) and a type filter. On a sheet each scout has three buttons: **Mark present**, **Absent, no excuse** and **Absent, excused** (pressing the lit one clears the mark; saved at once), plus **Mark everyone present**, **Mark the rest absent (no excuse)** and **Clear all**. Per-scout attendance is shown as a percentage of the meetings and events held since they joined (absences don't change it). **Present** scouts get the attending XP as an entry "Attended <title>" (حضر <title>); scouts absent **without an excuse** lose the absence XP as a negative entry "Absent: <title>" (غاب عن <title>); **an excused absence takes no XP**. XP entries appear in the scout's activity history and in the **leader activity log** (marking or clearing the whole sheet is one entry; an excused mark is logged without XP). Changing or clearing a mark takes its XP back and gives the new mark's; deleting the meeting/event removes everything; editing the date, title or XP values on the sheet updates entries already given (0 removes them, raising from 0 gives it to those already marked). Attendance marked before build 42 gave no XP; absences marked before build 52 count as "no excuse".
- **Roles & tags** (Arabic: الأدوار والأوسمة; a tag is a **وسام**, tags are **أوسمة**, i.e. badges): colored roles with a priority (higher = listed first, for everyone) and tags. Roles are public; tags are leader-only. Admins and the super admin only (not leaders or mods).
- **Administration** (super admin only) is **not a tab here any more**: it is its own site, **`/admin.html`**, opened from the **Administration** entry of the header menu (see "Administration" below). The leader area has no Troops, Leaders or Activity log tabs.

**Header menu (top of every page)**: the button names the page you are on and the list holds the other pages (Home, Scout list, Weekly reports, Leader area, Depot, and for the **super admin** **Administration**, then My account / Sign in). Built in `paintMenu` in `common.js` from `SITE_PAGES`; every page has a small line icon (`MENU_ICONS`). **On phones** (up to 760px) the menu opens as a **bottom sheet** over the dimmed page (tap the dimmed part, press Esc or pick a page to close it) with large rows; wide screens keep the small dropdown.

**Administration (`/admin.html`)**: the super admin's own site, not tied to any troop (no troop switcher or troop theme; any other account, or a super admin viewing as someone else, is refused). Three tabs (`#troops`, `#accounts`, `#log`):
- **Troops**: add, rename and delete troops, give each a **level** (troops are levels; a scout can only be promoted to a higher level; a new troop with no level goes above all others; troop lists are ordered by level), choose whether it **uses the XP system** (see below), pick each troop's theme, the text next to its logo and its **slogan** (English and Arabic, for example "Always Prepared" / «مستعد دائماً»; it is shown **in the header at the top of the leader area, right beside the troop's name** (`#brandSlogan`), when the troop has one). A new troop can start empty or with a copy of another troop's activities and roles/tags.
- **Accounts**: every account of every troop, **grouped by troop** (the super admin first); add an account (admin, leader or mod) **choosing its troop**, delete accounts, reset their passwords.
- **Activity log (سجل النشاط)**: the leaders' actions in **every troop**, newest first, **grouped by day** (Today, Yesterday, then dates), one quiet row per entry: time, a coloured dot for the kind of action (scouts, XP and attendance, depot, posts and reports, accounts and troops), who did what, and the troop. Filters: a **troop** (asked from the server), a **kind** and a **text search** (applied to what is loaded); 200 entries at a time with **Older entries**. **Signing in and out is not logged** (and the sign-in entries recorded before build 70 are left out of the list).

**View as (super admin)**: at the top of the leader area the super admin has a **View as** choice listing every other account (name · level · troop). Picking one reloads the site as that account: the tabs, lists, patrol limits and depot rights are exactly what it sees, **read-only** (any change is refused with `view_only`, so nothing is done in someone else's name), and a yellow strip across every page says who is being viewed with an **Exit view** button. The choice is kept per browser tab (`sessionStorage.viewAs`) and sent as the `X-View-As` header by `api()`; `requireLeader` honours it only for the super admin (`req.real` is the signed-in account, `req.leader` the viewed one, `req.viewing` is set), and `GET /api/me` reports `real_role` and `viewing`. The first entry, "Myself", goes back.

**My account (`/account.html`)**: from the header menu once signed in. Change your own username and/or password, and sign out.

**Troops**: every scout and every account belongs to one troop, except the super admin, who belongs to none. The super admin and **leaders** (who have a home troop) work in whichever troop is selected in the **troop switcher** above the tabs (the theme follows it; scouts and accounts are added to that troop; a leader starts in their home troop). Admins and mods only ever see and change their own troop. Activities, roles/tags, patrols and meetings are separate for each troop. All of this is enforced on the server.

**Leaders are scouts too**: every admin and mod account has its own scout profile that appears in the public list, earns XP and can have roles and tags. Adding an account creates the profile (optional display name, defaults to the username). Deleting an account keeps the scout profile; a profile can't be deleted, deactivated or promoted while its account exists.

**Who sees what**

| Data | Public | Leaders |
|---|---|---|
| Display name, profile picture, roles, patrol, XP, activity history and award notes | yes | yes |
| Tags, attendance, depot takes | no | yes |
| Full name, phone, join date, date of birth, address, guardian name and phone, medical notes, interests / hobbies | no | yes |
| Deactivated scouts (including their photo) | no | yes |

## Account levels

There are four account levels (`leaders.role`: `super_admin`, `admin`, `leader`, `mod`). The level alone decides what an account may do; there are no separate permissions.

| | Super admin | Admin | Leader (قائد) | Mod (رائد) |
|---|---|---|---|---|
| Troop | none (all) | own | home troop, can switch | own |
| Switch between troops | yes | no | **yes** | no |
| Scouts, XP (list and custom awards), attendance | yes | yes | yes | everyone is visible, **but it changes only the scouts of its own patrol** (see below); for attendance a mod opens meetings and events and marks present / absent, and can only **create patrol meetings for its own patrol** (no edit or delete) |
| Patrols tab (add, rename, delete), moving a scout between patrols | yes | yes | yes | **no** |
| Activities tab (add/delete the troop's award list) | yes | yes | **no** | no |
| Roles & tags | yes | yes | **no** | no |
| Write home page posts (on the home page) | yes (any troop, or all) | yes (own troop's) | yes (any troop, or all) | **no** |
| Depot: edit and remove items | yes | yes | yes | no |
| Depot: add items | yes | no | no | no |
| Take depot items, see what is taken | yes | yes | yes | yes |
| Put taken items back | any | its troop's, and own | any | own |
| Administration: Troops, delete a scout permanently | yes | no | no | no |
| Administration: Accounts, activity log | yes | no | no | no |

- **Super admin**: exactly one, the account created from `LEADER_USERNAME`. Belongs to no troop, has every right, can't be deleted.
- **Admin** (the default for new accounts): the everyday work in their own troop, including roles and tags.
- **Leader**: works like an admin but can jump between troops with the troop switcher, like the super admin; has no Activities or Roles & tags tabs and no Administration (it can still award XP from the list) (and can't give roles/tags to scouts). Created by the super admin in Administration > Accounts; the account belongs to a home troop (its scout profile and its place in the leaders' patrol are there).
- **Mod (رائد)**: the scouts of **one patrol** and their activity, and taking depot items for their troop (and putting back the bookings they made). **Its patrol is the one set on its own scout profile** (an admin, leader or the super admin picks it from the account's scout page, in the same "patrol" choice as for any scout). A mod **sees everyone** like any other account (the scout lists, every scout's page and private details, attendance and its percentages, every meeting), but **changes only the scouts of that patrol (its own profile is in it)**: edits, photos, deactivating, promoting, XP awards and undo, and attendance marks (single and the "everyone" buttons) all refuse any other scout (enforced on the server by `patrolSql` / `inPatrol` / `scoutFor` in `server.js`; `GET /api/leader/scouts` and `/:id` return an `editable` flag, and the page shows another patrol's scout read-only with a note, and greys out their attendance buttons). A new scout added by a mod joins the mod's patrol; a patrol meeting added by a mod belongs to the mod's patrol (kind `patrol`, `meetings.patrol_id`). A mod can't add, rename or delete patrols or move scouts between patrols (that would let it widen its own access), so the Patrols tab is hidden for it. A mod with **no patrol** can change **nobody, not even itself** (every scout is read-only for it, the attendance buttons are greyed out and the "everyone" buttons hidden, with a hint), and can't add scouts or patrol meetings.

Roles (the colored chips) no longer carry permissions. `labels.permissions` stays in the database, unused. Old accounts keep their level; an account that had been given *manage_accounts* or *view_log* through a role (build 38 and before) loses that unless it is the super admin.

Existing databases are upgraded automatically on startup: the `LEADER_USERNAME` account (otherwise the oldest account) becomes the super admin. (Before build 39, old "leader" accounts were turned into admins on every startup; that step is gone, since "leader" is a real level now.)

## Sessions and passwords

- Signing in keeps you signed in until you sign out (the cookie lasts about 400 days and is renewed on every visit).
- **Changing or resetting a password signs that account out everywhere.** A reset from Administration > Accounts ends all of that person's sessions at once; changing your own password in My account keeps the current browser signed in and signs out the others.
- To sign *everyone* out at once, change `JWT_SECRET` on Render.

**Resetting a password**
- Someone forgot theirs: the super admin opens the **Leaders** tab and presses *Reset password* next to the account.
- The super admin forgot theirs: nobody can reset it from the website. Use `reset-password.js`:
  1. On your computer, in the project folder with `.env` filled in (same `DATABASE_URL` as the live site), run `node reset-password.js <username> <new-password>` (8+ characters). It also works in Render's **Shell** tab, where `DATABASE_URL` is already set.
  2. No local setup? Run `node -e "console.log(require('bcryptjs').hashSync('NEW_PASSWORD', 12))"` and in Neon's SQL Editor run `UPDATE leaders SET password_hash = '<that hash>', session_v = session_v + 1 WHERE username = 'boss';`.

## Dropdowns

Every `<select>` in the site (the troop switcher, "View as", activity and patrol pickers, filters, account types, themes...) opens a **styled list** instead of the browser's own: a small popover on wide screens and a **bottom sheet** (dimmed page, grab bar, the field's name as a title, big rows, a tick on the current choice) on phones. It is done once for all of them in `common.js` (the block "dropdowns"), so new selects get it automatically, including ones the pages create later. The `<select>` stays in the page (it shows the choice, is validated and submitted as before); choosing sets its value and fires `input` and `change`, so existing code needs nothing. Keyboard: Space, Enter or Alt+Down open it, arrows move, Enter chooses, Esc closes, typing jumps to an option. Add `data-native` to a select to keep the browser's own list. Styles: end of `style.css` (`.cs-*`).

## Tech

Node.js 18+, Express, PostgreSQL on Neon (`pg`), `morgan` for request logging, `compression` for gzip, plain HTML/CSS/JavaScript on the front end (no build step).
Passwords are hashed with bcrypt; sessions are a signed token in an httpOnly cookie.

```
server.js          Express app, all API routes, account levels, audit logging, startup migrations
db.js              Postgres connection (Neon)
schema.sql         Tables; applied automatically on every startup
reset-password.js  Reset any account's password from the command line
public/
  index.html       Home page (ticker, coming up, news)
  scouts.html      Public scout list / dashboard
  leader.html      Leader area (all the tabs above)
  depot.html       Depot inventory
  admin.html       Administration (super admin): troops, accounts, activity log
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

- **Public:** `GET /api/troops` (with each troop's theme, brand text and slogan), `GET /api/scouts?troop=` (active scouts with roles, never tags), `GET /api/scouts/:id`, `GET /api/scouts/:id/photo`, `GET /api/patrols?troop=`, `GET /api/depot`, `GET /api/posts` (every post, pinned first then newest, up to 100), `GET /healthz`
- **Auth:** `POST /api/login`, `POST /api/logout`, `GET /api/me`, `PUT /api/me/account` (own username and/or password), `GET /api/view-as/accounts` (super admin: the accounts it can view as; send `X-View-As: <account id>` on any signed-in `GET` to see the site as that account)
- **Signed in:**
  - Scouts: `GET /api/leader/scouts` (search list), `GET /api/leader/scouts/:id` (private details and tags; the dashboard uses it too; both add `editable`: false for a mod looking at a scout outside its patrol), `POST /api/scouts`, `PUT /api/scouts/:id`, `PUT /api/scouts/:id/active`, `PUT /api/scouts/:id/promote`, `PUT /api/scouts/:id/patrol` (not mods), `PUT` and `DELETE /api/scouts/:id/photo`, `PUT /api/scouts/:id/photo-hidden` (`hidden`: true/false), `DELETE /api/scouts/:id` (super admin)
  - XP: `POST /api/scouts/:id/xp`, `DELETE /api/xp/:id`
  - Activities: `GET`, `POST`, `DELETE /api/activities[/:id]` (not mods)
  - Weekly reports: `GET /api/reports` (public; all, newest week first), `PUT /api/reports` (`troop_id` (super admin and leaders only; others always use their own troop), `week` (a Saturday, not in the future), `body` (required, 4000); creates or replaces that troop's report for the week), `DELETE /api/reports/:id` (its troop's admins and mods, super admin, leaders)
  - Home page posts: `POST /api/posts`, `PUT`, `DELETE /api/posts/:id` (not mods; `kind`: `news`, `activity` or `event`, `title` (required, 120), `body` (2000), optional `event_date`, `ticker`, `pinned`; `troop_ids`: the troops it is about, `[]` or `"all"` = all troops (only the super admin and leaders can leave out their own; an admin's own troop is always added); an admin changes only posts its own troop is part of)
  - Roles and tags: `GET`, `POST`, `PUT`, `DELETE /api/labels[/:id]`, `PUT /api/scouts/:id/labels` (replaces a scout's full set) (admins and the super admin only)
  - Patrols: `POST`, `PUT`, `DELETE /api/patrols[/:id]` (not mods)
  - Meetings: `GET`, `POST /api/meetings` (`date`, `title` (required), `kind`: `meeting`, `event` or `patrol`, `patrol_id` for a patrol meeting (a regular patrol of the troop), `xp` 0-1000, `absent_xp` 0-1000; a mod's is always a patrol meeting of its own patrol, and `no_patrol` if it has none), `GET`, `PUT`, `DELETE /api/meetings/:id` (not mods; a patrol meeting keeps its kind and patrol), `PUT /api/meetings/:id/attendance[/:scoutId]` (`status`: `present`, `absent` (no excuse), `excused` or `none`; for everyone: all present / the rest absent / clear), `GET /api/attendance/summary`
  - Depot: `POST /api/depot` (super admin), `PUT`, `DELETE /api/depot/:id` (admins)
  - Depot takes (per troop): `GET /api/depot/takes` (what is out now, each with its troop, `items: [{item_id, quantity}]`, `taken_at`, `mine`, `can_return`; `?returned=1` for the history, latest 200), `POST /api/depot/takes` (`items: [{item_id, quantity}]` (1-100 items), `note`, optional `taken_at` (default now, not in the future, at most 60 days back), `troop_id` for the super admin and leaders only; all or nothing: 409 `not_available` with `short: [{item_id, available}]`), `PUT /api/depot/takes/:id/return` (puts back the whole take: who took it, the troop's admins, the super admin, leaders)
  - Troops: `POST`, `PUT`, `DELETE /api/troops[/:id]` (super admin)
  - Accounts: `GET` (every account, any troop), `POST` (`troop_id` = the account's troop), `DELETE /api/leaders[/:id]`, `PUT /api/leaders/:id/password` (super admin)
  - Activity log: `GET /api/audit?troop=&before=&limit=` (super admin; every troop or one, newest first, `before` = an entry id, `limit` up to 500, default 200; no sign-ins)

## Logs and usage tracking

- **Render dashboard:** open the service, then the **Logs** tab for app output, and the **Metrics** tab for CPU, memory, request counts and latency.
- **Request logs:** `morgan` prints one line per page and API request (skipping images, CSS/JS and photos), so they appear in Render's Logs tab even on the free tier. Failed logins are logged with the username tried and the IP.
- **Leader activity log:** stored in the `audit_log` table (leader username, action, scout or activity name, troop, time) and shown on the Administration page. It never stores passwords or private scout details, and **signing in and out is not recorded**. If a leader is deleted, their past entries stay, with their username.
- **Not added yet:** visitor analytics for the public page. Privacy-friendly options are Plausible, Umami, GoatCounter or Cloudflare Web Analytics (one script tag in `index.html`).

## Good to know

- Scouts don't have logins; leaders create and manage them. Scout names don't have to be unique.
- A scout's total XP is the sum of their activity history, so every award can be traced and undone. Totals can go below zero.
- Each XP entry stores the activity's name and XP at award time, so editing or deleting an activity later doesn't change past records.
- Photos are cropped square, shrunk to 256px in the browser, and stored in the database. A leader can hide a scout's picture on the dashboard (`scouts.photo_hidden`): the public routes then report no picture and the photo route answers 404 to visitors, while signed-in accounts still get it for the leader area.
- Failed sign-ins are limited to 10 per 15 minutes per IP (kept in memory, so it resets on restart). Successful sign-ins don't count.
- **Privacy:** the public page shows children's names, photos and award notes to anyone with the link. Consider guardian consent, use first names or nicknames as the display name, and keep award notes neutral.
- After deploying, a normal reload is enough: pages, scripts and language files are always revalidated.

## The XP system is per troop

Each troop can use the XP system or not (a checkbox in Administration > Troops, on by default; the super admin sets it). **When it is off for a troop:** its dashboard and leader lists show no XP numbers and scouts are ordered by role priority then name; a scout's page shows no XP badge and no activity history; the leader area has no Activities tab and no award form (no custom awards either), and `POST /api/scouts/:id/xp` answers `xp_disabled`; meetings and events have no XP fields and attendance gives or takes none. XP already given stays stored and comes back if the system is switched on again. Scouts promoted between troops keep their history; it is shown according to the troop they are in.

## Patrols

Each troop can split its scouts into patrols ("patrol" in English; "طليعة" in Arabic, and "رهط" in Rovers-themed troops). Admins, leaders and the super admin manage them in the **Patrols** tab and put a scout in one from the scout's page (mods can do neither: a mod's patrol decides which scouts it can see). The dashboard and the leader's scout list show a heading per patrol.
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
