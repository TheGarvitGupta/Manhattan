-- How often someone hears from Cadence. An address is now asked for at sign-up,
-- so turning emails off keeps it and clears these instead.
--   email_weekly     the Sunday roundup
--   activity_emails  a note after each run or ride that had music, for those
--                    that start after activity_emails_since
ALTER TABLE users ADD COLUMN email_weekly INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN activity_emails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN activity_emails_since INTEGER;
-- When the note for this run or ride went out, so it goes once.
ALTER TABLE runs ADD COLUMN emailed_at INTEGER;
