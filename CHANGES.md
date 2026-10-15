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
- New tab "الأدوار والأوسمة" (Roles & tags): create/delete roles and tags with English and Arabic names. Assign from a scout's page with chips and an add dropdown. Leader-only.
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

## Attendance: buttons, events, automatic XP (build 42, "attendance")
- **Renamed** the tab to **الحضور / Attendance** (was "Meetings attendance / سجل حضور اجتماعات").
- **Buttons instead of checkboxes:** each scout on a sheet has a **تحضير / Mark present** button that turns into a filled **✓ حاضر / Present** one (and back). It is disabled while saving, and an account listed twice (leaders' patrol + its own patrol) stays in step. A short message shows the XP given or taken back.
- **Events next to meetings:** new `meetings.kind` (`meeting` or `event`, existing rows are meetings). The add form and the sheet have a **Type** choice; the list and the sheet show a small type tag. They share one register, and the per-scout percentage counts both.
- **Automatic XP:** marking a scout present gives **10 XP** (`ATTENDANCE_XP` in `server.js`) as an ordinary XP entry named "Meeting attendance" / "Event attendance" (حضور اجتماع / حضور فعالية), dated the meeting's day, with the meeting's title as the note, so it shows in the scout's history and total. New `xp_log.meeting_id` links it to the meeting, with a unique index (one per scout per meeting, so it can't be given twice). Unmarking a scout, "Clear all" or deleting the meeting removes the entries (`ON DELETE CASCADE`); editing the meeting's date, title or type updates them. "Mark everyone present" only gives XP to scouts not already marked. Attendance marked earlier gave no XP and still doesn't; marking it again after unmarking does.
- Texts: reworded `tab_attendance`, `att_hint`, `att_new_meeting`, `att_meetings`, `att_none_yet`, `att_back`, `att_summary_hint`, `confirm_delete_meeting`, `audit_meeting_*`; new `att_type`, `att_kind_meeting`, `att_kind_event`, `att_mark`, `att_present`, `att_xp_hint`, `att_xp_plus`, `att_xp_minus`.
- Files touched: `schema.sql`, `server.js`, `public/leader.html`, `public/style.css`, both language files, `README.md`. Not run against a database; scripts pass a syntax check.

## Fix: scout page in the leader area failed to open (build 43, "scoutfix")
- Opening a scout in the leader area threw an error and left the page empty. Cause: when role permissions were removed in build 39, the helper `locked()` was deleted but the role/tag chips on the scout page still called it. The call is gone; role and tag chips on the scout page can all be removed again by those who may edit roles/tags (admins and the super admin).
- This time the pages were also loaded in a browser against a stand-in API (no database) as an admin, leader, mod and super admin: the leader area (tabs shown per level, a scout's page, the attendance list and a sheet with the new buttons), the dashboard's private details card and the depot basket all opened with no script errors. Earlier builds had only been syntax-checked, which can't catch a missing function.
- File touched: `public/leader.html`.

## Attendance: logged, required title, chosen XP (build 44, "xpchoice")
- **The attendance XP is listed.** The XP entry in the scout's history is now named **"Attended <title>" / "حضر <title>"** (was "Meeting attendance"). Marking a scout present or unmarking them is also written to the **leader activity log**: "<scout> attended <title> (+10 XP)" / "took back attendance of <scout> — <title> (-10 XP)"; "Mark everyone present" and "Clear all" write one entry for the whole sheet ("marked scouts present at <title>: 12 (+10 XP)"). Nothing is logged when the XP is 0.
- **The title is required** for meetings and events (the form, the sheet and the server; the label no longer says optional). Older meetings without a title must be given one the next time they are saved.
- **The XP is chosen per meeting/event.** New **XP for attending** field on the add form (default 10, 0 to 1000, 0 = no XP) and on the sheet. New `meetings.xp` column (existing meetings get 10). Changing it on the sheet updates the XP already given (0 removes those entries; raising it from 0 gives it to scouts already marked present). The fixed `ATTENDANCE_XP` constant is gone.
- New texts: `att_xp`, `att_xp_field_hint`, `att_xp_none`, `audit_attendance`, `audit_attendance_undo`, `audit_attendance_bulk`, `audit_attendance_bulk_undo`; `att_title` is now just "Title / العنوان". New audit actions `attendance`, `attendance_undo`, `attendance_bulk`, `attendance_bulk_undo`.
- Files touched: `schema.sql`, `server.js`, `public/leader.html`, both language files, `README.md`. The leader pages were loaded in a browser against a stand-in API (form, sheet, activity log text: no script errors); the new SQL has not been run against a database.

## Leader without activities, absence XP, meeting search, custom awards (build 45, "custom")
- **Leaders no longer have the Activities tab**, and the server refuses `POST/DELETE /api/activities` for them (admins and the super admin only; mods never had it). Leaders can still award XP from the troop's list. The Leader account type stays.
- **Not attending can take XP away.** Each meeting/event has a second value, **XP taken for not attending** (default 0 = none; new `meetings.absent_xp`). Each scout on a sheet now has **Mark present** and **Mark absent** buttons (pressing the lit one clears the mark, red when absent); a scout marked absent gets a negative XP entry **"Absent: <title>" / "غاب عن <title>"**. Changing a mark takes the old mark's XP back and gives the new one's (a short message shows the net change); the counter shows present and absent. New **Mark the rest absent** next to Mark everyone present / Clear all. Absences are stored in the new table `meeting_absences` (a scout is present, absent or neither; one XP entry per scout and meeting). The API changed from `{ present: true/false }` to `{ status: 'present' | 'absent' | 'none' }`. Absence marks with XP go to the activity log (`absence`, `absence_undo`, `absence_bulk`, `absence_bulk_undo`). Unmarking someone who was present already took the attending XP back; that is unchanged.
- **Search and filter for meetings and events:** a search box (title, date as written or as YYYY-MM-DD, type) and a type filter (All / Meeting / Event) above the list.
- **Custom awards:** the XP award form on a scout's page has a **Custom…** choice next to the troop's activities: a title and an XP value (any whole number but 0, negative deducts), with the usual date and note; `POST /api/scouts/:id/xp` accepts `{ custom: true, title, xp }`. It is stored as a normal XP entry (no activity link) and logged as an award.
- New texts: `att_absent_xp`, `att_absent`, `att_mark_absent`, `att_rest_absent`, `att_absent_count`, `att_absent_hint`, `att_xp_change`, `att_search`, `att_kind_all`, `activity_custom`, `custom_title`, `custom_xp`, `custom_xp_hint`, `audit_absence*`; `att_xp_field_hint` reworded; `att_xp_plus` / `att_xp_minus` removed.
- Files touched: `schema.sql`, `server.js`, `public/leader.html`, `public/style.css`, both language files, `README.md`. The leader area was loaded in a browser against a stand-in API (tabs per level, the sheet with the new buttons, the search and filter, the Custom option); the new SQL has not been run against a database.

## Own-troop dashboard details, interests, troop levels, Administration menu (build 46, "levels")
- **Admins and mods only see their own troop's private details on the dashboard.** Build 40's change is reverted: `GET /api/leader/scouts/:id` is limited to the account's troop again (the super admin and leaders still get every troop). Another troop's scout shows just the public page for them.
- **"Other notes" is now "Interests / hobbies" (الاهتمامات / الهوايات)** in the scout form and the dashboard card. The column (`scouts.notes`) is unchanged, so what was typed stays.
- **Troops have levels.** New `troops.level` (existing troops get their creation order, edit it in the Troops tab; the add form has a Level field, empty = above all existing troops; the list shows each troop's level and is ordered by it). **Promotion only goes up:** the Promote list on a scout's page offers just troops of a higher level than the scout's current one, and `PUT /api/scouts/:id/promote` refuses anything else (`not_higher`, 400). `/api/troops` now returns `level`.
- **Leaders and Activity log moved into a collapsed "الإدارة / Administration" menu** at the end of the tab row, shown only to the super admin (the same buttons, so nothing else changed). It closes after choosing, on Esc, on an outside click and when the row scrolls; its title is lit while one of those pages is open. The list is positioned by script (fixed) so the sideways-scrolling tab row can't clip it.
- New texts: `tab_admin`, `troop_level`, `troop_level_hint`, `err_not_higher`; reworded `d_notes`, `promote_hint`.
- Files touched: `schema.sql`, `server.js`, `public/leader.html`, `public/style.css`, both language files, `README.md`. Checked in a browser against a stand-in API (menu for the super admin and not for an admin, its list and the log page, troop levels in the Troops tab, an admin's promote list showing only higher troops); the new SQL has not been run against a database.

## Depot: take now, put back (build 47, "takeout")
- **Reserving is gone: items are taken at once.** The basket's **Reserve the basket** is now **اسحب الآن / Take now**, and the from/to window is replaced by a single **Taken at** that is the current date and time by default (it follows the clock until edited; an edited time is sent, never in the future, at most 60 days back; otherwise the server uses its own "now").
- **Put back:** each take under **المواد المسحوبة حالياً / Taken right now** has a **إرجاع / Put back** button (the whole take) for the one who took it, the admins of its troop, and the super admin and leaders. What is out counts against the stock until it is put back (available now = stock minus what is out), so the basket's lines show "Available now". Items show "Taken now: N". A **السجل (تم الإرجاع) / History (put back)** section lists put-back takes (latest 200). The take's time and the put-back time are shown. Taking and putting back are written to the troop's activity log (`depot_take`, `depot_return`; the old reservation entries still show).
- **Database:** new tables `depot_takes` (troop, `taken_at`, `returned_at`, note, who) and `depot_take_items`. The reservations of builds 34-46 are converted on the first start: the ones that had already started become takes (taken at their start; put back at their end if that has passed, otherwise still out, so they can be put back by hand), the ones that hadn't started are dropped. The old tables (`depot_bookings`, `depot_booking_items`, `depot_reservations`) are then dropped.
- **Routes:** `GET /api/depot/takes` (`?returned=1` history), `POST /api/depot/takes`, `PUT /api/depot/takes/:id/return`. Removed: the `/api/depot/bookings` routes.
- Texts reworded for taking/putting back (`depot_free`, `depot_reserved_now`, `depot_res_*`, `depot_past_*`, `depot_basket`, `depot_for`, `depot_book`, `depot_booked`, `depot_by`, `err_not_available`); new `depot_taken_at`, `depot_returned_at`, `depot_put_back`, `audit_depot_take`, `audit_depot_return`; removed `depot_from`, `depot_to`, `depot_res_active`.
- Files touched: `schema.sql`, `server.js`, `public/depot.html`, `public/leader.html` (log wording), both language files, `README.md`. The depot page was loaded in a browser against a stand-in API (basket with the now default, no date window, taking, the list, put back with its confirmation, the history); the new SQL (including the conversion) has not been run against a database.

## Depot: items on separate lines, clearer quantities (build 48, "lines")
- In **Taken right now** and the **History**, each take now lists its items **one below the other** (they used to run together on one line separated by commas), each line with the **quantity in its own badge** ("× 2", bold, on a filled pill; greyed in the history) at the end of the line.
- Files touched: `public/depot.html`, `public/style.css`. Checked in a browser against a stand-in API.

## XP system per troop (build 49, "xpoption")
- **Each troop chooses whether it uses XP**: new `troops.xp_enabled` (default on, so nothing changes until a troop is switched off), a **"This troop uses the XP system"** checkbox on the Troops tab's add form and edit row (a troop without it is tagged "no XP" in the list). `/api/troops` returns the flag; the Troops routes accept it.
- **When off:** no XP numbers in the dashboard and leader scout lists (ordered by role priority, then name), no XP badge or activity history on a scout's page (dashboard and leader area), no Activities tab and no award form (custom awards included) in the leader area; the server refuses awards (`xp_disabled`, 409); meetings and events get no XP fields, store 0, and attendance gives or takes nothing (editing a meeting then leaves the stored XP values and entries alone; clearing marks still removes the entries they gave). Stored XP is never deleted by switching the system off.
- The pages follow the troop being looked at: the dashboard remembers each troop's setting for the first paint; the leader area applies it on every troop switch (tabs are re-evaluated).
- New texts `troop_xp`, `troop_xp_hint`, `troop_xp_off`, `err_xp_disabled`. Files touched: `schema.sql`, `server.js`, `public/common.js` (`setXpEnabled`), `public/index.html`, `public/leader.html`, `public/style.css`, both language files, `README.md`. Checked in a browser against a stand-in API with the system off and on (lists, scout page, tabs, attendance, dashboard, the Troops tab checkboxes); the new SQL has not been run against a database.

## Dashboard: show / hide photos (build 50, "photos")
- A **إخفاء الصور / Hide photos** button (**إظهار الصور / Show photos** when hidden) under the dashboard's search box. Hidden: the list and a scout's page show the initial-letter avatar instead of the photo, and photos aren't downloaded. It is the visitor's own choice, remembered in their browser (`localStorage` key `photos`); the default is shown. The leader area never hides photos.
- Implemented with `setPhotos()` / `avatar()` in `common.js` (only the dashboard calls it). New texts `photos_hide`, `photos_show`. Files touched: `public/common.js`, `public/index.html`, `public/style.css`, both language files, `README.md`. Checked in a browser against a stand-in API (toggle, remembered after reload, leader area unaffected).

## Hide the picture on the dashboard (build 51, "hidepic")
- On a scout's page in the leader area, next to the picture buttons in the details form, a new button **إخفاء الصورة في قائمة الكشاف / Hide picture on the dashboard** (it turns into **Show picture on the dashboard**, with a note while hidden). The picture is kept and still shows in the leader area; on the dashboard the scout gets the initial-letter avatar instead, in the list and on their page.
- New `scouts.photo_hidden` column. The public routes (`GET /api/scouts`, `GET /api/scouts/:id`) report `has_photo` false when hidden and the photo route answers 404 to visitors (signed-in accounts still get it, which the leader area needs). The leader routes (`GET /api/leader/scouts[/:id]`) return the real `has_photo` and `photo_hidden`; `PUT /api/scouts/:id/photo-hidden` (`hidden`: true/false) switches it, for scouts of the account's own troop(s), and is written to the activity log (`photo_hide`, `photo_show`).
- New texts `hide_photo`, `show_photo`, `photo_hidden_note`, `audit_photo_hide`, `audit_photo_show`. Files touched: `schema.sql`, `server.js`, `public/leader.html`, both language files, `README.md`. Checked in a browser against a stand-in API (button, note, picture kept in the leader area, avatar on the dashboard); the new SQL has not been run against a database.

## Attendance for mods, excused absences; dashboard photo toggle removed (build 52, "excuse")
- **The dashboard's "Hide photos / Show photos" button (build 50, "photos") is removed**, with its code (`setPhotos`) and texts. Photos on the dashboard are shown again for everyone; the per-scout **Hide picture on the dashboard** button in the leader area (build 51) stays.
- **Mods no longer add or edit meetings/events.** A mod only opens a meeting and marks present / absent: the add form is hidden for mods, the sheet shows no date/title/type/XP fields or Save button, and `POST` and `PUT /api/meetings` refuse mods (as `DELETE` already did). Leaders, admins and the super admin are unchanged.
- **Absent with an excuse / without.** Each scout on a sheet has three buttons: **Mark present**, **غائب بلا عذر / Absent, no excuse** (loses the meeting's absence XP) and **غائب بعذر / Absent, excused** (**no XP taken**). New `meeting_absences.excused` column (existing absences count as no excuse). `PUT /api/meetings/:id/attendance/:scoutId` takes `status`: `present`, `absent`, `excused` or `none`; the meeting detail returns `absent_ids` (no excuse) and `excused_ids`. "Mark the rest absent" marks the unmarked scouts absent without an excuse (excused ones stay). Changing between marks takes the old one's XP back and gives the new one's (a short message shows the net change); the counter shows present, no excuse and excused. Editing a meeting's absence XP only affects the unexcused. An excused mark is logged (`absence_excused`, no XP); the "XP taken for absence" field is now labelled "…without an excuse".
- New texts `att_mark_excused`, `att_excused`, `att_excused_count`, `audit_absence_excused`; reworded `att_mark_absent`, `att_absent`, `att_rest_absent`, `att_absent_count`, `att_absent_xp`, `att_absent_hint`, `audit_absence`; removed `photos_hide`, `photos_show`.
- Files touched: `schema.sql`, `server.js`, `public/common.js`, `public/index.html`, `public/leader.html`, `public/style.css`, both language files, `README.md`. Checked in a browser against a stand-in API (as a mod and an admin: the form and fields hidden/shown, the three buttons and their messages, the dashboard without the photo button); the new SQL has not been run against a database.

## Phones: a scout's page replaces the list (build 53, "phone")
- **No more scrolling down the whole list.** On phones (width up to 760px), tapping a scout used to scroll smoothly past the entire list to the page below. Now the page opens **on its own screen at the top** with the list hidden, and a **← Back to the list / العودة إلى القائمة** button stays in view while scrolling; the phone's own back button does the same (one history step is added when a page opens). Going back **returns to the exact spot in the list**. Same in the leader area's Scouts tab; if the open scout disappears (deactivated, promoted, troop switch) it goes back to the list by itself. Wider screens are unchanged (list and page side by side).
- Implemented with `openDetailView` / `closeDetailView` / `leaveDetailView` in `common.js`, a `#backList` button and the `show-detail` class on the `.cols` element (dashboard `main`, leader `#tab-scouts`); the old `scrollIntoView` calls are gone. New text `back_to_list`. Files touched: `public/common.js`, `public/index.html`, `public/leader.html`, `public/style.css`, both language files, `README.md`. Checked in a browser at 375px wide against a stand-in API (tapping a scout deep in the list, the Back button and the phone's back restoring the scroll position, the leader area).

## Add scout in its own tab (build 54, "addtab")
- The **Add scout / إضافة كشاف** form moved out of the Scouts tab into a new tab right after it (before Activities and Patrols; shown to everyone who has Scouts, mods included). The name field is focused when the tab opens; after adding, the app returns to the Scouts tab with the new scout open (on phones, on the scout's own screen). The Scouts tab is now just the search, the list and the scout's page.
- No new text (the tab reuses `add_scout`). Files touched: `public/leader.html`, `README.md`.

## Add scout: the whole form (build 55, "fullform")
- The Add scout tab now holds **the same form as a scout's details** instead of a single name box: display name (required), full name, phone, join date, date of birth, guardian name and phone, address, medical notes and interests / hobbies, with the same hints, the digits-only phone fields and the same limits. After adding you land on the Scouts tab with the new scout open (picture, patrol, roles and tags are set there).
- `POST /api/scouts` accepts all of those fields (optional except `name`) and checks them exactly like `PUT /api/scouts/:id` does. No new texts (the labels reuse the details form's). Files touched: `server.js`, `public/leader.html`, `README.md`. Checked in a browser against a stand-in API; `server.js` passes a syntax check and its SQL has not been run against a database.

## Phones: no scout page under the list after Back (build 56, "listonly")
- On phones, going back from a scout's page left the page (the details form) stacked **under the list**. Now the list shows alone and the page only appears while a scout is open (`.cols:not(.show-detail) > section:nth-of-type(2)` is hidden on phones; dashboard and leader area). Wider screens are unchanged. File touched: `public/style.css`.

## Aqua (guides) logo (build 57, "aqualogo")
- The **Aqua (guides)** theme (key `ocean`) now uses the **fleur-de-lis outline** you sent instead of the Girl Guides trefoil badge, drawn in **beige** (the beige of the original picture, `rgb(250,228,204)`) on a transparent background so it shows on the blue header. The artwork was converted to a 320px transparent PNG and the strokes were thickened slightly so the thin outline stays readable at header size.
- New file `public/logo-guides-v2.png` (a new name on purpose: logos are cached by browsers for a week); `public/logo-guides.png` is deleted. `THEMES.ocean.logo` in `public/common.js` points to the new file. Nothing else changed (no white badge, same size as the other logos). Checked in a browser with a stand-in troop using the Aqua theme.

## Roles and tags: new ones are added at the end (build 58, "tagorder")
- On a scout's page (and in the leader area's scout list) the roles and tags were shown in the order of the troop's role list (priority, then name), so a newly added one could land in the middle or at the start and push the others. They now keep **the order they were given in: a new one goes last, at the left end of the row** (the layout is right to left), and the existing ones don't move. The same order is used for the chips under each name in the leader list.
- New `scout_labels.pos` column (existing assignments keep their label order); `PUT /api/scouts/:id/labels` stores the order of the list it receives; `GET /api/leader/scouts` returns `label_ids` in that order. The public dashboard still lists roles by priority and the dashboard card lists tags by name. Files touched: `schema.sql`, `server.js`, `public/leader.html`, `README.md`. Checked in a browser against a stand-in API; the new SQL has not been run against a database.

## Arabic wording: tags are badges, وسام / أوسمة (build 59, "badges")
- Every Arabic text for **tags** now says **وسام** (one) and **أوسمة** (several, "الأوسمة" with the article) instead of وسم / وسوم / الوسوم, which are different words (marks/brands). 18 places in `public/i18n/ar.json`: the Roles & tags tab and title, the explanation under it, the Role/Tag choice and the "Tags" heading on a scout's page, the add-label button, the search hint, the activity log wording, the promote and "start with a copy of another troop" texts, and the troops hint. Grammar was adjusted where needed (e.g. "وأوسمةً", "وأوسمته"). English still says "tags". The old line in this file about the Roles & tags tab was updated too.
- Files touched: `public/i18n/ar.json`, `README.md`, `CHANGES.md`. Nothing else changes; the JSON was re-parsed and has the same keys as `en.json`.

## Mod renamed رائد, and limited to its own patrol (build 60, "patrol")
- **Arabic name:** the mod account level is now called **رائد** instead of مسؤول (`acct_mod` in `public/i18n/ar.json`: the account type choice in the Leaders tab and everywhere the level is shown). The English name "Mod" is unchanged. Other Arabic texts that say "المسؤول عنه" (the patrol *in charge of*) are ordinary wording, not the level's name, so they stay.
- **Only its own patrol:** a mod's patrol is the patrol set on its own scout profile (picked from the profile's page like for any scout; no new column). On the server (`server.js`): `requireLeader` loads it into `req.patrol` for mods; new helpers `modOnly`, `patrolSql` and `inPatrol` limit a mod to the scouts of that patrol **plus its own profile**:
  - `scoutFor` (so scout edit, active, promote, photo, hide picture, XP award) answers 404 for anyone outside the patrol; `DELETE /api/xp/:id` only removes entries of those scouts;
  - `GET /api/leader/scouts` and `GET /api/leader/scouts/:id` (private details, also used by the dashboard) only return them;
  - attendance: `GET /api/attendance/summary`, the present counts in `GET /api/meetings`, the marks in `GET /api/meetings/:id`, the single and the "everyone" marks (present / the rest absent / clear all) only cover them; clearing a sheet only removes their marks and XP;
  - `POST /api/scouts`: a mod's new scout joins the mod's patrol; a mod with no patrol gets `no_patrol` (403).
- **Patrol changes closed to mods:** `POST/PUT/DELETE /api/patrols` and `PUT /api/scouts/:id/patrol` now use `requireNotMod` (otherwise a mod could put itself in any patrol). The Patrols tab is hidden for mods (`tabAllowed` in `leader.html`) and so is the patrol choice on a scout's page.
- **Texts (both languages):** `err_no_patrol`, and `mod_no_patrol`, a hint at the top of the Scouts list for a mod whose profile has no patrol yet (it sees only itself).
- **Existing mod accounts:** they only see what is in their profile's patrol, so an admin must set the patrol on each mod's scout page, or the mod sees just itself. Admins, leaders and the super admin are unchanged.
- Files touched: `server.js`, `public/leader.html`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Read through against the related code and syntax-checked (`node --check`); the new SQL has not been run against a database.

## Patrol meetings for mods, Administration in the header menu, "View as" (build 61, "viewas")
- **Patrol meeting (اجتماع طليعة / اجتماع رهط):** a third meeting type, `kind = 'patrol'`, named **اجتماع رهط** in Rovers-themed troops and **اجتماع طليعة** in all others (it uses the troop's patrol word, `{unit}`; English "Patrol meeting"). A **mod can now add one for its own patrol** (the form shows just date, title and XP; the patrol is the mod's own, set by the server; a mod with no patrol gets `no_patrol`), and edit or delete **only** its patrol's patrol meetings: it still can't add, edit or delete meetings or events, and it doesn't see other patrols' meetings at all. Admins, leaders and the super admin can add patrol meetings too, choosing the patrol (a regular one, not the leaders' group), and see every patrol's.
  - A patrol meeting's sheet lists **only that patrol's scouts** (server: `sheetSql`, used by the single mark and the "everyone / the rest absent / clear" buttons; client: `sheetScouts(m)`), and the attendance percentages count it only for scouts of that patrol. The list shows the type with the patrol's name.
  - An existing meeting or event can't become a patrol meeting, and a patrol meeting keeps its type and patrol when edited. If its patrol is deleted the meeting stays, with no patrol.
  - Database: `meetings.kind` now also allows `patrol` (the check constraint is replaced on startup), new column `meetings.patrol_id` (`ON DELETE SET NULL`).
- **Administration in the header menu:** **Troops** joins Leaders and the Activity log in one **Administration** group, which moved out of the leader area's tab row into the top dropdown (next to Leader area, Depot, My account) for the super admin. The links open `/leader.html#troops`, `#leaders`, `#log` (on the leader page itself they just switch pages). The tab row lost the Troops button and the Administration menu (the pages themselves are unchanged); `BTN_TABS` in `leader.html` is the list of tabs that still have buttons.
- **Mods and the Patrols tab:** a mod already had no access to the Patrols tab since build 60 (tab hidden, patrol routes closed on the server); nothing more was needed.
- **View as (super admin):** a **View as** choice at the top of the leader area lists every other account (name · level · troop); picking one shows the whole site as that account, **read-only** (changes are refused with `view_only`; the new text `err_view_only` says so), with a yellow strip on every page ("Viewing as … view only", **Exit view**). Server: `requireLeader` reads `X-View-As` for the super admin only and sets `req.real` / `req.leader` / `req.viewing`; `GET /api/me` keeps renewing the real account's session and reports `real_role` and `viewing`; new `GET /api/view-as/accounts`. Client: `viewAsId` / `setViewAs` / `viewAsHeader` in `common.js` (kept per browser tab in `sessionStorage`), `paintViewBanner`, `setupViewBar` in `leader.html`.
- **New texts (both languages):** `att_kind_patrol`, `att_new_patrol_meeting`, `view_as_label`, `view_as_self`, `view_banner`, `view_exit`, `err_view_only`.
- Files touched: `server.js`, `schema.sql`, `public/common.js`, `public/leader.html`, `public/style.css`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Read through against the related code and syntax-checked (`node --check` on the server and the page scripts; the i18n files have the same keys); not run in a browser and the new SQL has not been run against a database.

## Mods see everyone, change only their patrol (build 62, "viewall")
- Build 60 hid the other patrols from a mod (رائد). **That is reversed for viewing:** a mod now **sees everyone like before** (the scout lists, every scout's page and private details, the attendance sheets, percentages and present counts, every meeting including other patrols' patrol meetings), and **can only change the scouts of its own patrol plus its own profile.**
- **Server:** `GET /api/leader/scouts`, `GET /api/leader/scouts/:id`, `GET /api/attendance/summary`, `GET /api/meetings` and `/:id` are open again; the first two return `editable` per scout (always true for other accounts). The changing routes keep the limit: `scoutFor` (edit, active, promote, photo, hide picture, XP award), `DELETE /api/xp/:id`, and the attendance marks (single and bulk; clearing a sheet only removes the mod's patrol's marks) refuse anyone outside the patrol. Patrol meetings: a mod can still add them for its own patrol and edit or delete only its own patrol's (another patrol's now answers `forbidden` instead of "not found"). `editableSql` is new; `patrolSql` is built on it.
- **Page (`leader.html`):** another patrol's scout opens **read-only** (fields disabled, no save / photo / XP / deactivate / promote / undo, with the note `view_only_scout`); on an attendance sheet their three buttons are greyed out and the "everyone" buttons only touch the mod's own patrol's scouts. `modNoPatrol` now means "no editable scout has a patrol". Texts: new `view_only_scout`; `mod_no_patrol` reworded (the hint now says the mod will be able to change its patrol's scouts).
- Unchanged from build 60/61: a new scout added by a mod joins its patrol, mods have no Patrols tab and can't move scouts between patrols.
- Files touched: `server.js`, `public/leader.html`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Read through against the related code and syntax-checked; not run in a browser, and the SQL has not been run against a database.

## Mods can only create patrol meetings (build 63, "createonly")
- A mod (رائد) could already create only the patrol type (the server forces `kind = 'patrol'` and the mod's own patrol, and the form hides the type choice). Build 61 also let it **edit and delete** its own patrol's meetings; that is **removed**: `PUT` and `DELETE /api/meetings/:id` are closed to mods again (`requireNotMod`), and the sheet shows a mod no date / title / XP / delete controls (`canEdit = !isMod()` in `leader.html`). A mod still marks attendance for its own patrol's scouts. A mistaken patrol meeting is removed by an admin, leader or the super admin.
- Files touched: `server.js`, `public/leader.html`, `README.md`, `CHANGES.md`. Syntax-checked; not run in a browser or against a database.

## A mod with no patrol controls nobody (build 64, "nopatrol")
- Until now a mod with no patrol could still change **its own profile** (the "own profile" exception in `editableSql` / `inPatrol`). That exception is gone: a mod can change only scouts whose patrol is its patrol (its own profile is one of them once it has a patrol). With no patrol, `editableSql` is `false`, so every change route (`scoutFor`: edit, active, promote, photo, XP award; XP undo; attendance single and "everyone" marks) refuses everyone, and it can't add scouts or patrol meetings (`no_patrol`). It still sees everyone.
- Page: `modNoPatrol()` is now "no scout is editable"; the Scouts list shows the hint, every scout opens read-only, the attendance buttons are greyed out and the "Mark everyone present / rest absent / Clear all" row is hidden.
- Files touched: `server.js`, `public/leader.html`, `README.md`, `CHANGES.md`. Syntax-checked; not run in a browser or against a database.

## A real home page with a news ticker (build 65, "home")
- **The site now opens on a home page** instead of the scout list: `/` is a new `public/index.html` with a **news ticker**, quick links (scout list, depot), **Coming up** (activities and events from today on) and **News and updates**. The old dashboard moved, unchanged, to `public/scouts.html` (`/scouts.html`); the brand link and signing in still lead to `/`, and old scout links (`/#12`) are forwarded to `/scouts.html#12`.
- **Header menu:** `SITE_PAGES` in `common.js` has a new `scouts` entry; the `home` text now reads **الرئيسية / Home** and the scout list entry uses the new `scout_list` text (the old `home` wording). The menu shows every other page, as before.
- **Posts:** new `posts` table (`troop_id` NULL = every troop, `kind` news / activity / event, `title`, `body`, `event_date`, `ticker`, `pinned`, `created_by`, timestamps), created on startup. `GET /api/posts?troop=` is public (the troop's and the all-troops posts, pinned first then newest, max 100); `POST /api/posts`, `PUT` and `DELETE /api/posts/:id` are for admins, leaders and the super admin (`requirePoster`: not mods). An admin changes only its own troop's posts; the super admin and leaders change any and can post for **all troops** (`all: true`). Writes go in the activity log (`post_add`, `post_update`, `post_delete`). View-as stays read-only as before.
- **Leader area:** new **News** tab (`btn-news` / `tab-news`, hidden for mods): the post form (type, date, title, details, ticker, pin, audience for leaders / super admin) and the list with Edit / Delete. `/leader.html#news` opens it (the home page's "Manage news" shortcut).
- **Ticker:** posts marked for it (newest first, max 12, past activities and events dropped) are shown twice side by side and slid by half their width in a CSS animation, so it loops without a jump; the page is always right to left, so it slides on in reading direction. The lap time follows the text length; hover or keyboard focus pauses it; `prefers-reduced-motion` shows a plain wrapped list instead. A headline scrolls to and flashes its post. Post text is always inserted as plain text (never as HTML), with line breaks kept.
- **New texts (both languages):** home / scout_list / home_* , post_* , tab_news, news_* , confirm_delete_post, audit_post_*. Styles are at the end of `style.css` (`.ticker`, `.quick`, `.home-cols`, `.post`).
- Files touched: `server.js`, `schema.sql`, `public/index.html` (new home), `public/scouts.html` (the old index), `public/common.js`, `public/leader.html`, `public/style.css`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. The scripts were syntax-checked and both language files have the same keys; not run in a browser or against a database.

## Sign-in goes to the leader area; one home page for all troops; posting moved to the home page (build 66, "homepost")
- **Bug fixed, sign-in redirect:** opening the leader area while signed out, then signing in, sent you to the home page. `leader.html` now **stays in the leader area** after signing in (it just reloads signed in). Only when the **Sign in** link of another page named a page to come back to (`/leader.html?next=...`) do you go back there, as before.
- **No news per troop:** the home page shows **every post to everyone**: the troop picker is gone, `GET /api/posts` takes no `troop` and returns all posts (pinned first, then newest, max 100), and the ticker and "Coming up" use them all. A post still has a troop (`posts.troop_id`, null = all troops) but it is only a tag: a post about one troop shows the troop's name, "all troops" shows nothing. The home page no longer takes the troop's colours.
- **Posting moved to the home page:** the leader area's **News tab is removed** (button, pane and code). On the home page admins, leaders and the super admin get an **Add a post** button that opens the form, and **Edit** / **Delete** on each post they may change (an admin: its own troop's; the super admin and leaders: any). The form's last choice is **For which troop**: shown only to the super admin and leaders (a troop or **All troops**, the default); an admin's posts are always for its own troop (`postTroop` in `server.js`). `POST` / `PUT /api/posts` take `troop_id` (a troop id, null or `"all"`) instead of the old `all` flag; without one a new post is for the troop the account works in and an edited post keeps its troop.
- **Texts:** new `home_add_post`; `post_audience` and `news_hint` reworded; removed the unused `tab_news`, `home_manage`, `news_list`, `news_none`, `post_all_troops`, `post_in_ticker`, `post_aud_troop`. Existing posts keep working (same table).
- Files touched: `server.js`, `public/index.html`, `public/leader.html`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Scripts syntax-checked and both language files have the same keys; not run in a browser or against a database.

## Faster news ticker on phones (build 67, "tickerfast")
- The ticker's lap time came from the text length only, but one lap is at least as wide as the screen (`.ticker-set { min-width: 100vw }`), so on a narrow phone the same time meant a crawl. On screens up to 760px the lap is now timed by **distance**: the measured width of one set divided by 90 px/s (never under 6 s). Wider screens keep the old formula (0.28 s per character, at least 20 s), so the desktop speed is unchanged. The speed is set in `tickerSpeed()` in `public/index.html`, which also runs again when the window is resized or the phone is turned.
- Files touched: `public/index.html`, `README.md`, `CHANGES.md`. Script syntax-checked; not run in a browser. To change the phone speed, edit the `90` in `tickerSpeed()`.

## Weekly reports, own-troop posting made visible, slower ticker (build 68, "reports")
- **Ticker:** a little slower on phones: 75 px per second instead of 90 (`tickerSpeed()` in `public/index.html`); wider screens are unchanged.
- **Weekly reports (new page `/reports.html`):** the troops meet every Saturday, so each troop writes **one report per Saturday** about what it did. New `weekly_reports` table (`troop_id`, `week_date` = the Saturday, `body`, authors and times, unique per troop and week). `GET /api/reports` (signed in), `PUT /api/reports` (creates or replaces; the week must be a Saturday and not in the future; body required, 4000 characters) and `DELETE /api/reports/:id`.
  - **Who:** **admins and mods write, edit and delete only their own troop's report**: the server takes their own troop whatever is sent, and the page shows the troop choice fixed. The super admin and leaders can write for any troop. Everyone signed in can read every troop's report; visitors who are not signed in see only a sign-in prompt (reports are not public: change `requireLeader` on `GET /api/reports` and the page's sign-in check to open them).
  - **Page:** a form (week from the last 52 Saturdays, troop, "What the troop did") that loads the existing report when the week and troop already have one; below it the weeks, newest first (this week and the last three, plus any older week with a report), each with **every troop's report** or a dashed "No report yet" card with a **Write the report** button for the troops the account may write for. A "Weekly reports" entry appears in the header menu and as a quick card on the home page once signed in. Writes are logged (saved / deleted a weekly report).
- **Posts and troops:** nothing changed in who can post (the super admin and leaders for any troop or all troops, admins for their own troop only, nobody on behalf of another troop; mods don't write posts); what changed is that an admin's form now **shows** the troop it posts for (fixed to its own), and every post about a troop shows that troop's name to everyone.
- **New texts (both languages):** `reports_page`, `reports_title`, `reports_signin`, `reports_hint`, `report_*`, `confirm_delete_report`, `home_reports_hint`, `audit_report_*`.
- Files touched: `server.js`, `schema.sql`, `public/reports.html` (new), `public/index.html`, `public/common.js`, `public/style.css`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Scripts syntax-checked, both language files have the same keys; not run in a browser or against a database.

## Posts for several troops, the ticker says "no news", smaller phone buttons (build 69, "jointpost")
- **More than one troop in a post:** a post (news, activity or event) can now be about **one troop, several (a joint event) or all**. New `post_troops` table (`post_id`, `troop_id`; no rows = all troops); what the old `posts.troop_id` column held is copied there once and the column emptied (nothing reads it any more). `GET /api/posts` returns `troop_ids` (replacing `troop_id`); `POST` / `PUT /api/posts` take `troop_ids` (`[]` or `"all"` = all troops; without it a new post is for the troop the super admin or leader works in, an edited one keeps its troops). The form's troop choice is now **tick boxes** (All troops, then each troop; All troops clears and locks the others). The cards show one tag per troop.
- **Who:** the super admin and leaders tick anything. An **admin's own troop is always ticked and locked**, and it may tick the other troops that take part (the server adds the admin's troop even if it is missing, and an admin can't post for all troops), so nobody posts only on behalf of others. An admin can edit or delete **any post its own troop is part of**, including a joint one made by someone else and posts for several troops (it can change the list of troops, but its own stays); posts for all troops stay with the super admin and leaders. Mods still don't write posts. Deleting a troop also deletes posts that were only about it (otherwise they would turn into posts for all troops).
- **Ticker:** with no post marked for it the bar no longer disappears: it stays and shows **"No news for the time being" / "لا أخبار في الوقت الحالي"** (still hidden for the moment the posts are loading).
- **Phones:** the quick-link cards (scout list, depot, weekly reports) are small plain buttons without their descriptions on screens up to 760px; wide screens keep the descriptions.
- **Texts:** new `home_ticker_empty`, `post_troops_hint`, `post_pick_troop`; `post_audience` and `news_hint` reworded.
- Files touched: `server.js`, `schema.sql`, `public/index.html`, `public/style.css`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Scripts syntax-checked, both language files have the same keys; not run in a browser or against a database.

## Administration is its own site; a cleaner activity log; no sign-in logging (build 70, "adminsite")
- **`/admin.html` (new):** Troops, Accounts and the Activity log moved out of the leader area (and out of the header menu's old Administration group) into **a site of their own**, not tied to any troop (no troop switcher, no troop theme). The header menu now has a single **Administration** entry for the super admin (`SITE_PAGES.admin`); anyone else who opens the page is refused (`err_forbidden`, and the server refuses its API too). Three tabs, `#troops`, `#accounts`, `#log`. The leader area lost the Troops, Leaders and Activity log tabs and all their code (`window.openLeaderTab`, the hash links, `drawTroops`, `drawLeaders`, `drawLog`, the copy-from list); `acctName` stayed for the View-as list.
- **Troops tab:** as before (names, brand text, level, XP on/off, theme, delete, add with copy-from), minus "working here".
- **Accounts tab:** shows **every account of every troop, grouped by troop** (the super admin first). The add form now has a **Troop** choice (`troop_id`); before, a new account joined the troop the super admin happened to be working in. `GET /api/leaders` returns all accounts (it used to return one troop's); `POST /api/leaders` takes `troop_id`.
- **Activity log, cleaner:** `GET /api/audit` now serves **all troops** (or `?troop=`), newest first, 200 at a time (`limit` up to 500, `before` = an entry id for the next page) instead of the latest 300 of the working troop. The page groups the entries **by day** (Today / Yesterday / date), one compact row each (time, a coloured dot for the kind, **who** + what, and the troop as a tag), with filters for troop, kind (Scouts, XP and attendance, Depot, Posts and reports, Accounts and troops) and a text search, and an **Older entries** button. The patrol word in a sentence follows the entry's own troop (رهط for Rovers).
- **No sign-in logging:** signing in and out are no longer written to the log (`audit(leader, 'login')` and the logout entry are gone); `GET /api/audit` also leaves out the `login` / `logout` rows recorded earlier (they stay in the table). Password and username changes are still logged.
- **Texts:** new `admin_signin`, `tab_accounts`, `log_search`, `log_more`, `log_today`, `log_yesterday`, `log_all_troops`, `log_cat_*`; removed `audit_login`, `audit_logout`, `log_title`, `leaders_title`, `tab_leaders`, `working_here`. Styles at the end of `style.css` (`.log-*`).
- Files touched: `server.js`, `public/admin.html` (new), `public/leader.html`, `public/common.js`, `public/style.css`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Page scripts syntax-checked, both language files have the same keys; not run in a browser or against a database.

## Centred depot on phones, welcome text without commas, a slogan per troop (build 71, "slogan")
- **Depot on phones (up to 760px):** the page is centred: the title and the "Add item" button stack in the middle, each item is a centred card (name, quantity badge, buttons in a row), the counts, "Taken right now", the history title and the take lines are centred too. Your own troop's takes are marked with a top edge instead of the side edge. The basket's item lines keep their row layout. Wide screens are unchanged (`style.css`, end of file).
- **English welcome text:** "Welcome, {name}, to the Scout Troop 2 platform" had two commas; it now reads "Welcome {name} to the Scout Troop 2 platform" (`subtitle_named` in `en.json`). The Arabic text had none.
- **Troop slogan:** new `troops.slogan_en` / `slogan_ar` columns, set in **Administration > Troops** (both the add form and each troop's edit row; `POST` / `PUT /api/troops` take `slogan_en` and `slogan_ar`, 60 characters each, empty = none; `GET /api/troops` returns them). In the leader area a line above the tabs shows **the troop's name with its slogan next to it** (for example "Rovers — Always Prepared"; `paintTroopLine` in `leader.html`), following the troop being worked on and the language; with no slogan the line is not shown. It is separate from the existing "text next to the logo" (`brand_*`). Texts: `slogan_en`, `slogan_ar`, `slogan_hint`.
- Files touched: `server.js`, `schema.sql`, `public/admin.html`, `public/leader.html`, `public/style.css`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Page scripts syntax-checked, both language files have the same keys; not run in a browser or against a database.

## Slogan in the header, centred quick-link text (build 72, "headerslogan")
- **Slogan position:** the troop's slogan now shows **at the top, in the header, right beside the troop's name** (the text next to the logo) instead of in a line above the tabs: a small italic text after a thin divider (`<small id="brandSlogan" class="brand-slogan">` inside the header's brand link in `leader.html`, filled by `paintTroopLine`). It follows the troop being worked on and the language, and is hidden when the troop has no slogan. The old line (`#troopLine`, `.troop-line`) is gone. Still set in Administration > Troops.
- **Depot, again:** build 71's phone layout for the depot page (centred cards) is **removed**, the depot page is back to how it was. What was meant was the **text of the "Depot" button on the home page**: on phones the quick-link buttons (scout list, depot, weekly reports) were the same height as the tallest one, so a button with a one-line name (Depot) had its text at the top while a neighbour's name took two lines. The buttons are now flex boxes with the text centred both ways (`.quick-card` in the phone rules of `style.css`, minimum height 2.8rem).
- Files touched: `public/style.css`, `public/leader.html`, `README.md`, `CHANGES.md`. Page scripts syntax-checked; not run in a browser.

## Ticker slower on phones (build 73, "tickerslow")
- The news ticker's phone speed is lowered from 75 to **60 px per second** (`tickerSpeed()` in `public/index.html`); wider screens are unchanged. To change it again, edit the `60` there.
- Files touched: `public/index.html`, `README.md`, `CHANGES.md`.

## Bigger slogan that stays on the line, a nicer phone menu (build 74, "menusheet")
- **Slogan:** a little bigger (1.05rem on wide screens, 0.88rem on phones, was 0.8 / 0.72) and **no width limit** any more (it used to be cut at 12rem / 8.5rem, which pushed longer slogans onto a second line even with room to spare). It now wraps only when the header really has no space left (`.brand-slogan` in `style.css`).
- **Header menu on phones:** the plain white list is now a **bottom sheet**: it slides up from the bottom over a dimmed page, with a grab bar, rounded corners, big tap rows and a **line icon in a tinted square** in front of every page (home, scouts, reports, leader area, depot, administration, my account, sign in). Tapping the dimmed area, pressing Esc or choosing a page closes it. Wide screens keep the dropdown (now with the small icons too). Icons are fixed SVG drawings in `MENU_ICONS` (`common.js`), added by `menuLink()`; animations are off for people who prefer reduced motion.
- Files touched: `public/common.js`, `public/style.css`, `README.md`, `CHANGES.md`. Scripts syntax-checked; not run in a browser.

## One styled dropdown for every select (build 75, "dropdowns")
- Choosing a troop in the leader area (and every other dropdown) still opened the browser's plain list. Now **every `<select>` in the site** opens the styled list: on phones a **bottom sheet** like the new header menu (dimmed page, grab bar, the field's label as a title, large rows, a tick on the current choice); on wide screens a small **popover** under the field (above it when there is no room), with the same look. This covers the troop switcher, "View as", activity / patrol / role pickers, the attendance and log filters, reports and post forms, theme and level pickers in Administration, and the depot troop choice.
- How: a block at the end of `common.js` intercepts the open (mouse down, a tap that isn't a scroll, Space / Enter / Alt+Down) and shows its own list; choosing sets the select's value and fires `input` and `change`, so the existing handlers (`troopSwitch`, `viewSwitch`...) are unchanged. The select itself stays: it shows the choice, takes focus and is validated and submitted as before. A MutationObserver also enhances selects the pages create later. Keyboard and screen readers: Space / Enter / Alt+Down open it, arrows move, Enter chooses, Esc closes, typing jumps to an option; the arrow keys on a closed select still change it natively. `data-native` opts a select out.
- The selects get a small arrow of their own (`appearance: none` + a chevron), since the browser's is gone. Styles at the end of `style.css` (`.cs-*`, reusing the sheet animations of the header menu).
- Files touched: `public/common.js`, `public/style.css`, `README.md`, `CHANGES.md`. Scripts syntax-checked; **not run in a browser: the tap handling on real phones (iOS especially) is the thing to try first**.

## Weekly reports for everyone, leader area hidden from visitors, the musical team (build 76, "music")
- **Weekly reports are public:** `GET /api/reports` no longer needs a session, `/reports.html` shows every week's reports to any visitor (the "Sign in to see" panel is gone, `reports_signin` removed), and the home page's quick link and the header menu entry are there for everyone. **Writing is unchanged**: the form (new / edit / delete) is hidden for visitors and `PUT` / `DELETE /api/reports` still need an account (admins and mods their own troop, the super admin and leaders any). `reports_hint` reworded.
- **Leader area hidden for visitors:** the header menu (`paintMenu` in `common.js`) lists **Leader area** only once signed in (it was shown to everyone); visitors keep the **Sign in** entry, which opens the same page.
- **Musical team (new site `/music.html`, "الفريق الموسيقي"):** a new entry in the header menu (`SITE_PAGES.music`, own icon) and a quick-link card on the home page.
  - **Members are existing scouts only.** A member must have a scout profile in a troop; there is no "create scout" in the team. The add form (managers) lists active scouts who are not in the team yet, from every troop, with a search box. Two groups: **فريق نحاسي** (`brass`) and **فريق إيقاع** (`percussion`); a member can be moved between them or removed (the scout stays in their troop).
  - **Own XP, separate from the troops':** new tables `music_members`, `music_meetings`, `music_attendance`, `music_xp_log` (`schema.sql`, created on startup). The troops' `xp_log`, `activities`, XP on/off switch and levels are untouched; the team's XP is always on. XP comes from attendance (attending XP default 10, absence-without-excuse XP default 0, per meeting, exactly like the troops' attendance, including taking back / updating entries when a mark or the meeting changes) and from one-off awards with their own title (negative deducts, with undo).
  - **Weekly meetings with attendance:** Meetings tab (signed-in accounts): list, search, a sheet per meeting with **Present / Absent, no excuse / Absent, excused** per member (grouped by the two groups) plus the three "everyone" buttons, editable date / title / XP, delete, and a per-member attendance percentage (since the member was added).
  - **Who:** everyone sees the team, groups, members' troop and team XP and a member's XP history (public, like the scout list; a hidden profile picture stays hidden). Signed-in accounts also see the meetings, marks and percentages. The **super admin, admins and leaders manage** it (any troop's scouts); **mods only look**.
  - **API:** public `GET /api/music`, `GET /api/music/members/:id`; signed-in `GET /api/music/meetings[/:id]`, `GET /api/music/summary`; managers `GET /api/music/candidates`, `POST /api/music/members`, `PUT` / `DELETE /api/music/members/:id`, `POST /api/music/members/:id/xp`, `DELETE /api/music/xp/:id`, `POST /api/music/meetings`, `PUT` / `DELETE /api/music/meetings/:id`, `PUT /api/music/meetings/:id/attendance[/:scoutId]` (see README). New error code `music_already`.
  - **Activity log:** every change is logged (`music_member_add`, `_group`, `_remove`, `music_meeting_add` / `_update` / `_delete`, `music_mark`, `music_mark_bulk`, `music_xp_award`, `music_xp_undo`) under a new kind, **Musical team** (`catOf` and `describe` in `admin.html`).
  - **Texts:** `music_*` (page, tabs, groups, forms, hints, status labels), `home_music_hint`, `err_music_already`, `audit_music_*`, `log_cat_music`; it reuses the existing attendance texts (`att_*`).
- Files touched: `server.js`, `schema.sql`, `public/music.html` (new), `public/reports.html`, `public/index.html`, `public/common.js`, `public/admin.html`, `public/i18n/ar.json`, `public/i18n/en.json`, `README.md`, `CHANGES.md`. Scripts syntax-checked, both language files have the same keys; **not run in a browser or against a database** (the new SQL in the music routes is the thing to try first: adding a member, marking attendance, editing a meeting's XP).

## Helper level, new level names, who did it (build 77, "helper")
- **New account level: helper** (`helper` in `leaders.role`; the check constraint in `schema.sql` is widened on startup). It has **exactly the mod's permissions**: on the server every `mod` check is now `isModLike()` (own patrol only, no home page posts, no Patrols / Activities / Roles & tags). Choose it in Administration > Accounts (**عريف (رائد في الجوالة)**).
- **Names:** admin is now **نائب القائد**, mod is **مساعد القائد**, the helper is **عريف**, or **رائد** when its troop has the Rovers theme (`acct_admin`, `acct_mod`, `acct_helper`, `acct_helper_r`; English: Deputy leader, Assistant leader, Helper, Rover helper). Leader (القائد) and super admin (المشرف العام) keep their names. `accountLevel(role, rovers)` in `common.js` picks the word; the accounts list, the Administration list, "View as" and its banner use it. The wording that said "admin" in the interface (delete confirmation, the depot sign-in note, the weekly reports hint) follows the new names.
- **The level in front of the name wherever it says who did something:** the activity log (a level chip before the bold name, and the search also matches it), who **took** depot items ("سحبه عريف ..."), and who wrote a **weekly report** ("كتبه قائد ..."). The server adds `leader_role` / `leader_rovers` (log, depot takes) and `author_role` / `author_rovers` (reports) from the account's current level; nothing is added when the account no longer exists. The level is the account's *current* one.
- **Musical team: everyone signed in but the helper edits** (was: super admin, admins, leaders). Mods (مساعد القائد) can now add members, mark attendance, award XP...; the helper only looks. `requireMusicManager` is `role !== 'helper'`, and the page's `isManager()` matches.

## Change an account's level, mod = admin, practices, sub teams, the instruments depot (build 78, "practice")
- **The super admin can change an account's level** (Administration > Accounts: a choice next to each account's name, `PUT /api/leaders/:id/role`; admin, leader, mod or helper; never the super admin's or one's own). The change applies from the account's next request, nothing else about the account changes, and it is logged ("changed the level of ...").
- **Mod (مساعد القائد) = admin (نائب القائد)**: the same level under two names. Server: `isDeputy()` (admin or mod) replaces every "is admin" check (activities, roles & tags, depot edits and returns, ...); pages: posting on the home page, the depot editor and the Roles & tags tab follow. **Existing mod accounts therefore gain the admin's permissions.** The one-patrol limits the mod used to have (own patrol only, no posts, no Patrols / Activities / Roles tabs) now belong to the **helper** only (`isHelper()`, was `isModLike()`).
- **Musical team: "meetings" are now "practices" (تدريبات)** everywhere on the page (tab, headings, default title "تدريب أسبوعي", hints, delete confirmation, the per-member count "حضر n من m تدريباً", log sentences). The XP hints are the team's own texts (`music_xp_hint`, `music_xp_none`, `music_xp_field_hint`). The API paths (`/api/music/meetings`) and tables are unchanged.
- **Sub teams:** each group is split into **فريق أول** and **فريق ثاني** (`music_members.sub`, 1 or 2, added on startup with default 1, so existing members are in the first). The add form and the member's page choose group and sub team; the list, the practice sheets and the attendance summary show four headings / labels (e.g. «فريق نحاسي · فريق أول»).
- **Instruments depot (مستودع الآلات)**: a third tab of the musical team, its own inventory (`music_depot_items`, separate from the troops' depot): name (Arabic / English), group (brass, percussion or both), quantity, notes. Public to read and search; managers add, edit and remove. Logged under "Musical team". It has no taking-out or reservations.
- The tab bar of the musical team is now always visible: visitors see Team and Instruments; Practices shows once signed in.

## Leaders stay in their troop, Activities and Roles & tags for the super admin only, the general leader (build 79, "generalleader")
- **Deputy leader / assistant leader no longer see or change Activities and Roles & tags.** Both tabs (and giving roles and tags to a scout) are for the super admin only, on the server (`requireActivityEditor`, `requireLabelEditor`) and in the leader area. Everyone still sees the roles on the public pages and picks from the activity list when awarding XP.
- **A leader can't switch troops any more:** it works in its own (home) troop only. With that, deputy (admin), assistant (mod) and leader are one level under three names (`isTroopStaff()`): own troop, posts for their own troop, putting back their troop's bookings.
- **New level: general leader (القائد العام)** (`general_leader`; the constraint in `schema.sql` widens itself on startup): exactly what the leader could do before (the troop switcher, posts and weekly reports for any troop, putting back any booking), still without Administration, Activities or Roles & tags. `roams()` is now super admin + general leader. The super admin picks it when adding an account and in the level choice next to each account.
- **Existing leader accounts become own-troop accounts.** To give one the old reach, change its level to القائد العام in Administration > Accounts.

## Arabic level names with «ال» (build 80, "alqaed")
- The Arabic names of the levels now read **نائب القائد**, **مساعد القائد**, **القائد** and **القائد العام** (were نائب قائد, مساعد قائد, قائد, قائد عام): `acct_admin`, `acct_mod`, `acct_leader`, `acct_general_leader` in `public/i18n/ar.json`, so every place that shows a level (accounts lists, the level choice, "View as", the activity log chip, "Written by ...", "Taken by ...") follows. The depot sign-in note says «كالقائد أو نائب القائد». عريف / رائد and المشرف العام are unchanged.

## Delete old weeks, a fixed header in the leader area, the new Aqua logo (build 81, "weeks")
- **Weekly reports: delete a whole week.** Each week on the reports page has a **Delete this week** button (shown when it has a report the signed-in account may delete). After a confirmation it removes every such report of that Saturday: all troops for the super admin and general leaders, only the account's own troop's for the others. New route `DELETE /api/reports/week/:date`, logged as "deleted the weekly reports of <date>" (Content kind). Deleting a single report from the form is unchanged.
- **Leader area: the logo and name in the header are no longer a link** (they took you to the home page); they are plain text there. The other pages keep the link.
- **Aqua (guides) logo:** the theme (key `ocean`) now uses the blue looping fleur-de-lis you sent, made transparent and cropped, shown on the white round badge like the Yellow themes (the blue line would not show on the dark blue header otherwise). New file `public/logo-guides-v3.png` (new name so browsers do not keep the old one); `logo-guides-v2.png` is deleted.

## Delete the week itself, import many scouts (build 82, "import")
- **Weekly reports: Delete this week now removes the week, not just its reports** (build 81 only emptied it, so the empty week stayed on the page). The week leaves the list and the form's week choice, with every troop's report in it. It is a global change (a week belongs to every troop), so it is for the **super admin and general leaders** only; the others keep deleting their own troop's single report from the form. New table `report_weeks_removed`, `GET /api/reports/removed-weeks` (public), and `DELETE /api/reports/week/:date` is refused (403) for everyone else. Saving a report for a removed week (API only) puts the week back.
- **Import many scouts from a file or text** (leader area, Add scout tab, under the single form): upload a CSV/TSV/TXT or paste text, press **Read and preview**, check the table, then **Add N scouts**. It reads a table with a header row or filled-in forms (`Name: ...` lines, one block per scout), recognises Arabic and English labels, converts dates (2013-04-20 or 20/4/2013) and Arabic digits, skips names already in the list by default, and offers a template to download. New route `POST /api/scouts/bulk` (up to 200 rows, one transaction, refused rows reported). Parsing is done in the browser; there is no OCR, so a photo or a PDF of a paper form has to be typed or copied out first.
