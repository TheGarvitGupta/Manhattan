-- Email updates. Strava does not share an address, so people give one, and
-- nothing but the welcome email is sent until they confirm it.
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_token TEXT;
ALTER TABLE users ADD COLUMN email_confirmed_at INTEGER;
-- Their timezone and units, so the roundup lands at 9am Sunday for them.
ALTER TABLE users ADD COLUMN email_tz TEXT;
ALTER TABLE users ADD COLUMN email_units TEXT;
ALTER TABLE users ADD COLUMN welcome_sent_at INTEGER;
ALTER TABLE users ADD COLUMN weekly_sent_at INTEGER;
