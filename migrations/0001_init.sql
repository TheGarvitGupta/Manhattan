-- All timestamps are unix seconds (UTC).

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strava_athlete_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  -- Runs before this moment have no song data and are not counted as "silent".
  spotify_since INTEGER,
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- OAuth tokens, AES-GCM encrypted with TOKEN_KEY.
CREATE TABLE tokens (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('strava', 'spotify')),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  last_sync_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strava_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  distance_m REAL NOT NULL,
  moving_s INTEGER NOT NULL,
  elapsed_s INTEGER NOT NULL,
  avg_hr REAL,
  -- 'pending' until the per-second streams are fetched, then 'ok' or 'none'.
  stream_state TEXT NOT NULL DEFAULT 'pending',
  stream_tries INTEGER NOT NULL DEFAULT 0,
  -- JSON {t,d,m,hr}: elapsed s, metres, cumulative moving s, heart rate.
  streams TEXT,
  matched_at INTEGER,
  UNIQUE (user_id, strava_id)
);
CREATE INDEX runs_user_time ON runs (user_id, start_time);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  image TEXT,
  duration_s REAL NOT NULL
);

CREATE TABLE plays (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  PRIMARY KEY (user_id, played_at)
);

-- One row per song heard during a run, with how the run went while it played.
CREATE TABLE run_songs (
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  start_s REAL NOT NULL,
  end_s REAL NOT NULL,
  distance_m REAL NOT NULL,
  moving_s REAL NOT NULL,
  avg_hr REAL,
  skipped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, idx)
);
