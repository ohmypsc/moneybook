-- Existing installations are upgraded idempotently by the Worker on first API use.
-- This statement is only for installations applying ordered SQL migrations instead.
ALTER TABLE transactions ADD COLUMN settlement_expected INTEGER NOT NULL DEFAULT 0;
