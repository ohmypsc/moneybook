-- 이 쿼리는 데이터를 변경하지 않습니다.
-- 결과가 0행이어야 request_id UNIQUE 인덱스를 안전하게 추가할 수 있습니다.

SELECT 'transactions' AS table_name, household_id, request_id, COUNT(*) AS duplicate_count
FROM transactions
WHERE request_id IS NOT NULL AND request_id <> ''
GROUP BY household_id, request_id
HAVING COUNT(*) > 1;

SELECT 'investment_trades' AS table_name, household_id, request_id, COUNT(*) AS duplicate_count
FROM investment_trades
WHERE request_id IS NOT NULL AND request_id <> ''
GROUP BY household_id, request_id
HAVING COUNT(*) > 1;
