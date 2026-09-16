-- 적용 전 database/check-request-id-duplicates.sql 결과가 0행인지 확인하세요.
-- 이미 중복 데이터가 있으면 CREATE UNIQUE INDEX가 실패하며 기존 데이터는 변경되지 않습니다.

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_household_request_id
ON transactions(household_id, request_id)
WHERE request_id IS NOT NULL AND request_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_investment_trades_household_request_id
ON investment_trades(household_id, request_id)
WHERE request_id IS NOT NULL AND request_id <> '';

PRAGMA optimize;
