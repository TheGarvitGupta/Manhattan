-- Each run's fastest single mile, alongside its fastest kilometre, so the
-- dashboard can show whichever unit the viewer has chosen.
ALTER TABLE runs ADD COLUMN best_mi_s REAL;
ALTER TABLE runs ADD COLUMN best_mi_at REAL;
