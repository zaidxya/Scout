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

-- account level "mod" (مسؤول): sees only the members and their activity
ALTER TABLE leaders DROP CONSTRAINT IF EXISTS leaders_role_check;
ALTER TABLE leaders ADD CONSTRAINT leaders_role_check CHECK (role IN ('super_admin', 'admin', 'leader', 'mod'));

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
ALTER TABLE xp_log ADD COLUMN IF NOT EXISTS meeting_id INT REFERENCES meetings(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS xp_log_meeting_scout_idx ON xp_log(meeting_id, scout_id) WHERE meeting_id IS NOT NULL;

-- the scout lists check for every scout whether it belongs to a leader account
CREATE INDEX IF NOT EXISTS leaders_scout_idx ON leaders(scout_id);

-- depot reservations, made for a troop: one booking holds a basket of items (each with a quantity) for one time window.
-- An item can't be booked beyond its quantity at any time. leader_name keeps who made it after the account is gone.
CREATE TABLE IF NOT EXISTS depot_bookings (
  id SERIAL PRIMARY KEY,
  troop_id INT NOT NULL REFERENCES troops(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  leader_id INT REFERENCES leaders(id) ON DELETE SET NULL,
  leader_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS depot_bookings_ends_idx ON depot_bookings(ends_at);
CREATE TABLE IF NOT EXISTS depot_booking_items (
  booking_id INT NOT NULL REFERENCES depot_bookings(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES depot_items(id) ON DELETE CASCADE,
  quantity INT NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (booking_id, item_id)
);
CREATE INDEX IF NOT EXISTS depot_booking_items_item_idx ON depot_booking_items(item_id);
-- build 34 kept one row per item (depot_reservations): each becomes a one-item booking of the troop it was made for
-- (the super admin's had no troop: they go to the first troop), then the old table is dropped. Runs once.
DO $$
DECLARE r RECORD; bid INT; first_troop INT;
BEGIN
  IF to_regclass('depot_reservations') IS NOT NULL THEN
    SELECT id INTO first_troop FROM troops ORDER BY id LIMIT 1;
    FOR r IN SELECT * FROM depot_reservations ORDER BY id LOOP
      CONTINUE WHEN COALESCE(r.troop_id, first_troop) IS NULL;
      INSERT INTO depot_bookings (troop_id, starts_at, ends_at, note, leader_id, leader_name, created_at)
        VALUES (COALESCE(r.troop_id, first_troop), r.starts_at, r.ends_at, r.note, r.leader_id, r.leader_name, r.created_at) RETURNING id INTO bid;
      INSERT INTO depot_booking_items (booking_id, item_id, quantity) VALUES (bid, r.item_id, r.quantity);
    END LOOP;
    DROP TABLE depot_reservations;
  END IF;
END $$;

-- session version: every login cookie carries it; changing or resetting the password raises it, which signs out all older sessions
ALTER TABLE leaders ADD COLUMN IF NOT EXISTS session_v INT NOT NULL DEFAULT 0;
