-- The latest Strava activities of every type, kept only to show on the
-- dashboard that syncing works. Runs get their full record in `runs`.
CREATE TABLE activities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strava_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  distance_m REAL NOT NULL,
  PRIMARY KEY (user_id, strava_id)
);
