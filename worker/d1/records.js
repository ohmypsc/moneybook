// D1 행 → API 모델 매핑과 기본 조회(계좌·거래·보유종목·투자거래)
import { normalizeTags } from "../domain/classification.js";
import { dateOnly as mbD1DateOnly } from "../domain/date.js";
import {
  isSettlementEligibleCategory as mbD1IsSettlementEligibleCategory,
  SETTLEMENT_REQUEST_PREFIX,
  systemCategoryRole as mbD1SystemCategoryRole
} from "../domain/settlement.js";
import {
  MB_D1_HOUSEHOLD_ID,
  mbD1AccountActive,
  mbD1All,
  mbD1Bool,
  mbD1CurrentDateSeoul,
  mbD1DisplayName,
  mbD1First,
  mbD1NullableNumber,
  mbD1Number,
  mbD1Round,
  mbD1Text,
  mbD1TimestampMs
} from "./core.js";

export function mbD1MapCategory(row) {
  const type = mbD1Text(row.type);
  const name = mbD1Text(row.name);
  const categoryId = mbD1Text(row.category_id);
  const systemRole = mbD1SystemCategoryRole(type, name, categoryId);
  return {
    categoryId,
    type,
    name,
    settlementEligible: type === "지출",
    systemLocked: Boolean(systemRole),
    systemRole: systemRole || null,
    active: mbD1Bool(row.is_active),
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

export function mbD1MapAccountRow(row) {
  const owner = mbD1Text(row.owner_label || row.owner_name);
  const active = mbD1AccountActive(row);
  return {
    accountId: mbD1Text(row.account_id),
    accountName: mbD1Text(row.name),
    displayName: mbD1Text(row.display_name) || mbD1DisplayName(row.name, owner),
    accountType: mbD1Text(row.account_type),
    subType: mbD1Text(row.sub_type),
    owner,
    openingBalance: mbD1Number(row.opening_balance),
    billingCutoffDay: mbD1NullableNumber(row.billing_cutoff_day),
    paymentDay: mbD1NullableNumber(row.payment_day),
    startYear: mbD1NullableNumber(row.start_year),
    endYear: mbD1NullableNumber(row.end_year),
    active,
    balanceMethod: mbD1Text(row.balance_method),
    sheetCurrentBalance: mbD1Number(row.current_balance_override),
    paymentAccountId: row.payment_account_id || null,
    paymentAccountName: mbD1Text(row.payment_account_name) || null,
    assetAttribution: mbD1Text(row.asset_attribution),
    cashBaselineKrw: mbD1NullableNumber(row.investment_cash_baseline_krw),
    cashBaselineAtDate: row.investment_cash_baseline_at || null,
    cashBaselineAt: row.investment_cash_baseline_at || null,
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

export async function mbD1RawAccounts(env) {
  return mbD1All(
    env,
    `SELECT a.*, m.display_name AS owner_name, p.display_name AS payment_account_name
     FROM accounts a
     LEFT JOIN members m ON m.member_id=a.owner_member_id
     LEFT JOIN accounts p ON p.account_id=a.payment_account_id
     WHERE a.household_id=?
     ORDER BY COALESCE(a.display_name,a.name), a.account_id`,
    [MB_D1_HOUSEHOLD_ID]
  );
}

export function mbD1MapTransactionRow(row) {
  return {
    tags: normalizeTags(JSON.parse(row.tags_json || "[]")),
    categorySource: row.category_source || "manual",
    transactionId: mbD1Text(row.transaction_id),
    date: mbD1Text(row.date),
    type: mbD1Text(row.type),
    categoryId: row.category_id || null,
    category: mbD1Text(row.category_name),
    settlementEligible: mbD1IsSettlementEligibleCategory(
      row.type,
      row.category_name,
      row.category_id
    ),
    amount: mbD1Number(row.amount),
    fromAccountId: row.from_account_id || null,
    fromAccount: mbD1Text(row.from_account_name) || null,
    toAccountId: row.to_account_id || null,
    toAccount: mbD1Text(row.to_account_name) || null,
    paymentMethodId: row.payment_method_id || null,
    paymentMethod: mbD1Text(row.payment_method_name) || null,
    spendingTarget: mbD1Text(row.spending_target) || null,
    description: mbD1Text(row.description),
    memo: mbD1Text(row.memo),
    billingOverride: row.billing_month_override || null,
    billingMonth: row.billing_month || null,
    installmentMonths: Number(row.installment_months) >= 2 ? Number(row.installment_months) : null,
    groupId: row.group_id || null,
    requestId: row.request_id || null,
    reversalOf: row.reversal_of || null,
    reversalAmount: mbD1Number(row.reversal_total),
    settlementAmount: mbD1Number(row.settlement_total),
    refundAmount: Math.max(0, mbD1Number(row.reversal_total) - mbD1Number(row.settlement_total)),
    netAmount: Math.max(0, mbD1Number(row.amount) - mbD1Number(row.reversal_total)),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    updatedAtMs: mbD1TimestampMs(row.updated_at),
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by),
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

export const MB_D1_TRANSACTION_FROM = `
  FROM transactions t
  LEFT JOIN categories c ON c.category_id=t.category_id
  LEFT JOIN accounts fa ON fa.account_id=t.from_account_id
  LEFT JOIN accounts ta ON ta.account_id=t.to_account_id
  LEFT JOIN accounts pm ON pm.account_id=t.payment_method_id
`;

export const MB_D1_TRANSACTION_SELECT = `
  SELECT t.*,
         c.name AS category_name,
         fa.display_name AS from_account_name,
         ta.display_name AS to_account_name,
         pm.display_name AS payment_method_name,
         COALESCE((
           SELECT SUM(r.amount)
           FROM transactions r
           WHERE r.household_id=t.household_id
             AND r.reversal_of=t.transaction_id
             AND r.deleted_at IS NULL
         ),0) AS reversal_total,
         COALESCE((
           SELECT SUM(r.amount)
           FROM transactions r
           WHERE r.household_id=t.household_id
             AND r.reversal_of=t.transaction_id
             AND r.deleted_at IS NULL
             AND r.request_id LIKE '${SETTLEMENT_REQUEST_PREFIX}%'
         ),0) AS settlement_total
  ${MB_D1_TRANSACTION_FROM}
`;

export async function mbD1AllTransactions(env, includeDeleted = false) {
  const rows = await mbD1All(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}
     ORDER BY t.date DESC, COALESCE(t.source_row,0) DESC, t.created_at DESC`,
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows.map(mbD1MapTransactionRow);
}

export async function mbD1RecentImportTransactions(env, limit = 800) {
  const safeLimit = Math.max(1, Math.min(2000, Math.trunc(Number(limit) || 800)));
  const rows = await mbD1All(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? AND t.deleted_at IS NULL
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ?`,
    [MB_D1_HOUSEHOLD_ID, safeLimit]
  );
  return rows.map(mbD1MapTransactionRow);
}

export async function mbD1TransactionById(env, transactionId, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? AND t.transaction_id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}
     LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, transactionId]
  );
  return row ? mbD1MapTransactionRow(row) : null;
}

export function mbD1MapHoldingRow(row) {
  const quantity = mbD1Number(row.quantity);
  const currentPrice = mbD1NullableNumber(row.current_price);
  const fx = mbD1NullableNumber(row.fx_rate) ?? (mbD1Text(row.market) === "국내" ? 1 : null);
  const value =
    mbD1NullableNumber(row.value_krw) ??
    (currentPrice !== null && fx !== null ? quantity * currentPrice * fx : 0);
  const bookCost = mbD1NullableNumber(row.book_cost_krw) ?? 0;
  const returnRate =
    mbD1NullableNumber(row.return_rate) ?? (bookCost > 0 ? (value - bookCost) / bookCost : null);
  let elapsedDays = mbD1NullableNumber(row.elapsed_days);
  const lastUpdated = mbD1Text(row.last_updated) || null;
  if (lastUpdated && mbD1DateOnly(lastUpdated)) {
    const now = Date.parse(mbD1CurrentDateSeoul() + "T00:00:00+09:00");
    const then = Date.parse(lastUpdated + "T00:00:00+09:00");
    if (Number.isFinite(now) && Number.isFinite(then)) {
      elapsedDays = Math.max(0, Math.floor((now - then) / 86400000));
    }
  }
  return {
    holdingId: mbD1Text(row.holding_id),
    accountId: mbD1Text(row.account_id) || null,
    accountName: mbD1Text(row.account_name) || null,
    stockCode: mbD1Text(row.stock_code).toUpperCase(),
    stockName: mbD1Text(row.stock_name),
    market: mbD1Text(row.market),
    quantity,
    avgBuyPrice: mbD1Number(row.avg_buy_price),
    quoteMode: mbD1Text(row.quote_mode),
    manualPrice: mbD1NullableNumber(row.manual_price),
    currentPrice: currentPrice ?? 0,
    fx: fx ?? 0,
    valueKrw: mbD1Round(value, 2),
    costKrw: mbD1Round(bookCost, 2),
    bookCostKrw: mbD1Round(bookCost, 2),
    returnRate,
    owner: mbD1Text(row.owner_label),
    lastUpdated,
    elapsedDays,
    baselineQuantity: mbD1Number(row.baseline_quantity),
    baselineAvgPrice: mbD1Number(row.baseline_avg_price),
    baselineBookCostKrw: mbD1Number(row.baseline_book_cost_krw),
    baselineAt: row.baseline_at || null,
    baselineAtDate: row.baseline_at || null,
    managedByTradesV22: mbD1Bool(row.managed_by_trades),
    updatedAt: row.updated_at || null,
    updatedAtMs: mbD1TimestampMs(row.updated_at),
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

export async function mbD1Holdings(env, includeDeleted = false) {
  const rows = await mbD1All(
    env,
    `SELECT h.*, a.display_name AS account_name
     FROM holdings h
     LEFT JOIN accounts a ON a.account_id=h.account_id
     WHERE h.household_id=? ${includeDeleted ? "" : "AND h.deleted_at IS NULL"}
     ORDER BY h.account_id,h.stock_code,h.holding_id`,
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows.map(mbD1MapHoldingRow);
}

export function mbD1MapTradeRow(row) {
  return {
    investmentTradeId: mbD1Text(row.investment_trade_id),
    date: mbD1Text(row.trade_date),
    tradeDate: mbD1Text(row.trade_date),
    tradeType: mbD1Text(row.trade_type),
    accountId: mbD1Text(row.account_id),
    accountName: mbD1Text(row.account_name),
    holdingId: mbD1Text(row.holding_id),
    stockCode: mbD1Text(row.stock_code).toUpperCase(),
    stockName: mbD1Text(row.stock_name),
    market: mbD1Text(row.market),
    quantity: mbD1Number(row.quantity),
    unitPrice: mbD1Number(row.unit_price),
    currency: mbD1Text(row.currency).toUpperCase(),
    fxRate: mbD1Number(row.fx_rate),
    feeKrw: mbD1Number(row.fee_krw),
    taxKrw: mbD1Number(row.tax_krw),
    settlementKrw: mbD1Number(row.settlement_krw),
    realizedPnlKrw: mbD1Number(row.realized_pnl_krw),
    memo: mbD1Text(row.memo),
    requestId: row.request_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    updatedAtMs: mbD1TimestampMs(row.updated_at),
    isDeleted: Boolean(row.deleted_at),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by),
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    row: mbD1Number(row.source_row, 0)
  };
}

export async function mbD1Trades(env, includeDeleted = false) {
  const rows = await mbD1All(
    env,
    `SELECT t.*, a.display_name AS account_name
     FROM investment_trades t
     LEFT JOIN accounts a ON a.account_id=t.account_id
     WHERE t.household_id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}
     ORDER BY t.trade_date,t.created_at,t.investment_trade_id`,
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows.map(mbD1MapTradeRow);
}

export async function mbD1CategoryById(env, id, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `SELECT * FROM categories WHERE household_id=? AND category_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"} LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, id]
  );
  return row ? mbD1MapCategory(row) : null;
}

export async function mbD1AccountById(env, id, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `SELECT a.*,m.display_name AS owner_name,p.display_name AS payment_account_name
     FROM accounts a
     LEFT JOIN members m ON m.member_id=a.owner_member_id
     LEFT JOIN accounts p ON p.account_id=a.payment_account_id
     WHERE a.household_id=? AND a.account_id=? ${includeDeleted ? "" : "AND a.deleted_at IS NULL"} LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, id]
  );
  return row ? mbD1MapAccountRow(row) : null;
}
