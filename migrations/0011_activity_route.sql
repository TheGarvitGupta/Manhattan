-- The route of an activity, as Strava's summary polyline, to draw its outline on the activity's page.
ALTER TABLE activities ADD COLUMN polyline TEXT;
