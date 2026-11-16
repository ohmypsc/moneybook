-- Existing installations are upgraded idempotently by the Worker on first API use.
-- These statements are only for installations applying ordered SQL migrations instead.
ALTER TABLE transactions ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE transactions ADD COLUMN category_source TEXT NOT NULL DEFAULT 'manual';
