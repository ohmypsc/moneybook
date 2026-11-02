-- Moneybook D1 운영 스키마 (moneybook-prod에서 2026-11-02에 sqlite_master로 추출)
--
-- 용도: 데이터베이스를 새로 만들어야 할 때 테이블 구조를 다시 만드는 설계도입니다.
-- 데이터는 들어 있지 않습니다. 데이터는 앱의 설정 > JSON 백업으로 복원합니다.
--
-- ⚠️ 이미 운영 중인 moneybook-prod에는 실행할 필요가 없습니다.
--    (IF NOT EXISTS라서 실행해도 기존 테이블/데이터는 바뀌지 않습니다.)
--
-- 새 D1에 적용하는 예:
--   npx wrangler d1 execute <새-DB-이름> --remote --file=./migrations/0000_schema.sql
--
-- 참고: benefit_reward_usage, real_estate_assets는 Worker가 필요할 때 스스로 만들기도 합니다.
--       _cf_KV, sqlite_sequence는 Cloudflare/SQLite 내부 테이블이라 제외했습니다.

-- ── 기본 ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS households ( household_id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Seoul', currency TEXT NOT NULL DEFAULT 'KRW', ledger_start_date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT );

CREATE TABLE IF NOT EXISTS members ( member_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, display_name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT, FOREIGN KEY (household_id) REFERENCES households(household_id) );

CREATE TABLE IF NOT EXISTS schema_meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

CREATE TABLE IF NOT EXISTS user_preferences ( preference_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, member_id TEXT, preference_key TEXT NOT NULL, preference_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (household_id) REFERENCES households(household_id), FOREIGN KEY (member_id) REFERENCES members(member_id) );

-- ── 계좌 / 카테고리 / 거래 ──────────────────────────────

CREATE TABLE IF NOT EXISTS accounts ( account_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, display_name TEXT, account_type TEXT NOT NULL, sub_type TEXT, owner_member_id TEXT, owner_label TEXT, opening_balance INTEGER NOT NULL DEFAULT 0, billing_cutoff_day INTEGER, payment_day INTEGER, payment_account_id TEXT, start_year INTEGER, end_year INTEGER, is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), balance_method TEXT, current_balance_override REAL, asset_attribution TEXT, investment_cash_baseline_krw REAL, investment_cash_baseline_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT, updated_by TEXT, deleted_at TEXT, deleted_by TEXT, source_row INTEGER, FOREIGN KEY (household_id) REFERENCES households(household_id), FOREIGN KEY (owner_member_id) REFERENCES members(member_id), FOREIGN KEY (payment_account_id) REFERENCES accounts(account_id) );

CREATE TABLE IF NOT EXISTS tax_categories ( tax_category_code TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

CREATE TABLE IF NOT EXISTS categories ( category_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('수입','지출','이체')), name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), default_tax_category_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT, updated_by TEXT, deleted_at TEXT, deleted_by TEXT, source_row INTEGER, FOREIGN KEY (household_id) REFERENCES households(household_id) );

CREATE TABLE IF NOT EXISTS transactions ( transaction_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, request_id TEXT, date TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('수입','지출','이체')), category_id TEXT, amount INTEGER NOT NULL CHECK (amount >= 0), from_account_id TEXT, to_account_id TEXT, payment_method_id TEXT, spending_target TEXT, spender_member_id TEXT, entered_by_member_id TEXT, description TEXT, memo TEXT, billing_month_override TEXT, billing_month TEXT, group_id TEXT, reversal_of TEXT, version INTEGER NOT NULL DEFAULT 1, taxpayer_member_id TEXT, tax_category_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT, updated_by TEXT, deleted_at TEXT, deleted_by TEXT, source_row INTEGER, FOREIGN KEY (household_id) REFERENCES households(household_id), FOREIGN KEY (category_id) REFERENCES categories(category_id), FOREIGN KEY (from_account_id) REFERENCES accounts(account_id), FOREIGN KEY (to_account_id) REFERENCES accounts(account_id), FOREIGN KEY (payment_method_id) REFERENCES accounts(account_id), FOREIGN KEY (spender_member_id) REFERENCES members(member_id), FOREIGN KEY (entered_by_member_id) REFERENCES members(member_id), FOREIGN KEY (taxpayer_member_id) REFERENCES members(member_id), FOREIGN KEY (reversal_of) REFERENCES transactions(transaction_id) );

CREATE TABLE IF NOT EXISTS benefit_reward_usage ( transaction_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, rule_id TEXT NOT NULL, account_id TEXT NOT NULL, used_amount REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL );

CREATE TABLE IF NOT EXISTS change_log ( change_seq INTEGER PRIMARY KEY AUTOINCREMENT, household_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('created','updated','deleted','restored')), entity_version INTEGER, changed_by_member_id TEXT, payload_json TEXT, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (household_id) REFERENCES households(household_id), FOREIGN KEY (changed_by_member_id) REFERENCES members(member_id) );

-- ── 투자 ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS holdings ( holding_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, account_id TEXT NOT NULL, stock_code TEXT NOT NULL, stock_name TEXT, market TEXT, quantity REAL NOT NULL DEFAULT 0, avg_buy_price REAL NOT NULL DEFAULT 0, quote_mode TEXT, manual_price REAL, current_price REAL, fx_rate REAL, value_krw REAL, book_cost_krw REAL, return_rate REAL, owner_label TEXT, last_updated TEXT, elapsed_days INTEGER, baseline_quantity REAL NOT NULL DEFAULT 0, baseline_avg_price REAL NOT NULL DEFAULT 0, baseline_book_cost_krw REAL NOT NULL DEFAULT 0, baseline_at TEXT, managed_by_trades INTEGER NOT NULL DEFAULT 0 CHECK (managed_by_trades IN (0,1)), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT, updated_by TEXT, deleted_at TEXT, deleted_by TEXT, source_row INTEGER, FOREIGN KEY (household_id) REFERENCES households(household_id), FOREIGN KEY (account_id) REFERENCES accounts(account_id) );

CREATE TABLE IF NOT EXISTS investment_trades ( investment_trade_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, request_id TEXT, trade_date TEXT NOT NULL, trade_type TEXT NOT NULL, account_id TEXT NOT NULL, holding_id TEXT NOT NULL, stock_code TEXT NOT NULL, stock_name TEXT, market TEXT, quantity REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0, currency TEXT, fx_rate REAL, fee_krw REAL NOT NULL DEFAULT 0, tax_krw REAL NOT NULL DEFAULT 0, settlement_krw REAL NOT NULL DEFAULT 0, realized_pnl_krw REAL NOT NULL DEFAULT 0, memo TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT, updated_by TEXT, deleted_at TEXT, deleted_by TEXT, source_row INTEGER, FOREIGN KEY (household_id) REFERENCES households(household_id), FOREIGN KEY (account_id) REFERENCES accounts(account_id), FOREIGN KEY (holding_id) REFERENCES holdings(holding_id) );

-- ── 자산 / 부동산 / 세금 ─────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_snapshots ( household_id TEXT NOT NULL, month TEXT NOT NULL, assets REAL NOT NULL DEFAULT 0, liabilities REAL NOT NULL DEFAULT 0, net_worth REAL NOT NULL DEFAULT 0, investment_value REAL NOT NULL DEFAULT 0, cash_like_value REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT, updated_by TEXT, PRIMARY KEY (household_id, month), FOREIGN KEY (household_id) REFERENCES households(household_id) );

CREATE TABLE IF NOT EXISTS real_estate_assets ( property_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, property_type TEXT NOT NULL DEFAULT '아파트', address TEXT, lawd_code TEXT, apartment_name TEXT, exclusive_area_sqm REAL, floor INTEGER, owner_label TEXT, purchase_price_krw REAL, valuation_mode TEXT NOT NULL DEFAULT 'auto', manual_value_krw REAL, estimated_value_krw REAL, estimate_low_krw REAL, estimate_high_krw REAL, estimate_trade_count INTEGER NOT NULL DEFAULT 0, estimate_updated_at TEXT, last_trade_date TEXT, recent_trades_json TEXT, created_at TEXT, updated_at TEXT, created_by TEXT, updated_by TEXT, deleted_at TEXT, deleted_by TEXT );

CREATE TABLE IF NOT EXISTS tax_rule_sets ( tax_year INTEGER PRIMARY KEY, rules_json TEXT NOT NULL, source_name TEXT, source_url TEXT, effective_from TEXT, effective_to TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

CREATE TABLE IF NOT EXISTS tax_year_profiles ( household_id TEXT NOT NULL, member_id TEXT NOT NULL, tax_year INTEGER NOT NULL, gross_salary_krw INTEGER, salary_income_krw INTEGER, profile_json TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (household_id, member_id, tax_year), FOREIGN KEY (household_id) REFERENCES households(household_id), FOREIGN KEY (member_id) REFERENCES members(member_id) );

-- ── 인덱스 ────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_accounts_household ON accounts(household_id);
CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(household_id, owner_member_id);
CREATE INDEX IF NOT EXISTS idx_asset_snapshots_month ON asset_snapshots(household_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_benefit_reward_usage_household_rule ON benefit_reward_usage(household_id, rule_id, account_id);
CREATE INDEX IF NOT EXISTS idx_categories_household_type ON categories(household_id, type);
CREATE INDEX IF NOT EXISTS idx_change_log_household_seq ON change_log(household_id, change_seq);
CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(household_id, account_id);
CREATE INDEX IF NOT EXISTS idx_holdings_stock ON holdings(household_id, stock_code);
CREATE INDEX IF NOT EXISTS idx_investment_trades_account_date ON investment_trades(household_id, account_id, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_investment_trades_holding_date ON investment_trades(household_id, holding_id, trade_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_trades_request ON investment_trades(household_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_members_household ON members(household_id);
CREATE INDEX IF NOT EXISTS idx_preferences_household_member ON user_preferences(household_id, member_id);
CREATE INDEX IF NOT EXISTS idx_real_estate_household ON real_estate_assets(household_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tax_profiles_year ON tax_year_profiles(household_id, tax_year, member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(household_id, category_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_from_account ON transactions(household_id, from_account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_group ON transactions(household_id, group_id);
CREATE INDEX IF NOT EXISTS idx_transactions_household_date ON transactions(household_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_billing ON transactions(household_id, payment_method_id, billing_month);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_request ON transactions(household_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_reversal ON transactions(reversal_of);
CREATE INDEX IF NOT EXISTS idx_transactions_to_account ON transactions(household_id, to_account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(household_id, type, date DESC);
