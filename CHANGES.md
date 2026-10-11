# Scout Troop 2 Scout Tracker: summary of changes

All changes are in the updated `scout-app.zip`.

## Language and layout
- **Arabic is the default language.** Anyone without a saved choice gets Arabic. Browsers that already picked English stay on English until the language button is tapped once.
- **The layout no longer flips.** It stays right-to-left in both languages and only the text changes. To make it left-to-right in both instead, change `dir = 'rtl'` in `public/common.js`.
- `index.html` and `leader.html` now start with `lang="ar" dir="rtl"`, so there is no flash on load.

## Arabic wording
| Where | Before | After |
|---|---|---|
| Leader area title | منطقة القائد | القيادة |
| Dashboard link | لوحة المتابعة | قائمة الكشاف |
| Logout button | خروج | تسجيل خروج |
| Public-field hint | يظهر في لوحة المتابعة العامة | يظهر في قائمة الكشاف العامة |
| XP unit | نقطة | XP |
| Subtitle | نشاط الكشافة ونقاط الخبرة | نشاط الكشافة و XP |
| Award button | منح نقاط | منح XP |
| Activity hint | …عند منح النقاط | …عند منح XP |
| Activity form label | عدد النقاط | قيمة XP |

The English labels were left as they were (for example "Dashboard" and "Leader area").

## Leader name in the header
- The logged-in leader's username shows next to "القيادة" in the leader page header.
- It is its own header item, separated by a thin sand-colored divider line on its left, so it no longer touches the title.
- It is hidden when nobody is logged in.
- The name shown is the username, since that is all the database stores for leaders.

## Logging and tracking
- **Request logs.** `morgan` prints one line per page and API request to Render's Logs tab, on any plan. It skips images, CSS/JS and scout photos. Failed logins are logged with the username tried and the IP.
- **Leader activity log.** A new "سجل النشاط" tab shows the latest 300 actions, newest first, in the selected language. It records:
  - logins, logouts and password changes
  - scouts added, edited or deleted, and photos changed or removed
  - XP awarded or undone
  - activities added or deleted
  - leaders added or removed
- It stores the leader's username, the scout's name and the time. It never stores passwords or private scout details.
- A new `audit_log` table is created automatically on startup, so no manual migration is needed.
- The new endpoint is `GET /api/audit`, available to leaders only.

## Confirmation popup
- The browser's default `confirm()` box is replaced with a styled popup in the site's burgundy and sand theme: a card on a dimmed, blurred background with a title, a message, and Cancel and confirm buttons.
- It covers four actions: delete scout, undo an XP entry, delete activity, and remove leader.
- Cancel is focused by default. Esc and clicking the background also cancel.
- New text keys: `cancel` and `confirm_title`, in both `ar.json` and `en.json`.

## Files touched
- `server.js`: morgan, audit helper, audit calls, `/api/audit`
- `schema.sql`: `audit_log` table
- `package.json`: added `morgan`
- `public/common.js`: default language, fixed direction, `confirmBox()`
- `public/leader.html`: leader name, Log tab, popup wiring
- `public/index.html`: `lang` and `dir` attributes
- `public/style.css`: popup styles
- `public/i18n/ar.json` and `en.json`: wording changes and new keys

## Before deploying
1. Run `npm install` locally so `morgan` is installed (Render does this on its own at build time).
2. Test on a separate Neon branch first, as the README suggests.
3. After deploying, do a hard refresh (Ctrl+Shift+R) so the browser doesn't reuse cached pages.

## Notes
- None of this has been run against a real database. The server and page scripts pass a syntax check only.
- Render's per-request HTTP logs need a paid workspace. `morgan` covers this on the free tier.
- Visitor analytics for the public page (Plausible, Umami, GoatCounter or Cloudflare Web Analytics) were discussed but not added.

## Round 2: leaders as scouts, roles and tags, search
- Every leader now has a scout profile (`leaders.scout_id`) shown in the public list with XP. Created with the leader (optional display name), and backfilled for existing leaders on startup.
- Removing a leader keeps their scout profile. A leader's profile can't be deleted while the leader exists (`scout_is_leader` error).
- New tab "الأدوار والوسوم" (Roles & tags): create/delete roles and tags with English and Arabic names. Assign from a scout's page with chips and an add dropdown. Leader-only.
- Leader scout list: search box (name, full name, phone, group, role/tag names) + role and tag filters; role/tag chips shown under names.
- Public search now ignores Arabic diacritics and alef/yaa/taa-marbuta variants.
- Files touched: `schema.sql`, `server.js`, `public/leader.html`, `public/common.js`, `public/index.html`, `public/style.css`, both i18n files, `README.md`.

## Round 3: no automatic leader badge, colored roles and tags
- Removed the automatic "leader" badge from scouts that belong to leader accounts. To mark them, create a role (for example "Leader") and assign it.
- Roles and tags now have a color: pick it when creating, change it with the swatch in the Roles & tags tab, or reset to the default. Chips use the color everywhere (scout list and scout page); text switches between white and dark for readability.
- New: `labels.color` column (added automatically), `PUT /api/labels/:id` to change a color.

## Round 3 fix: colors not updating on the scout page
- Changing a role/tag color (or deleting one) now refreshes the open scout page too. Before, only the list updated and the scout page kept the old colors until the scout was reopened.
- A "Saved" message appears after a color change.
- The server now sends `Cache-Control: no-cache` for pages, scripts, styles and text files, so updates show up without a hard refresh.

## Round 4: role priority controls the scout order
- Each role has a priority (whole number 0-1000, default 0). Set it when creating the role or change it in the Roles & tags tab. Tags have no priority.
- The scout list is ordered by the highest priority among a scout's roles (higher first), then by XP, then by name. Scouts with no role count as 0.
- This applies to both the leader list and the public dashboard. Nothing about roles is shown publicly; only the order changes.
- New column `labels.priority` (added automatically). `PUT /api/labels/:id` accepts `color` and/or `priority`.

## Round 5: roles are public
- The public dashboard now shows each scout's roles as colored chips in the list and on the scout's page, in the selected language. The public search also matches role names (both languages).
- Tags stay leader-only. Role priority still decides the order.
- `GET /api/scouts` and `GET /api/scouts/:id` now include a `roles` array (id, names, color). Priority numbers are not exposed.
- Shared chip code moved into `common.js` (`roleChips`, `chipStyle`).

## Round 6: page titles
- The browser tab title is now "قائمة الكشاف" on the dashboard and "القيادة" in the leader area (Arabic). English titles use the site name. Each page sets its title key with `data-title` on its `<html>` tag.

## Round 6: negative XP activities
- Activities can now have a negative XP value (any whole number from -10000 to 10000 except 0). Awarding one deducts XP and shows in red in the history, the activity list and the dropdown.
- A scout's total is still the sum of their history, so a deduction can be undone like any award. Totals are not floored at zero, so a scout can go below 0.
- Changed: `server.js` (validation), `leader.html`, `common.js` (`signed()` helper), `style.css`, both i18n files.

## Round 7: negative totals in red
- A scout whose total XP is below zero shows it in red: the number in the list (public and leader) and the round badge on their page.
- Changed: `common.js`, `style.css`.

## Mobile fixes
- Leader tabs: the five tabs now scroll sideways inside their own row (they used to widen the whole page and overlap the header); the active tab scrolls into view.
- Single-column layout uses `minmax(0, 1fr)` so the filter dropdowns can't force a horizontal scroll at 320px.
- Tapping a scout on a phone scrolls to their details (dashboard and leader area).
- XP numbers and the "-5" signs are bidi-isolated so negatives no longer render as "XP 5-" in RTL.
- Phone sizing: compact detail header (avatar / name / XP badge on one row), larger tap targets (buttons, selects, chip remove, colour swatch), wrapping rows in roles/activities/leaders lists, date inputs normalised for iOS.
- Declutter pass (phones): header is now two compact rows (logo + title, then equal-width buttons); tighter padding/spacing in panels, forms and the scout detail; empty status line no longer takes space; role/tag rows show the name on one line and controls on the next.
- Leader area: removed the role and tag filter dropdowns under the search box (search still matches role and tag names).

## Account levels (super admin / admin / leader)
- New `leaders.role` column (applied on startup). Only the super admin and admins can list, add, delete or reset passwords of accounts; the checks are on the server (`requireAdmin`, `canManage` in `server.js`). Only the super admin can create admins; admins manage plain leaders only.
- Leaders tab: plain leaders see only "change my password". Admins see the account list with Reset password / Delete buttons where allowed.
- `reset-password.js` resets any account's password from the command line (for a forgotten super-admin password).
- Checked against a real Postgres 16: the schema applies twice without errors, a second super admin and an unknown role are rejected, and the permission rules pass 12 of 12 cases. The full server couldn't be started in my sandbox (npm install was blocked), so test the admin flow on your Neon test branch.

## Leader tabs and password (latest)
- **New "Change password" tab** for every leader (it used to sit at the bottom of the Leaders tab).
- **Leaders, Roles & tags and Activity log tabs are admin-only.** (Creating, editing and deleting roles/tags is also blocked on the server for regular leaders.)
- *(earlier note)* **Leaders tab and Activity log tab are admin-only.** Regular leaders no longer see them, and `/api/audit` now returns 403 for non-admins, so it can't be opened by URL either.
- **Reset-password row fixed** in the Leaders tab: each account row now wraps, so the password box opens on its own line instead of squeezing the name and buttons.

## Scout details form
- **Patrol / group field removed** from the details form, search and the API (the old column stays in the database so no data is deleted).
- **Phone and guardian phone accept digits only.** The field blocks other characters as you type (Arabic-Indic digits convert to 0-9), mobile shows the numeric keypad, and the server cleans the value too.
- **Phone fields restyled**: rounded sand-tinted pill with a phone icon, bold evenly-spaced digits, and a wine-colored border with a soft glow on focus. (They were also missing the standard input styling before.)

## Activity date
- **Awarding an activity now includes a date.** The date picker defaults to today, can't be in the future, and is required. It's saved with the entry (new `activity_date` column, added automatically on startup) and shown in the scout's activity list instead of the time it was entered. The list is ordered by that date. Older entries keep showing the day they were entered.

## Speed and cleanup, Arabic by default
- **Language flash fixed.** Pages now stay hidden for a split second until the Arabic text is loaded, so the English text never shows first. Arabic is the default; a visitor who picked English once keeps English.
- **Faster loading.** The language file and the data (scouts, activities, labels, session check) now load at the same time instead of one after another. The other language downloads quietly in the background, so the toggle is instant, and each language file is fetched only once.
- **Smaller, cached downloads.** Responses are gzip-compressed (new `compression` package; run `npm install`), scripts/styles/language files are cached for 5 minutes and the logo/icons for a week. HTML pages are still re-checked every time.
- **Simpler database queries.** The public scout list totals XP once per scout instead of joining and grouping every XP row, and `scout_labels` got an extra index.
- **Cleanup.** Removed unused text keys and an unused date helper. English and Arabic files stay in sync.

## Smoothness pass
- **Instant repeat visits:** the public page remembers the last scout list and shows it immediately, then quietly swaps in the fresh data. Opening a scout shows the last copy right away (or a short "Loading..." note) instead of a blank panel, and a slow reply for a previous click can no longer overwrite the scout you picked next.
- **No jumpy text:** the page waits (at most 0.6 s) for the Cairo font before appearing, so the text doesn't resize after it shows.
- **Smoother typing and scrolling:** the search boxes redraw at most once per frame, photos load lazily and decode off the main thread, and anchor scrolling is smooth.
- **Polish:** gentle hover/press transitions, tab panes fade in, no tap delay on phones. All animation is switched off for visitors who use "reduce motion".
- **Steadier database connection:** connections are kept for a minute and kept alive, with a clear timeout, and a dropped connection (e.g. the database waking up) is logged instead of crashing the app.
- **`/healthz` endpoint:** a tiny page for an uptime pinger (see README note below).

## Troops
- **Several troops on one site.** New `troops` table; every scout and every leader account belongs to a troop, and existing data moves into a first troop ("Rovers", renamable) automatically on startup.
- **Isolation is enforced on the server.** Leaders and admins can only list, open, edit, delete, photograph, award XP to, or label scouts of their own troop (anything else answers "not found"). Admins only see, add, delete and reset passwords for leaders of their own troop, and their activity log shows only their troop. The super admin sees everything.
- **Shared activities and roles/tags, super admin only.** Creating or deleting activities and creating, editing or deleting roles/tags now requires the super admin. Regular leaders and admins still see the Activities tab, now read-only, and can still assign roles/tags to scouts of their troop. (Hiding the Activities tab from regular leaders is left for later, as agreed.)
- **New Troops tab (super admin):** add, rename and delete troops (a troop can only be deleted when it has no scouts or leaders).
- **Troop pickers:** the super admin gets a troop filter above the scout list and a troop choice when adding scouts and leaders; the public dashboard shows a troop picker when there is more than one troop and remembers the visitor's choice.
- Not built yet: moving a scout to another troop, and patrols inside a troop.

## Visual identities (main site + troop themes)
- **Main site look:** the home dashboard and the leader login screen use the purple and cream of the Scout Troop 2 logo (fleur-de-lis mark + name in the header, rounded cards, pill search).
- **Troop themes:** each troop has a `theme` (new column on `troops`, added automatically on startup). After signing in, the leader area switches to the theme of the leader's troop and goes back to purple on log out. Available: `rovers` (the original wine and sand with the wordmark logo), `forest`, `ocean`, `yellow`, `red`, `pink`, `white`. The first troop is set to `rovers` automatically.
- **Choosing a theme:** the super admin picks a troop's theme in the Troops tab (when adding or editing a troop).
- **Adding a new look later:** add a `:root[data-theme=name]` block in `style.css` and an entry in `THEMES` in `common.js` (and its key in `THEME_KEYS` in `server.js`).
- The public dashboard always stays on the main purple look, whichever troop is picked.
- **Site name:** the name shown next to the logo and in page titles is now "Scout Troop 2" in both languages (`title` keys in `public/i18n/*.json`).
- **Text next to the logo, per troop:** each troop can have its own text (English and Arabic) next to the logo, set in the Troops tab together with the theme (new `brand_en` / `brand_ar` columns on `troops`, added automatically). Leave both empty to show the site name; a troop with a wordmark logo (Rovers) shows no text unless you set some.
- **Role/tag colors stay the same everywhere:** roles and tags without a chosen color used to take on the active theme's colors (so the same role looked different on the main site and in a troop's leader area). They now use one fixed default look (soft sand with a dark wine label) on the main site and in every troop theme. Colors chosen in the Roles & tags tab were already identical everywhere and are unchanged.
- **More troop themes:** Yellow (bright yellow header, deep gold buttons), Red, Pink and White (white header, charcoal buttons) join Rovers, Forest and Ocean in the "Look" picker. Yellow and White use a dark version of the fleur-de-lis (`public/logo-mark-dark.png`) so it stays visible on a light header.
- **Section logos:** the Yellow theme now uses the Cub Scouts logo (on a white round badge so it stands out on the yellow header), and the blue theme, now labelled "Aqua", uses the Girl Guides logo. Files: `public/logo-cubs.png`, `public/logo-guides.png`. The theme key is still `ocean`, so nothing changes in the database.

## Super admin across troops, separate lists per troop
- **The super admin is not bound to a troop.** The account now has no troop of its own (`leaders.troop_id` may be empty for the super admin only; every other account must still have one). Existing databases release the super admin on the next startup. Their scout profile (they appear in the scout list like every leader) stays in the troop it was in.
- **Troop switcher.** When there is more than one troop, the super admin gets a switcher above the tabs. Switching reloads scouts, activities, roles/tags, leaders and the activity log for that troop and puts on that troop's theme and logo text. The last troop is remembered in the browser. The old "all troops" filter and the per-form troop pickers are gone: scouts and leaders are added to the troop you are in. The server learns the chosen troop from an `X-Troop` header that only the super admin's requests can change; everyone else is always pinned to their own troop.
- **Activities and roles/tags are separate for each troop.** New `troop_id` on `activities` and `labels`. A scout can only be awarded activities and given roles/tags from their own troop (checked on the server), and the Activities and Roles & tags tabs show the troop you are working in. Only the super admin edits them, as before; to let each troop's admins manage their own, change `requireListEditor` in `server.js` to `requireAdmin` (and show the tabs to admins).
- **Automatic migration, runs once.** The existing shared list stays with the first troop (Rovers); every other troop gets its own copy, and its scouts' XP entries and role/tag assignments are pointed at that copy, so nothing visible changes. Deleting a troop also deletes its own lists.
- **New troops:** the Add a troop form has a *Start with the activities and roles/tags of* choice: start empty, or copy another troop's lists (a one-time copy; the two lists are independent afterwards).
- **Activity log:** shows the troop you are working in; the super admin also sees entries that belong to no troop (adding, renaming and deleting troops).
- Files touched: `schema.sql`, `server.js`, `public/common.js`, `public/leader.html`, `public/style.css`, `public/i18n/en.json`, `public/i18n/ar.json`, `README.md`.

## Theme split and renames
- **Yellow** is now two themes: *Yellow (cubs)* (the existing one, key `yellow`, so troops already using it are unchanged) and *Yellow (hannabies)* (new, key `yellow_hannabies`) with the gold fleur-de-lis logo (`public/logo-hannabies.png`, cut out from the image you sent and shown on the same white round badge).
- **Forest** is now *Forest (boys)* (existing, key `forest`) and *Forest (girls)* (new, key `forest_girls`). Both look identical for now; the girls theme has its own key, so its colors and logo can be changed later in `style.css` and `THEMES` in `common.js`.
- **Aqua** is renamed *Aqua (guides)* (key still `ocean`). Rovers is unchanged.
- Names are updated in English and Arabic; no database change is needed.

## Tab icon and titles
- **Tab icon:** the icon is now always the purple main-site logo, on every page and in every troop theme. It was served under a name browsers had cached from the old Rovers version, so it now has a new file name (`favicon-v2.png`, also used as the phone home-screen icon). If an old icon still shows, close the tab and reopen the site once.
- **Site name:** Arabic is now كشاف الفوج الثاني (header text on the main site, dashboard and login page titles); English stays Scout Troop 2.
- **Troop name as tab title:** inside the leader area the browser tab shows the name of the troop you are working in (in the chosen language), following the troop switcher for the super admin. On the public dashboard and the login screen it shows the site name.

## Patrols
- **Each troop can split its scouts into patrols.** New `patrols` table (per troop, English and Arabic name) and `scouts.patrol_id`. Deleting a patrol keeps its scouts, they just end up without one; deleting a troop deletes its patrols. Nothing changes until a troop creates its first patrol: until then its list stays one group.
- **Wording:** *Patrol / Patrols* in English for every troop. Arabic says **طليعة / الطلائع**, except the Rovers troop (theme *Rovers*), which says **رهط / الرهوط**. All texts use `{unit}` / `{units}` placeholders resolved by `tu()` in `common.js`, so the word follows the troop being looked at (the dashboard's troop picker, or the troop the leader/super admin is working in).
- **Who can do what:** admins and the super admin create, rename and delete a troop's patrols in the new **Patrols** tab; any leader of the troop puts a scout in a patrol from the scout's page (a "Patrol" picker above roles and tags, only shown once the troop has patrols). The super admin works in whichever troop is selected in the switcher. A scout can only be put in a patrol of their own troop (checked on the server).
- **Lists:** both the public dashboard and the leader's scout list now show a heading per patrol (with the number of scouts) and the scouts in none at the end under "No patrol". Order inside a group is unchanged (role priority, then XP). Search also matches patrol names.
- Patrol names are public (like troop names); changes are written to the leader activity log.
- Files touched: `schema.sql`, `server.js`, `public/common.js`, `public/leader.html`, `public/index.html`, `public/style.css`, `public/i18n/en.json`, `public/i18n/ar.json`.

## Theme changes (round 2)
- **Aqua** is now *أكوا (دليلات)* in Arabic (English stays *Aqua (guides)*; key still `ocean`).
- **White** is now *أبيض (قيادي)* / *White (leaders)* (key still `white`).
- **Pink** is removed. A troop that still used it is switched to the main purple theme on the next startup.
- **Red** is split into *أحمر (مرشدات)* / *Red (guides)* (the existing theme, key `red`, so troops already using it are unchanged) and *أحمر (متقدم)* / *Red (advanced)* (new, key `red_advanced`). They look identical for now; the advanced one has its own key so its colors and logo can be changed later.

## Leaders' patrol (قيادة الفرقة)
- **Every troop has one pre-made patrol for its leaders, named قيادة الفرقة / Troop leadership.** It is always listed before every other patrol (in the Patrols tab, both scout lists and the scout's patrol picker), and it can't be renamed or deleted (new column `patrols.is_leadership`, one per troop). It has this name in every troop, Rovers included.
- **Leader accounts are in it automatically:** when an admin creates a leader account, and for all existing leaders on the next startup (this includes the super admin's own scout profile, which sits in the troop it was in). A leader account's scout profile can't be moved to another patrol (the picker shows a note instead; the server refuses it too).
- **Other scouts can still be put in it by hand** (for example a leader who has no account) from the scout's patrol picker.
- New troops get it when they are created, existing troops on the next startup. Because every troop now has this patrol, the scout lists are grouped from the start: the leaders under قيادة الفرقة and the other scouts under "No patrol" until you create patrols for them.

## Admins only, and roles with permissions
- **The "leader" account type is gone.** On the next startup every leader account becomes an admin. There are now two levels: the super admin and admins. New accounts are always admins.
- **Admins can no longer** add accounts, delete accounts, reset passwords, or see the leader activity log. (The Leaders and Log tabs are hidden for them and the server refuses these actions.)
- **Admins can now** add and delete their troop's activities (the XP list) and create, edit and delete roles and tags for their troop. Both were super admin only. The Roles & tags tab is therefore visible to every admin.
- **Roles carry permissions.** A role gets permissions when it is created: `view_log` (see the leader activity log) and `manage_accounts` (add accounts, delete them, reset passwords). They can also be changed later with the checkboxes under each role. An account's permissions are the union of the roles on its scout profile; the super admin has all. Safeguards: you can only give or take away a permission you hold yourself (creating or editing a role, and giving or removing a role from a scout); roles with permissions you lack are hidden from your role picker and can't be deleted by you; an account with `manage_accounts` can only delete or reset accounts of its own troop that hold no permission it lacks, never the super admin and never itself.
- **Permissions refresh** when the account logs in again or reloads the page (the server always checks the current roles, so a removed permission stops working at once).
- Files touched: `schema.sql` (`labels.permissions`, default account type), `server.js`, `public/leader.html`, `public/style.css`, both language files, `README.md`.


## Troop colour on the public dashboard
- The dashboard stays purple. Only the patrol headings (مجلس الشرف included), XP chips, the selected row and initial-letter avatars (shown when a scout has no photo) take the colour of the troop being viewed. Troops with the default theme stay purple.
- Done with separate `--troop*` variables (set by `setTroopTint()` in common.js, from the troop's theme), so the main theme and the leader area are untouched.

## Mods and patrols; أرهاط
- Mods (مسؤول) can now add, rename and delete patrols (the pre-made leaders' patrol stays fixed) and put scouts in them. They still have no access to activities, roles/tags, troops, accounts or the log.
- In Rovers-themed troops the patrols menu/title now reads «أرهاط» (was «الرهوط»).

## Show/hide password
- Every password field (login, add account, reset password, change password) has a Show/Hide button (إظهار / إخفاء).
- Scripts, styles and language files are now always revalidated by the browser (were cached for 5 minutes), so updates show up immediately.

## Leader accounts: in the leaders' patrol automatically, plus (optionally) their own patrol
- Every admin and mod account is automatically in the leaders' patrol (مجلس الشرف / قيادة الفرقة) and is listed under it. A new account has no regular patrol: the Add account form has no patrol field. A regular patrol (رهط) can be set later from the scout's page (the leaders' patrol itself can't be picked); the account is then listed under both.
- The super admin is never in the leaders' patrol (removed from it on startup; the server refuses to put them there).

## My account: change username and password
- The last tab is now **My account / حسابي**: every account (admin, mod, super admin) can change its own username and/or password. The current password is always required to confirm; a new password has to be typed twice (checked on the page and on the server). The username must be unused; the session stays logged in. Renames are written to the activity log.
