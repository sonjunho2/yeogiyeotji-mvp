CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, privacy TEXT NOT NULL CHECK (privacy IN ('private', 'link')),
  share_token TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (owner_id, id)
);
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, category TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', tags TEXT[] NOT NULL DEFAULT '{}',
  visited_at TEXT NOT NULL, latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180), collection_id TEXT,
  privacy TEXT NOT NULL CHECK (privacy IN ('private', 'link', 'public')), image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (owner_id, collection_id) REFERENCES collections(owner_id, id) ON DELETE RESTRICT
);
