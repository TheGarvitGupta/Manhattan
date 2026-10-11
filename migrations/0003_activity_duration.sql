-- How long each activity lasted, so the songs that played during it can be laid out against it.
ALTER TABLE activities ADD COLUMN elapsed_s INTEGER NOT NULL DEFAULT 0;
