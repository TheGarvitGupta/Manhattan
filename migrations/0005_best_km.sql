-- Each run's fastest single kilometre: how long it took, and how many seconds
-- into the run it began. Worked out once, when the run's data is fetched.
ALTER TABLE runs ADD COLUMN best_km_s REAL;
ALTER TABLE runs ADD COLUMN best_km_at REAL;
