-- Spotify only lets a few named accounts use the app, so new people ask the
-- owner to be added. Each ask is kept here and emailed to the owner.
CREATE TABLE access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spotify_email TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL
);
