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

## Promote (ترفيع) and deactivate instead of delete
- **Scouts are no longer deleted.** The delete button is now **Deactivate / إيقاف الكشاف** (`PUT /api/scouts/:id/active`, new columns `scouts.active`, `deactivated_at`). An inactive scout is hidden from the public dashboard and from the default leader list, keeps all their history, can't be awarded XP, and shows under "Show inactive" where they can be reactivated. Leader accounts can't be deactivated (remove the account first). The `DELETE /api/scouts/:id` route is gone.
- **Promote / ترفيع** (`PUT /api/scouts/:id/promote`): moves a scout to another troop from their page. XP and history go with them; their patrol, roles and tags are removed (they belong to the old troop). Leader accounts can't be promoted. Logged in the activity log.
- A troop that still has inactive scouts can't be deleted.
- **Permanent delete is back for the super admin only** (`DELETE /api/scouts/:id`, a "Delete scout" button next to Deactivate that only the super admin sees). Everyone else can only deactivate. A leader account's scout still can't be deleted.

## Depot (مستودع) and the dashboard menu
- On the dashboard the **Leader area** button is now a drop-down menu: Leader area, **Depot / مستودع** (closes on outside click or Esc).
- New page `/depot.html`: the depot inventory (item name in both languages, quantity, notes; searchable). **Everyone can view and search it, no sign-in needed.** Admins and the super admin can edit and delete items; **only the super admin can add items** (enforced on the server: `GET /api/depot` public, `PUT/DELETE` admin, `POST` super admin). Everyone else sees a small notice that you need to be logged in as an admin to edit (no link to the leader area). The same Leader area / Depot drop-down menu is in the header of both the dashboard and the depot page. One shared inventory (not per troop), new table `depot_items`, changes are written to the activity log.
- The header menu is now the same on the dashboard, the leader area and the depot: the button shows the page you are on, and the list holds the other two pages (built by `paintMenu()` in `common.js`, follows the language).
- Phone header: the language (and logout) buttons are compact and the menu button fills the rest of the row; the drop-down list is wider with larger tap targets.
- Header polish: the menu arrow is now a small centred chevron (points down, flips up when open) instead of a text glyph; on phones the title stays on one line with the small caption (and signed-in name) under it.
- The dashboard header caption is now a welcome text: «مرحبا بك في منصة الفوج الثاني» (English: Welcome to the Second Troop platform).
- The header menu has a **Sign in / تسجيل الدخول** option (last item, set apart by a line) for visitors who aren't signed in; it opens the sign-in form on the leader page. It is hidden once you are signed in and on the leader page itself.
- Welcome caption: English now reads «Welcome to the Scout Troop 2 platform». When signed in, the dashboard greets the account by the first word (first name) of the display name on its scout profile (`/api/me` and login now return `display_name`): «مرحبا بك {name} في منصة الفوج الثاني».

## Sign-in redirect and stay signed in
- Signing in no longer lands you in the leader area: you go back to the page you came from (the header's Sign in link remembers it) or to the dashboard. The leader area is still one click away in the header menu.
- You now stay signed in until you press Sign out: the session cookie lasts ~400 days (the browser maximum) and is renewed every time you open a page, so it never expires while you keep using the site. Keep `JWT_SECRET` the same on Render, otherwise everyone is signed out when it changes.

## Meetings attendance register (سجل حضور اجتماعات)
- New tab **سجل حضور اجتماعات / Meetings attendance** in the leader area. Every troop keeps its own register (the super admin sees the troop picked in the troop switcher).
- Add a meeting (date + optional title), open it and tick the scouts who were present; each tick is saved immediately. Scouts are grouped by patrol, the leaders' patrol first. **Mark everyone present** / **Clear all** buttons, and the meeting's date/title can be edited.
- The list shows how many were present at each meeting, and **Attendance per scout** shows meetings attended out of the meetings held since the scout joined, with a percentage (best attendance first).
- Leader-only (nothing on the public dashboard). Admins, mods and the super admin can take attendance; deleting a meeting is closed to mods. Adding, editing and deleting meetings is written to the activity log.
- New tables `meetings` and `meeting_attendance` (created automatically on startup; no existing data touched). New routes: `GET/POST /api/meetings`, `GET/PUT/DELETE /api/meetings/:id`, `PUT /api/meetings/:id/attendance[/:scoutId]`, `GET /api/attendance/summary`.

## My account moved to the header menu; Sign out moved into it
- In the header drop-down menu, the last row (where **Sign in** shows for visitors) becomes **My account / حسابي** once you are signed in. It opens the new page `/account.html` with the change-username/password form and the **Log out** button.
- The **My account** tab and the **Log out** button are gone from the leader area. Visitors who open `/account.html` are sent to sign in and come back to it afterwards; logging out returns to the dashboard.

## Fix: blank site after the My account change
- A comment added to `common.js` in the previous update swallowed the rest of its line and broke the script, so every page loaded blank. Fixed; every script and page was syntax-checked again and every element id and translation key the pages use was verified.

## Speed and cleanup pass
- **Fewer database round trips on every signed-in request.** The account and its permissions are now fetched together (was two queries one after the other); the troop list (themes, names) is kept in memory for a minute and refreshed immediately when a troop is added, edited or deleted, so most requests no longer query `troops` at all (including every visit to the dashboard); login, `/api/me` and a scout's page run their independent lookups at the same time instead of one by one.
- **XP totals are looked up per scout** (through the existing `xp_log` index) instead of summing the whole XP table on every list request, so the scout lists stay fast as the history grows. New index on `leaders.scout_id` for the leader-account checks in the lists.
- **One session check per page** instead of two: `common.js` asks `/api/me` once and the leader, depot and account pages reuse the answer.
- Cleanups: the login-attempt memory is pruned (it used to grow forever), the duplicate cache rules and the unneeded optional-`compression` fallback were removed, shared permission code is in one place, and a few misplaced comments were moved next to the code they describe.

## Fix pass before new features (first run against a real database)
Everything was run for the first time against a real PostgreSQL 17: a fresh install, a restart, an upgrade from the previous version (existing data and sign-ins carry over), an API test of every route and permission rule (106 checks), and the pages in a browser.

**Security**
- **Password changes and resets now sign the account out.** Sessions last ~400 days, so before this a reset never actually took anyone's access away. New column `leaders.session_v` (added automatically); every cookie carries it and a reset raises it. Your own password change keeps the current browser signed in and signs out the others. `reset-password.js` does the same. Nobody is signed out by deploying this.
- **Sign-in redirect could send people to another site** (`/leader.html?next=/\evil.com` passed the check). It now only goes to pages of this site.
- Photos of deactivated scouts are no longer public (the rest of their page already wasn't).
- Basic browser protection headers (no framing of the site, no MIME sniffing, same-origin referrer).
- The sign-in limit (10 per 15 minutes per IP) now counts failed attempts only, so leaders sharing one connection aren't locked out by normal use.

**Server errors**
- An impossible date (e.g. 2025-02-31), an id that is too large, broken JSON or a too-large request answered with a 500 or an untranslated message. They now answer "check the details you entered" (or a new "too large" message).

**Leader area**
- **Double-clicking Award gave the XP twice** (also duplicated scouts, meetings, depot items...). A form is now locked while its request is running.
- **A slow reply could show the wrong scout**, and after a troop switch picking a role there could wipe that scout's roles and tags. Replies for a scout or troop that is no longer selected are now dropped; rapid troop switching ends on the right troop.
- **Attendance sheet:** an account that is listed twice (leaders' patrol + its own patrol) had two checkboxes that didn't stay in step, and "Mark everyone present" only updated one of them. Both copies now follow each other.
- Meeting dates defaulted to the UTC day (yesterday until 03:00 in Syria) and the date picker blocked today. They now use the local day.
- Patrol counts in the Patrols tab now match the lists (active scouts only, and the leaders' patrol counts the accounts in it; it used to show 0).
- After adding a tag, the permissions box of the next role stayed hidden.
- Switching language no longer throws away text typed in the scout details form.
- Clicking inside the confirmation popup's padding no longer cancels it.

**Depot:** text typed in one row is no longer lost when another row is saved or deleted, or when searching.

**Wording:** a few Arabic texts said رهط in every troop; they now follow the troop's word (رهط / طليعة). Unknown error codes show the general error text instead of a raw key. Removed an unused text key.

**README** rewritten to match the code: three account levels (including mod), sessions and password resets, the full API list, deactivate/promote instead of delete, the leaders' patrol names, and the Troubleshooting advice to delete all accounts (that would remove every account) was replaced.

Files touched: `server.js`, `schema.sql`, `reset-password.js`, `public/common.js`, `public/leader.html`, `public/depot.html`, both language files, `README.md`.

## Handoff notes
- README now starts with "Working on this project": update `CHANGES.md` and `README.md` with every change, no database testing unless asked, and send the whole project back as a zip (without `node_modules`).

## Depot: tidier list, adding and quantities
- **Items are no longer shown as open forms.** Every row is read-only, like visitors see it: name, notes, and the quantity. Admins and the super admin get a small **Edit** button per row that opens that one row as a form (both names, quantity, notes) with Save, Cancel and Delete (set apart at the end). Only one row is open at a time; Cancel or Esc closes it and drops the typed changes.
- **Adding is behind one button.** The super admin sees **+ Add item** next to the title; it opens a short form (Arabic name first, then English, quantity, notes) that closes again after adding or on Cancel/Esc. The new item is briefly highlighted in the list.
- **Quantities are clear.** Each item's quantity sits in its own box with a "الكمية / Quantity" caption and a larger number; at 0 the box turns red and reads "نفدت / Out of stock".
- **The count says what it counts:** "المواد المسجلة / Items listed" with the number in a pill, and "3 من 12 / 3 of 12" while searching.
- New text keys: `depot_of`, `depot_out` (and new wording for `depot_total`). Files touched: `public/depot.html`, `public/style.css`, both language files, `README.md`.
- Not tested against a database (checked with sample data only).

## Wording: المستودع
- The Arabic name of the depot is now **المستودع** (was مستودع) in the header menu and under the site name on the depot page (`depot` key in `public/i18n/ar.json`). English is unchanged.

## Depot reservations (build 34)
- **Admins, mods and the super admin can reserve depot items for a time window.** Each item has a **حجز / Reserve** button (hidden when the quantity is 0) that opens a booking form in its row: from / to (date and time), how many, an optional note. While the times change, the form shows "المتوفر في هذا الوقت / Available at this time: N".
- **No overbooking:** the server locks the item while booking and refuses (`not_available`, with how many are free) if the quantity plus everything booked in an overlapping window would go over the item's quantity. Every overlapping booking counts, which is simple and never overbooks. Windows end in the future and are at most 60 days.
- **Upcoming reservations** list under the inventory (signed-in accounts only): item × quantity, the time window, who booked it, their troop and the note; the one running now is marked "جارٍ الآن / Now". Items also show "محجوز الآن / Reserved now: N" while a booking is running.
- **Cancelling:** the one who booked can cancel it; admins and the super admin can cancel anyone's. Bookings and cancellations go to the activity log. Deleting a depot item deletes its bookings.
- New table `depot_reservations` (created automatically on startup). New routes `GET /api/depot/reservations`, `POST /api/depot/:id/reservations`, `DELETE /api/depot/reservations/:id`. New text keys `depot_reserve`, `depot_from`, `depot_to`, `depot_free`, `depot_reserved_now`, `depot_res_*`, `err_not_available`, `audit_depot_reserve`, `audit_depot_unreserve`. Date-and-time fields now get the standard input style.
- Files touched: `schema.sql`, `server.js`, `public/depot.html`, `public/leader.html` (log wording), `public/style.css`, both language files, `README.md`. Not run.

## Depot reservations by troop, with a basket (build 35, "basket")
- **Reservations are now made for a troop, not for a person.** Admins and mods always book for their own troop (every admin/mod account belongs to one). The super admin belongs to none, so the basket shows a **باسم الفرقة / For troop** picker (defaults to the troop last used in the leader area). Admins and mods see "الحجز باسم: {troop} / Reserving for: {troop}" instead.
- **A basket instead of one item at a time.** Each item's **Reserve** button is now **أضف إلى السلة / Add to basket** (it then reads "✓ في السلة / In basket"; pressing it again takes the item out). The **سلة الحجز / Reservation basket** opens above the search box with: the troop, one from / to window for the whole basket, one line per item (quantity, "Available at this time: N" for that window, red when asking for more, × to remove), an optional note, **احجز محتويات السلة / Reserve the basket** and **إفراغ السلة / Empty basket** (asks first). The basket, window and note are kept in the browser (`localStorage` key `depot_basket`) until booked or emptied; items deleted from the depot meanwhile drop out of it. A floating "Basket (N)" button scrolls back to it while it is out of view.
- **All or nothing:** the server locks every item in the basket (in id order, so two baskets can't deadlock), checks each against every overlapping booking, and refuses the whole basket (`409 not_available` with `short: [{item_id, available}]`) if any item hasn't enough; the page then reloads what is free so the short lines turn red.
- **Upcoming reservations** now shows one entry per booking: the troop (bold), the items × quantities, the window, "حجزه / Booked by {name}" and the note. Your own troop's bookings have a coloured edge.
- **Cancelling** cancels the whole booking: the one who made it, the **admins of that troop**, and the super admin (before: any admin could cancel anyone's). Mods only their own.
- **Activity log:** bookings and cancellations are now written to the log of the troop they are for (before: to no troop, so only the super admin saw them), as `depot_book` / `depot_unbook` with the list of items in both languages. Old `depot_reserve` / `depot_unreserve` entries still show.
- **Database:** new tables `depot_bookings` (troop, window, note, who) and `depot_booking_items` (booking, item, quantity). On the first startup the build 34 table `depot_reservations` is converted (each old row becomes a one-item booking of its troop; the super admin's, which had no troop, go to the first troop) and dropped. Deleting a depot item removes it from every booking, and a booking left empty is removed.
- **Routes:** `GET /api/depot/bookings`, `POST /api/depot/bookings` (`items`, `starts_at`, `ends_at`, `note`, `troop_id` for the super admin), `DELETE /api/depot/bookings/:id`. Removed: `GET /api/depot/reservations`, `POST /api/depot/:id/reservations`, `DELETE /api/depot/reservations/:id`.
- **Text keys:** new `depot_basket`, `depot_basket_add`, `depot_in_basket`, `depot_basket_remove`, `depot_basket_clear`, `depot_basket_confirm`, `depot_for`, `depot_for_troop`, `depot_book`, `depot_booked`, `depot_by`, `audit_depot_book`, `audit_depot_unbook`; removed `depot_reserve`.
- **Handoff:** zips are now saved in the working folder as `scout-app-troops_NN (word).zip` (see README, "Working on this project").
- Files touched: `schema.sql`, `server.js`, `public/depot.html`, `public/leader.html` (log wording), `public/style.css`, both language files, `README.md`. Not run against a database; `server.js` and the page scripts pass a syntax check, and every text key the depot page uses exists in both language files.

## Fix: the basket is per account (build 36, "account")
- The reservation basket was saved in the browser under one shared key, so signing in as another account on the same browser showed the previous account's basket. It is now saved per account (`localStorage` key `depot_basket:<username>`); the old shared key `depot_basket` is deleted on the next depot page load. Signing back in as the same account on that browser brings its basket back; a renamed account starts with an empty one.
- File touched: `public/depot.html`, `README.md`. Not run; the page script passes a syntax check.

## Reserved by the display name (build 37, "name")
- Upcoming reservations now say **تم الحجز بواسطة {name} / Reserved by {name}** (was "Booked by" with the username). The name is the display name on the booker's scout profile, read when the list is loaded (so a renamed profile shows its new name); if the account no longer exists, the username saved with the booking is shown. Text key `depot_by` reworded in both languages.
- Files touched: `server.js` (`GET /api/depot/bookings` joins leaders and scouts), both language files, `README.md`. Not run; `server.js` passes a syntax check.

## Reservation history (build 38, "history")
- Finished reservations were never deleted, they only dropped off the Upcoming list. A new **الحجوزات السابقة / Past reservations** section under it (closed until opened, signed-in accounts only) lists them: latest first, up to 200, same details (troop, items, window, who reserved, note), slightly faded, no cancel button. It loads when opened and refreshes with the page data while open.
- Cancelled reservations are still deleted for good (only the activity log keeps them).
- `GET /api/depot/bookings?past=1` returns the history. New keys `depot_past_title`, `depot_past_none`. Files touched: `server.js`, `public/depot.html`, `public/style.css`, both language files, `README.md`. Not run; scripts pass a syntax check.

## Private details on the dashboard, the Leader account type, no more role permissions (build 39, "leader")
- **Dashboard shows a scout's private details to signed-in accounts, read-only.** Under the scout's name/XP, a **التفاصيل الخاصة / Private details** card lists the fields set in the leader area (full name, phone as a tap-to-call link, join date, date of birth, guardian name and phone, address, medical notes, other notes; empty ones are skipped) and the scout's **tags**, with an **Edit in the leader area** button (it also remembers the scout's troop for a leader/super admin). Editing stays in the leader area only. It uses `GET /api/leader/scouts/:id`, which now also returns `tags`; admins and mods get it for scouts of their own troop only (another troop's scout shows just the public page), the super admin and leaders for every troop. Visitors never call it. The page asks `/api/me` once before the first scout opens (`staff`) and keeps the private copy in memory only (`privCache`), never in `localStorage`.
- **New account type: Leader / قائد** (`leaders.role = 'leader'`; the value was already allowed by the database). Like an admin, but it has a **home troop and can jump between troops with the troop switcher, like the super admin** (the server treats `X-Troop` from a leader like the super admin's, falling back to the leader's home troop). It has **no Roles & tags** (tab hidden, the roles/tags block on a scout's page hidden, `POST/PUT/DELETE /api/labels` and `PUT /api/scouts/:id/labels` refuse it), and **no Troops, Leaders or Activity log** tabs/routes. It can edit/remove depot items (not add), reserve for any troop (troop picker in the basket, like the super admin) and cancel any reservation. Created by the super admin in the Leaders tab (new "Leader" choice in the account type list). The account type table is in the README.
- **Role permissions are gone.** Roles no longer carry *view_log* / *manage_accounts*: the permissions box on the add-role form, the checkboxes under each role, `permissions` in the label routes and `perms` in `/api/login` and `/api/me` are removed, along with the code that checked and limited them. **Accounts (Leaders tab) and the activity log are now super admin only**, so an admin that had been given those through a role has lost them. `labels.permissions` stays in the database, unused. Text keys `perm_view_log`, `perm_manage_accounts`, `role_perms`, `role_perms_hint` removed.
- **Startup:** the step that turned every `leader` account into an admin on each start is removed (it would have demoted the new Leaders).
- New text keys: `private_info`, `private_view_hint`, `private_edit`, `private_none` (both languages). New CSS for the card (`.priv`, `.priv-dl`); the permission checkbox styles are removed.
- Files touched: `server.js`, `schema.sql` (comment), `public/index.html`, `public/leader.html`, `public/depot.html`, `public/style.css`, both language files, `README.md`. Not run against a database; `server.js` and the page scripts pass a syntax check.

## Fix: every signed-in account sees the private details, in any troop (build 40, "everyone")
- Build 39 showed the dashboard's private details card to admins and mods only for scouts of their own troop. Now **every signed-in account sees it for scouts of any troop**, read-only: `GET /api/leader/scouts/:id` no longer limits reading to the account's troop (editing, `PUT /api/scouts/:id`, is still limited). The **Edit in the leader area** button only shows where the account may edit (its own troop; any troop for the super admin and leaders).
- Files touched: `server.js`, `public/index.html`, `README.md`. Not run; syntax-checked.

## Fix: phone number alignment in the dashboard's private details (build 41, "alignment")
- On desktop the phone number (and any English value) sat at the far end of its row instead of next to its label: each value's direction was chosen from its own text, and digits alone count as left-to-right in a right-to-left page. Values now keep the page direction (so they start right beside their label) and are wrapped in `<bdi>` so each still reads correctly; the phone link is an isolated left-to-right inline.
- Files touched: `public/index.html`, `public/style.css`. Not run.
