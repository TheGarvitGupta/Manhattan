-- Miles or kilometres, taken from the person's own Strava setting.
-- 'mi' or 'km'; '-' once Strava has been asked and gave no answer.
ALTER TABLE users ADD COLUMN units TEXT;
