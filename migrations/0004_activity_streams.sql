-- Per-second data (speed, heart rate, power, cadence, elevation) for any
-- activity that has songs to show against it, not only runs.
ALTER TABLE activities ADD COLUMN streams TEXT;
ALTER TABLE activities ADD COLUMN stream_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE activities ADD COLUMN stream_tries INTEGER NOT NULL DEFAULT 0;
