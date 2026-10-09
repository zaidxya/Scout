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
  ADD COLUMN IF NOT EXISTS activity_id INT REFERENCES activities(id) ON DELETE SET NULL;
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
-- every leader is also a scout: leaders.scout_id points at their scout profile
ALTER TABLE leaders ADD COLUMN IF NOT EXISTS scout_id INT REFERENCES scouts(id) ON DELETE SET NULL;

ALTER TABLE labels ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;
