CREATE TABLE IF NOT EXISTS leaders (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scouts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE scouts
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS join_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS guardian_name TEXT,
  ADD COLUMN IF NOT EXISTS guardian_phone TEXT,
  ADD COLUMN IF NOT EXISTS medical_notes TEXT,
  ADD COLUMN IF NOT EXISTS group_name TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS photo BYTEA,
  ADD COLUMN IF NOT EXISTS photo_v INT NOT NULL DEFAULT 0;
-- photo_hidden: the picture is kept but not shown on the public dashboard (the leader area still shows it)
ALTER TABLE scouts ADD COLUMN IF NOT EXISTS photo_hidden BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  xp INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS xp_log (
  id SERIAL PRIMARY KEY,
  scout_id INT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  activity TEXT NOT NULL,
  xp INT NOT NULL,
  note TEXT,
  leader_id INT REFERENCES leaders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE xp_log
  ADD COLUMN IF NOT EXISTS activity_ar TEXT,
  ADD COLUMN IF NOT EXISTS activity_id INT REFERENCES activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activity_date DATE;
CREATE INDEX IF NOT EXISTS xp_log_scout_idx ON xp_log(scout_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  leader_id INT REFERENCES leaders(id) ON DELETE SET NULL,
  leader_name TEXT NOT NULL,
  action TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);

-- roles and tags (kind = 'role' or 'tag'), many-to-many with scouts
CREATE TABLE IF NOT EXISTS labels (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('role', 'tag')),
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scout_labels (
  scout_id INT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (scout_id, label_id)
);
CREATE INDEX IF NOT EXISTS scout_labels_label_idx ON scout_labels(label_id);
-- pos: the order the roles/tags were given to the scout in (the leader area shows them in that order, the newest last); existing rows keep label order
ALTER TABLE scout_labels ADD COLUMN IF NOT EXISTS pos INT NOT NULL DEFAULT 0;
-- troops: every scout belongs to exactly one troop, and so does every leader account except the super admin,
-- who is not bound to a troop and can switch between all of them.
-- Activities and roles/tags are separate for each troop (activities.troop_id / labels.troop_id below).
CREATE TABLE IF NOT EXISTS troops (
  id SERIAL PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- visual identity shown to the troop's leaders after sign-in (NULL = main site look)
ALTER TABLE troops ADD COLUMN IF NOT EXISTS theme TEXT;
-- troops are levels: a scout can only be promoted to a troop with a higher level (existing troops start at their order of creation)
ALTER TABLE troops ADD COLUMN IF NOT EXISTS level INT;
-- the XP system is optional per troop: when off, the troop's pages show no XP, no XP can be awarded and attendance gives none (existing XP stays stored)
ALTER TABLE troops ADD COLUMN IF NOT EXISTS xp_enabled BOOLEAN NOT NULL DEFAULT true;
UPDATE troops SET level = id WHERE level IS NULL;
-- text shown next to the logo for this troop's leaders (NULL = the site name)
ALTER TABLE troops ADD COLUMN IF NOT EXISTS brand_en TEXT;
ALTER TABLE troops ADD COLUMN IF NOT EXISTS brand_ar TEXT;
ALTER TABLE scouts ADD COLUMN IF NOT EXISTS troop_id INT REFERENCES troops(id);
ALTER TABLE leaders ADD COLUMN IF NOT EXISTS troop_id INT REFERENCES troops(id);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS troop_id INT REFERENCES troops(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS scouts_troop_idx ON scouts(troop_id);
CREATE INDEX IF NOT EXISTS audit_log_troop_idx ON audit_log(troop_id);
-- every leader is also a scout: leaders.scout_id points at their scout profile
ALTER TABLE leaders ADD COLUMN IF NOT EXISTS scout_id INT REFERENCES scouts(id) ON DELETE SET NULL;

ALTER TABLE labels ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;

-- account levels: super_admin (exactly one), admin, leader. Only super_admin/admin may add or remove leaders.
ALTER TABLE leaders ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'leader';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leaders_role_check') THEN
    ALTER TABLE leaders ADD CONSTRAINT leaders_role_check CHECK (role IN ('super_admin', 'admin', 'leader'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS leaders_one_super_admin ON leaders ((true)) WHERE role = 'super_admin';

-- the super admin belongs to no troop; every other account must belong to one
ALTER TABLE leaders ALTER COLUMN troop_id DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leaders_troop_check') THEN
    ALTER TABLE leaders ADD CONSTRAINT leaders_troop_check CHECK (role = 'super_admin' OR troop_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- activities and roles/tags are separate for each troop (older databases had one shared list; startup copies it per troop)
-- roles used to carry permissions (view_log, manage_accounts); no longer used (the account level decides), the column is kept
ALTER TABLE labels ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';
-- every account is an admin (the old 'leader' type was migrated); new accounts default to it
ALTER TABLE leaders ALTER COLUMN role SET DEFAULT 'admin';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS troop_id INT REFERENCES troops(id) ON DELETE CASCADE;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS troop_id INT REFERENCES troops(id) ON DELETE CASCADE;
-- patrols (called "رهط" in the Rovers troop in the interface): each troop splits its scouts into its own patrols
CREATE TABLE IF NOT EXISTS patrols (
  id SERIAL PRIMARY KEY,
  troop_id INT NOT NULL REFERENCES troops(id) ON DELETE CASCADE,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patrols_troop_idx ON patrols(troop_id);
-- every troop has one pre-made patrol for its leaders ("قيادة الفرقة"): listed first, can't be renamed or deleted
ALTER TABLE patrols ADD COLUMN IF NOT EXISTS is_leadership BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS patrols_one_leadership ON patrols (troop_id) WHERE is_leadership;
ALTER TABLE scouts ADD COLUMN IF NOT EXISTS patrol_id INT REFERENCES patrols(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS scouts_patrol_idx ON scouts(patrol_id);
CREATE INDEX IF NOT EXISTS activities_troop_idx ON activities(troop_id);
CREATE INDEX IF NOT EXISTS labels_troop_idx ON labels(troop_id);

-- account level "general_leader" (القائد العام): the leader's permissions in every troop (it can switch troops)
-- account levels "mod" (مساعد القائد) and "helper" (عريف, رائد in a Rovers troop; same permissions as the mod, except in the musical team): see only the members of their own patrol and their activity
ALTER TABLE leaders DROP CONSTRAINT IF EXISTS leaders_role_check;
ALTER TABLE leaders ADD CONSTRAINT leaders_role_check CHECK (role IN ('super_admin', 'admin', 'leader', 'mod', 'helper', 'general_leader'));

-- scouts are never deleted: leaving the movement deactivates them (hidden from the public dashboard and the default lists, history kept)
ALTER TABLE scouts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE scouts ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- the depot (مستودع): one shared inventory; leaders read it, only the super admin changes it
CREATE TABLE IF NOT EXISTS depot_items (
  id SERIAL PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- meetings attendance register (سجل حضور اجتماعات): each troop keeps its own meetings; a row in meeting_attendance means that scout was present
CREATE TABLE IF NOT EXISTS meetings (
  id SERIAL PRIMARY KEY,
  troop_id INT NOT NULL REFERENCES troops(id) ON DELETE CASCADE,
  meeting_date DATE NOT NULL,
  title TEXT,
  created_by INT REFERENCES leaders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meetings_troop_date_idx ON meetings(troop_id, meeting_date DESC);
CREATE TABLE IF NOT EXISTS meeting_attendance (
  meeting_id INT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  scout_id INT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, scout_id)
);
CREATE INDEX IF NOT EXISTS meeting_attendance_scout_idx ON meeting_attendance(scout_id);
-- the register holds meetings and events (kind); marking a scout present grants XP, stored as an xp_log row linked to the meeting
-- (removed again when the scout is unmarked or the meeting is deleted; one per scout and meeting)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting', 'event'));
-- xp: what each scout marked present gets (chosen per meeting/event, 0 = none; existing ones keep the 10 they gave)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS xp INT NOT NULL DEFAULT 10 CHECK (xp BETWEEN 0 AND 1000);
-- absent_xp: what a scout marked absent loses (chosen per meeting/event, 0 = none); meeting_absences: the scouts marked absent (no row = no mark)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS absent_xp INT NOT NULL DEFAULT 0 CHECK (absent_xp BETWEEN 0 AND 1000);
CREATE TABLE IF NOT EXISTS meeting_absences (
  meeting_id INT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  scout_id INT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, scout_id)
);
-- excused: absent with an excuse (no XP taken); false = no excuse (loses the meeting's absence XP)
ALTER TABLE meeting_absences ADD COLUMN IF NOT EXISTS excused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE xp_log ADD COLUMN IF NOT EXISTS meeting_id INT REFERENCES meetings(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS xp_log_meeting_scout_idx ON xp_log(meeting_id, scout_id) WHERE meeting_id IS NOT NULL;
-- patrol meetings (kind 'patrol'): a meeting of one patrol (patrol_id), whose sheet lists only that patrol's scouts. A mod adds these for its own patrol.
-- (if the patrol is deleted the meeting stays, with no patrol)
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_kind_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_kind_check CHECK (kind IN ('meeting', 'event', 'patrol'));
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS patrol_id INT REFERENCES patrols(id) ON DELETE SET NULL;

-- the scout lists check for every scout whether it belongs to a leader account
CREATE INDEX IF NOT EXISTS leaders_scout_idx ON leaders(scout_id);

-- depot takes: items are taken out of the depot at once (now), for a troop, and put back later. A take holds a basket of items (each with a
-- quantity) and counts against the stock until returned_at is set. leader_name keeps who took it after the account is gone.
CREATE TABLE IF NOT EXISTS depot_takes (
  id SERIAL PRIMARY KEY,
  troop_id INT NOT NULL REFERENCES troops(id) ON DELETE CASCADE,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  note TEXT,
  leader_id INT REFERENCES leaders(id) ON DELETE SET NULL,
  leader_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS depot_takes_returned_idx ON depot_takes(returned_at);
CREATE TABLE IF NOT EXISTS depot_take_items (
  take_id INT NOT NULL REFERENCES depot_takes(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES depot_items(id) ON DELETE CASCADE,
  quantity INT NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (take_id, item_id)
);
CREATE INDEX IF NOT EXISTS depot_take_items_item_idx ON depot_take_items(item_id);
-- the reservations of builds 34-46 become takes (reserving is gone): the ones that had already started are kept (taken at their start; put back at
-- their end if that has passed, otherwise still out), the ones that hadn't started are dropped. The old tables are then dropped. Runs once.
DO $$
DECLARE r RECORD; tid INT; first_troop INT;
BEGIN
  SELECT id INTO first_troop FROM troops ORDER BY id LIMIT 1;
  IF to_regclass('depot_bookings') IS NOT NULL THEN
    FOR r IN SELECT * FROM depot_bookings WHERE starts_at <= now() ORDER BY id LOOP
      INSERT INTO depot_takes (troop_id, taken_at, returned_at, note, leader_id, leader_name, created_at)
        VALUES (r.troop_id, r.starts_at, CASE WHEN r.ends_at <= now() THEN r.ends_at END, r.note, r.leader_id, r.leader_name, r.created_at) RETURNING id INTO tid;
      INSERT INTO depot_take_items (take_id, item_id, quantity) SELECT tid, item_id, quantity FROM depot_booking_items WHERE booking_id = r.id;
    END LOOP;
    DROP TABLE depot_booking_items;
    DROP TABLE depot_bookings;
  END IF;
  IF to_regclass('depot_reservations') IS NOT NULL THEN
    FOR r IN SELECT * FROM depot_reservations WHERE starts_at <= now() AND COALESCE(troop_id, first_troop) IS NOT NULL ORDER BY id LOOP
      INSERT INTO depot_takes (troop_id, taken_at, returned_at, note, leader_id, leader_name, created_at)
        VALUES (COALESCE(r.troop_id, first_troop), r.starts_at, CASE WHEN r.ends_at <= now() THEN r.ends_at END, r.note, r.leader_id, r.leader_name, r.created_at) RETURNING id INTO tid;
      INSERT INTO depot_take_items (take_id, item_id, quantity) VALUES (tid, r.item_id, r.quantity);
    END LOOP;
    DROP TABLE depot_reservations;
  END IF;
END $$;

-- session version: every login cookie carries it; changing or resetting the password raises it, which signs out all older sessions
ALTER TABLE leaders ADD COLUMN IF NOT EXISTS session_v INT NOT NULL DEFAULT 0;

-- home page: news, activities and events. troop_id NULL = shown in every troop. ticker = also scrolls in the news ticker; pinned = listed first.
-- event_date (optional) is the day of an activity or event: upcoming ones are listed under "Coming up"
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  troop_id INT REFERENCES troops(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'news' CHECK (kind IN ('news', 'activity', 'event')),
  title TEXT NOT NULL,
  body TEXT,
  event_date DATE,
  ticker BOOLEAN NOT NULL DEFAULT false,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_by INT REFERENCES leaders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_troop_idx ON posts(troop_id, created_at DESC);

-- weekly reports: what a troop did at its weekly meeting (Saturday). One per troop and week; week_date is the Saturday.
-- a week taken off the weekly reports page altogether (not just emptied): the week itself is removed from the list and from the form's choices
CREATE TABLE IF NOT EXISTS report_weeks_removed (
  week_date DATE PRIMARY KEY,
  removed_by INT REFERENCES leaders(id) ON DELETE SET NULL,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS weekly_reports (
  id SERIAL PRIMARY KEY,
  troop_id INT NOT NULL REFERENCES troops(id) ON DELETE CASCADE,
  week_date DATE NOT NULL,
  body TEXT NOT NULL,
  created_by INT REFERENCES leaders(id) ON DELETE SET NULL,
  updated_by INT REFERENCES leaders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (troop_id, week_date)
);

-- a post can be about one troop, several (a joint event) or all: post_troops lists them, no rows = all troops. (posts.troop_id is the old single-troop column:
-- what it held is copied here once and the column is emptied, and nothing reads it any more)
CREATE TABLE IF NOT EXISTS post_troops (
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  troop_id INT NOT NULL REFERENCES troops(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, troop_id)
);
INSERT INTO post_troops (post_id, troop_id) SELECT id, troop_id FROM posts WHERE troop_id IS NOT NULL ON CONFLICT DO NOTHING;
UPDATE posts SET troop_id = NULL WHERE troop_id IS NOT NULL;

-- a troop's slogan ("Always Prepared"), shown next to the troop's name in the leader area
ALTER TABLE troops ADD COLUMN IF NOT EXISTS slogan_en TEXT;
ALTER TABLE troops ADD COLUMN IF NOT EXISTS slogan_ar TEXT;

-- the musical team (الفريق الموسيقي): one team for the whole site, made of existing scouts (a member must have a scout profile in a troop) in two groups,
-- brass (نحاسي) and percussion (إيقاع). It has its own weekly meetings with attendance and its own XP, separate from every troop's XP (xp_log is not used).
CREATE TABLE IF NOT EXISTS music_members (
  scout_id INT PRIMARY KEY REFERENCES scouts(id) ON DELETE CASCADE,
  grp TEXT NOT NULL CHECK (grp IN ('brass', 'percussion')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by INT REFERENCES leaders(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS music_meetings (
  id SERIAL PRIMARY KEY,
  meeting_date DATE NOT NULL,
  title TEXT NOT NULL,
  xp INT NOT NULL DEFAULT 10 CHECK (xp BETWEEN 0 AND 1000),
  absent_xp INT NOT NULL DEFAULT 0 CHECK (absent_xp BETWEEN 0 AND 1000),
  created_by INT REFERENCES leaders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_meetings_date_idx ON music_meetings(meeting_date DESC);
-- a row = that member's mark for the meeting (no row = no mark)
CREATE TABLE IF NOT EXISTS music_attendance (
  meeting_id INT NOT NULL REFERENCES music_meetings(id) ON DELETE CASCADE,
  scout_id INT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
  PRIMARY KEY (meeting_id, scout_id)
);
CREATE INDEX IF NOT EXISTS music_attendance_scout_idx ON music_attendance(scout_id);
-- the team's own XP history (same shape as xp_log); the entries made by attendance are linked to their meeting, one per member and meeting
CREATE TABLE IF NOT EXISTS music_xp_log (
  id SERIAL PRIMARY KEY,
  scout_id INT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  activity TEXT NOT NULL,
  activity_ar TEXT,
  xp INT NOT NULL,
  note TEXT,
  leader_id INT REFERENCES leaders(id) ON DELETE SET NULL,
  activity_date DATE,
  meeting_id INT REFERENCES music_meetings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_xp_log_scout_idx ON music_xp_log(scout_id);
CREATE UNIQUE INDEX IF NOT EXISTS music_xp_log_meeting_scout_idx ON music_xp_log(meeting_id, scout_id) WHERE meeting_id IS NOT NULL;
-- each group is split into two sub teams: فريق أول (1) and فريق ثاني (2)
ALTER TABLE music_members ADD COLUMN IF NOT EXISTS sub INT NOT NULL DEFAULT 1;
ALTER TABLE music_members DROP CONSTRAINT IF EXISTS music_members_sub_check;
ALTER TABLE music_members ADD CONSTRAINT music_members_sub_check CHECK (sub IN (1, 2));
-- the musical team's own depot (instruments): same shape as depot_items, plus the group an instrument belongs to (NULL: both). Separate from the troops' depot.
CREATE TABLE IF NOT EXISTS music_depot_items (
  id SERIAL PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  grp TEXT CHECK (grp IN ('brass', 'percussion')),
  quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
