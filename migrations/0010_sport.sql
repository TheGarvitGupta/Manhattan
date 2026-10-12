-- Rides are kept in full alongside runs, in the same table, and analysed the
-- same way. `sport` says which each row is: 'run' or 'ride'.
ALTER TABLE runs ADD COLUMN sport TEXT NOT NULL DEFAULT 'run';
CREATE INDEX runs_user_sport_time ON runs (user_id, sport, start_time);
