// JSON 백업 내보내기와 병합 복원
import { classificationSettingsStatement, ensureClassificationSchema, getClassificationSettings } from "../classification.js";
import { BackupValidationError, findRequestIdConflicts, validateBackupDocument } from "../domain/backupRestore.js";
import { normalizeRules, normalizeTags } from "../domain/classification.js";
import { normalizeInstallmentMonths } from "../domain/installment.js";
import { isObject } from "../http.js";
import { ensureRealEstateSchema, listRealEstateAssets } from "../realEstate.js";
import { MB_D1_AUTOMATION_PREF_ID, MB_D1_AUTOMATION_PREF_KEY, mbD1NormalizeAutomationSettings, mbD1ValidateAutomationSettings } from "./automation.js";
import { mbD1EnsureBenefitUsageSchema } from "./benefits.js";
import { MB_D1_HOUSEHOLD_ID, mbD1All, mbD1Bool, mbD1Fail, mbD1InsertChange, mbD1Now, mbD1Number, mbD1Text } from "./core.js";
import { mbD1BuildBootstrap } from "./dashboard.js";
import { mbD1GetInvestmentCashData } from "./queries.js";
import { MB_D1_TRANSACTION_SELECT, mbD1MapAccountRow, mbD1MapCategory, mbD1MapHoldingRow, mbD1MapTradeRow, mbD1MapTransactionRow, mbD1RawAccounts } from "./records.js";

export const encoder = new TextEncoder();

export async function mbD1BuildBackupDocument(env) {
  await ensureClassificationSchema(env);
  await mbD1EnsureBenefitUsageSchema(env);
  const [
    bootstrap,
    categoryRows,
    accountRows,
    transactionRows,
    snapshotRows,
    holdingRows,
    tradeRows,
    benefitUsageRows,
    investmentCash,
    realEstateAssets
  ] = await Promise.all([
    mbD1BuildBootstrap(env),
    mbD1All(env, "SELECT * FROM categories WHERE household_id=? ORDER BY category_id", [MB_D1_HOUSEHOLD_ID]),
    mbD1RawAccounts(env),
    mbD1All(env, `${MB_D1_TRANSACTION_SELECT} WHERE t.household_id=? ORDER BY t.date,t.transaction_id`, [MB_D1_HOUSEHOLD_ID]),
    mbD1All(env, "SELECT * FROM asset_snapshots WHERE household_id=? ORDER BY month", [MB_D1_HOUSEHOLD_ID]),
    mbD1All(env, `SELECT h.*, a.display_name AS account_name FROM holdings h LEFT JOIN accounts a ON a.account_id=h.account_id WHERE h.household_id=? ORDER BY h.holding_id`, [MB_D1_HOUSEHOLD_ID]),
    mbD1All(env, `SELECT t.*, a.display_name AS account_name FROM investment_trades t LEFT JOIN accounts a ON a.account_id=t.account_id WHERE t.household_id=? ORDER BY t.trade_date,t.investment_trade_id`, [MB_D1_HOUSEHOLD_ID]),
    mbD1All(env, "SELECT transaction_id,rule_id,account_id,used_amount,created_at,updated_at FROM benefit_reward_usage WHERE household_id=? ORDER BY transaction_id", [MB_D1_HOUSEHOLD_ID]),
    mbD1GetInvestmentCashData(env, new URL("https://moneybook.internal/api/investments/cash")),
    listRealEstateAssets(env, MB_D1_HOUSEHOLD_ID, true)
  ]);

  const categories = categoryRows.map((row) => ({
    ...mbD1MapCategory(row),
    storedActive: mbD1Bool(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by)
  }));

  const accounts = accountRows.map((row) => ({
    ...mbD1MapAccountRow(row),
    storedActive: mbD1Bool(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by)
  }));

  const transactions = transactionRows.map((row) => ({
    ...mbD1MapTransactionRow(row),
    version: mbD1Number(row.version, 1),
    taxpayerMemberId: row.taxpayer_member_id || null,
    taxCategoryCode: row.tax_category_code || null
  }));

  const assetSnapshots = snapshotRows.map((row) => ({
    month: row.month,
    assets: mbD1Number(row.assets),
    liabilities: mbD1Number(row.liabilities),
    netWorth: mbD1Number(row.net_worth),
    investmentValue: mbD1Number(row.investment_value),
    cashLikeValue: mbD1Number(row.cash_like_value),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    row: 0
  }));

  const investmentHoldings = holdingRows.map((row) => ({
    ...mbD1MapHoldingRow(row),
    version: mbD1Number(row.version, 1),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by)
  }));

  const investmentTrades = tradeRows.map((row) => ({
    ...mbD1MapTradeRow(row),
    version: mbD1Number(row.version, 1)
  }));

  const benefitRewardUsage = benefitUsageRows.map((row) => ({
    transactionId: mbD1Text(row.transaction_id),
    ruleId: mbD1Text(row.rule_id),
    accountId: mbD1Text(row.account_id),
    usedAmount: mbD1Number(row.used_amount),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }));

  return {
    format: "moneybook-backup",
    version: 3,
    exportedAt: mbD1Now(),
    payload: {
      classificationSettings: await getClassificationSettings(env, MB_D1_HOUSEHOLD_ID),
      userDisplayPreferences: (await mbD1All(env,
        "SELECT preference_key,preference_json FROM user_preferences WHERE household_id=? AND (preference_key LIKE 'input_preferences:%' OR preference_key='household_overview')", [MB_D1_HOUSEHOLD_ID]
      )).map(row => ({ key: row.preference_key, value: JSON.parse(row.preference_json) })),
      bootstrap,
      categories,
      accounts,
      transactions,
      assetSnapshots,
      investmentHoldings,
      investmentTrades,
      investmentCash,
      benefitRewardUsage,
      realEstateAssets
    }
  };
}

export async function mbD1BackupCurrentIdSets(env) {
  await ensureRealEstateSchema(env);
  const tableSpecs = [
    ["categories", "category_id", "categories"],
    ["accounts", "account_id", "accounts"],
    ["transactions", "transaction_id", "transactions"],
    ["holdings", "holding_id", "investmentHoldings"],
    ["investment_trades", "investment_trade_id", "investmentTrades"],
    ["asset_snapshots", "month", "assetSnapshots"],
    ["benefit_reward_usage", "transaction_id", "benefitRewardUsage"],
    ["real_estate_assets", "property_id", "realEstateAssets"]
  ];
  const entries = await Promise.all(tableSpecs.map(async ([table, column, key]) => {
    const rows = await mbD1All(env, `SELECT ${column} AS id FROM ${table} WHERE household_id=?`, [MB_D1_HOUSEHOLD_ID]);
    return [key, new Set(rows.map((row) => mbD1Text(row.id)).filter(Boolean))];
  }));
  return Object.fromEntries(entries);
}

export async function mbD1AssertBackupRequestIdCompatibility(validated, env) {
  const [transactionRows, tradeRows] = await Promise.all([
    mbD1All(
      env,
      "SELECT transaction_id AS id,request_id FROM transactions WHERE household_id=? AND request_id IS NOT NULL",
      [MB_D1_HOUSEHOLD_ID]
    ),
    mbD1All(
      env,
      "SELECT investment_trade_id AS id,request_id FROM investment_trades WHERE household_id=? AND request_id IS NOT NULL",
      [MB_D1_HOUSEHOLD_ID]
    )
  ]);

  const transactionConflicts = findRequestIdConflicts(
    validated.payload.transactions,
    "transactionId",
    transactionRows
  );
  const tradeConflicts = findRequestIdConflicts(
    validated.payload.investmentTrades,
    "investmentTradeId",
    tradeRows
  );
  const conflicts = [
    ...transactionConflicts.map((item) => `거래 requestId ${item.requestId}`),
    ...tradeConflicts.map((item) => `투자거래 requestId ${item.requestId}`)
  ];

  if (conflicts.length > 0) {
    const sample = conflicts.slice(0, 3).join(", ");
    const suffix = conflicts.length > 3 ? ` 외 ${conflicts.length - 3}건` : "";
    throw new BackupValidationError(
      "BACKUP_REQUEST_ID_CONFLICT",
      `현재 가계부의 다른 항목과 요청 ID가 충돌합니다: ${sample}${suffix}. 복원하지 않고 기존 데이터를 먼저 확인해주세요.`
    );
  }
}

export async function mbD1PreviewBackupRestore(document, env) {
  await mbD1EnsureBenefitUsageSchema(env);
  await ensureRealEstateSchema(env);
  const validated = validateBackupDocument(document);
  await mbD1AssertBackupRequestIdCompatibility(validated, env);
  const current = await mbD1BackupCurrentIdSets(env);
  const payload = validated.payload;
  const specs = [
    ["categories", payload.categories, "categoryId"],
    ["accounts", payload.accounts, "accountId"],
    ["transactions", payload.transactions, "transactionId"],
    ["investmentHoldings", payload.investmentHoldings, "holdingId"],
    ["investmentTrades", payload.investmentTrades, "investmentTradeId"],
    ["assetSnapshots", payload.assetSnapshots, "month"],
    ["benefitRewardUsage", validated.version >= 2 ? (payload.benefitRewardUsage || []) : [], "transactionId"],
    ["realEstateAssets", validated.version >= 3 ? (payload.realEstateAssets || []) : [], "propertyId"]
  ];
  const existing = {};
  const additions = {};
  for (const [key, items, idKey] of specs) {
    const found = items.reduce((count, item) => count + (current[key].has(mbD1Text(item?.[idKey])) ? 1 : 0), 0);
    existing[key] = found;
    additions[key] = items.length - found;
  }
  return {
    mode: "merge",
    version: validated.version,
    exportedAt: validated.exportedAt,
    summary: validated.summary,
    existing,
    additions,
    warnings: validated.warnings,
    notes: [
      "같은 ID의 항목은 백업 값으로 갱신합니다.",
      "백업에 없는 현재 데이터는 삭제하지 않습니다.",
      "다른 항목이 같은 requestId를 사용 중이면 실제 복원 전에 차단합니다.",
      "복원은 전체 항목을 한 번에 반영하며, 저장 중 오류가 발생하면 복원 변경을 모두 취소합니다. 실행 전 안전백업도 보관합니다."
    ]
  };
}

export function mbD1BackupDeletedAt(item) {
  if (item?.deletedAt) return item.deletedAt;
  return item?.isDeleted ? "1970-01-01T00:00:00.000Z" : null;
}

export function mbD1BackupNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function mbD1BackupNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function mbD1BackupMemberId(name) {
  const clean = mbD1Text(name);
  if (!clean || clean === "공동") return null;
  const bytes = encoder.encode(clean);
  return "MEM_" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function mbD1RestoreBackupMerge(document, session, env) {
  await ensureClassificationSchema(env);
  const validated = validateBackupDocument(document);
  const payload = validated.payload;
  const now = mbD1Now();
  const actor = session?.name || "restore";
  await mbD1EnsureBenefitUsageSchema(env);
  await ensureRealEstateSchema(env);
  await mbD1AssertBackupRequestIdCompatibility(validated, env);

  // Keep all restore writes in one D1 batch: any failure rolls back the full merge.
  const restoreStatements = [];
  const currentMembers = await mbD1All(
    env,
    "SELECT member_id,display_name FROM members WHERE household_id=?",
    [MB_D1_HOUSEHOLD_ID]
  );
  const memberMap = new Map(currentMembers.map((row) => [mbD1Text(row.display_name), row.member_id]));
  const memberStatements = [];
  for (const name of validated.members) {
    const memberId = memberMap.get(name) || mbD1BackupMemberId(name);
    memberMap.set(name, memberId);
    memberStatements.push(env.DB.prepare(
      `INSERT INTO members (member_id,household_id,display_name,is_active,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,NULL)
       ON CONFLICT(member_id) DO UPDATE SET display_name=excluded.display_name,is_active=1,updated_at=excluded.updated_at,deleted_at=NULL`
    ).bind(memberId, MB_D1_HOUSEHOLD_ID, name, 1, now, now));
  }
  restoreStatements.push(...memberStatements);

  const ledgerStartDate = payload.bootstrap?.ledgerConfig?.ledgerStartDate || null;
  restoreStatements.push(env.DB.prepare(
    "UPDATE households SET ledger_start_date=?,updated_at=? WHERE household_id=?"
  ).bind(ledgerStartDate, now, MB_D1_HOUSEHOLD_ID));

  const categoryStatements = payload.categories.map((item) => env.DB.prepare(
    `INSERT INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(category_id) DO UPDATE SET type=excluded.type,name=excluded.name,is_active=excluded.is_active,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.categoryId, MB_D1_HOUSEHOLD_ID, item.type, item.name,
    item.storedActive === undefined ? (item.active ? 1 : 0) : (item.storedActive ? 1 : 0),
    item.createdAt || now, item.updatedAt || now, item.createdBy || actor, item.updatedBy || actor,
    mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  restoreStatements.push(...categoryStatements);

  const accountBaseStatements = payload.accounts.map((item) => env.DB.prepare(
    `INSERT INTO accounts (account_id,household_id,name,display_name,account_type,sub_type,owner_member_id,owner_label,opening_balance,billing_cutoff_day,payment_day,payment_account_id,start_year,end_year,is_active,balance_method,current_balance_override,asset_attribution,investment_cash_baseline_krw,investment_cash_baseline_at,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(account_id) DO UPDATE SET name=excluded.name,display_name=excluded.display_name,account_type=excluded.account_type,sub_type=excluded.sub_type,owner_member_id=excluded.owner_member_id,owner_label=excluded.owner_label,opening_balance=excluded.opening_balance,billing_cutoff_day=excluded.billing_cutoff_day,payment_day=excluded.payment_day,payment_account_id=NULL,start_year=excluded.start_year,end_year=excluded.end_year,is_active=excluded.is_active,balance_method=excluded.balance_method,current_balance_override=excluded.current_balance_override,asset_attribution=excluded.asset_attribution,investment_cash_baseline_krw=excluded.investment_cash_baseline_krw,investment_cash_baseline_at=excluded.investment_cash_baseline_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.accountId, MB_D1_HOUSEHOLD_ID, item.accountName || item.displayName || "", item.displayName || item.accountName || "",
    item.accountType || "", item.subType || "", memberMap.get(mbD1Text(item.owner)) || null, item.owner || null,
    mbD1BackupNumber(item.openingBalance), mbD1BackupNullableNumber(item.billingCutoffDay), mbD1BackupNullableNumber(item.paymentDay), null,
    mbD1BackupNullableNumber(item.startYear), mbD1BackupNullableNumber(item.endYear),
    item.storedActive === undefined ? (item.active ? 1 : 0) : (item.storedActive ? 1 : 0),
    item.balanceMethod || "", mbD1BackupNullableNumber(item.sheetCurrentBalance), item.assetAttribution || "",
    mbD1BackupNullableNumber(item.cashBaselineKrw), item.cashBaselineAt || item.cashBaselineAtDate || null,
    item.createdAt || now, item.updatedAt || now, item.createdBy || actor, item.updatedBy || actor,
    mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  restoreStatements.push(...accountBaseStatements);

  const accountLinkStatements = payload.accounts
    .filter((item) => item.paymentAccountId)
    .map((item) => env.DB.prepare(
      "UPDATE accounts SET payment_account_id=? WHERE household_id=? AND account_id=?"
    ).bind(item.paymentAccountId, MB_D1_HOUSEHOLD_ID, item.accountId));
  restoreStatements.push(...accountLinkStatements);

  const holdingStatements = payload.investmentHoldings.map((item) => env.DB.prepare(
    `INSERT INTO holdings (holding_id,household_id,account_id,stock_code,stock_name,market,quantity,avg_buy_price,quote_mode,manual_price,current_price,fx_rate,value_krw,book_cost_krw,return_rate,owner_label,last_updated,elapsed_days,baseline_quantity,baseline_avg_price,baseline_book_cost_krw,baseline_at,managed_by_trades,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(holding_id) DO UPDATE SET account_id=excluded.account_id,stock_code=excluded.stock_code,stock_name=excluded.stock_name,market=excluded.market,quantity=excluded.quantity,avg_buy_price=excluded.avg_buy_price,quote_mode=excluded.quote_mode,manual_price=excluded.manual_price,current_price=excluded.current_price,fx_rate=excluded.fx_rate,value_krw=excluded.value_krw,book_cost_krw=excluded.book_cost_krw,return_rate=excluded.return_rate,owner_label=excluded.owner_label,last_updated=excluded.last_updated,elapsed_days=excluded.elapsed_days,baseline_quantity=excluded.baseline_quantity,baseline_avg_price=excluded.baseline_avg_price,baseline_book_cost_krw=excluded.baseline_book_cost_krw,baseline_at=excluded.baseline_at,managed_by_trades=excluded.managed_by_trades,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.holdingId, MB_D1_HOUSEHOLD_ID, item.accountId || null, item.stockCode || "", item.stockName || "", item.market || "",
    mbD1BackupNumber(item.quantity), mbD1BackupNumber(item.avgBuyPrice), item.quoteMode || "", mbD1BackupNullableNumber(item.manualPrice),
    mbD1BackupNullableNumber(item.currentPrice), mbD1BackupNullableNumber(item.fx), mbD1BackupNullableNumber(item.valueKrw),
    mbD1BackupNullableNumber(item.bookCostKrw ?? item.costKrw), mbD1BackupNullableNumber(item.returnRate), item.owner || null,
    item.lastUpdated || null, mbD1BackupNullableNumber(item.elapsedDays), mbD1BackupNumber(item.baselineQuantity), mbD1BackupNumber(item.baselineAvgPrice),
    mbD1BackupNumber(item.baselineBookCostKrw), item.baselineAt || item.baselineAtDate || null, item.managedByTradesV22 ? 1 : 0,
    Math.max(1, Math.floor(mbD1BackupNumber(item.version, 1))), item.createdAt || now, item.updatedAt || now,
    item.createdBy || actor, item.updatedBy || actor, mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  restoreStatements.push(...holdingStatements);

  const transactionStatements = payload.transactions.map((item) => env.DB.prepare(
    `INSERT INTO transactions (transaction_id,household_id,request_id,date,type,category_id,amount,from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,version,taxpayer_member_id,tax_category_code,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row,installment_months)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(transaction_id) DO UPDATE SET installment_months=excluded.installment_months, request_id=excluded.request_id,date=excluded.date,type=excluded.type,category_id=excluded.category_id,amount=excluded.amount,from_account_id=excluded.from_account_id,to_account_id=excluded.to_account_id,payment_method_id=excluded.payment_method_id,spending_target=excluded.spending_target,spender_member_id=excluded.spender_member_id,entered_by_member_id=excluded.entered_by_member_id,description=excluded.description,memo=excluded.memo,billing_month_override=excluded.billing_month_override,billing_month=excluded.billing_month,group_id=excluded.group_id,reversal_of=NULL,version=excluded.version,taxpayer_member_id=excluded.taxpayer_member_id,tax_category_code=excluded.tax_category_code,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.transactionId, MB_D1_HOUSEHOLD_ID, item.requestId || null, item.date, item.type, item.categoryId || null, mbD1BackupNumber(item.amount),
    item.fromAccountId || null, item.toAccountId || null, item.paymentMethodId || null, item.spendingTarget || null,
    memberMap.get(mbD1Text(item.spendingTarget)) || null, memberMap.get(mbD1Text(item.createdBy)) || null,
    item.description || null, item.memo || null, item.billingOverride || null, item.billingMonth || null, item.groupId || null, null,
    Math.max(1, Math.floor(mbD1BackupNumber(item.version, 1))), item.taxpayerMemberId || null, item.taxCategoryCode || null,
    item.createdAt || now, item.updatedAt || item.createdAt || now, item.createdBy || actor, item.updatedBy || actor,
    mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null,
    // 예전 백업에는 할부 정보가 없으므로 일시불(null)로 복원됩니다.
    normalizeInstallmentMonths(item.installmentMonths).months ?? null
  ));
  restoreStatements.push(...transactionStatements);
  for (const item of payload.transactions) {
    // Old backups do not erase tags or source provenance on existing rows.
    if (item.tags !== undefined || item.categorySource !== undefined) restoreStatements.push(env.DB.prepare(
      "UPDATE transactions SET tags_json=COALESCE(?,tags_json),category_source=COALESCE(?,category_source) WHERE household_id=? AND transaction_id=?"
    ).bind(item.tags === undefined ? null : JSON.stringify(normalizeTags(item.tags)), item.categorySource || null, MB_D1_HOUSEHOLD_ID, item.transactionId));
  }
  if (payload.classificationSettings !== undefined) restoreStatements.push(classificationSettingsStatement(env, MB_D1_HOUSEHOLD_ID, normalizeRules(payload.classificationSettings.rules), now));

  const reversalStatements = payload.transactions
    .filter((item) => item.reversalOf)
    .map((item) => env.DB.prepare(
      "UPDATE transactions SET reversal_of=? WHERE household_id=? AND transaction_id=?"
    ).bind(item.reversalOf, MB_D1_HOUSEHOLD_ID, item.transactionId));
  restoreStatements.push(...reversalStatements);

  const tradeStatements = payload.investmentTrades.map((item) => env.DB.prepare(
    `INSERT INTO investment_trades (investment_trade_id,household_id,request_id,trade_date,trade_type,account_id,holding_id,stock_code,stock_name,market,quantity,unit_price,currency,fx_rate,fee_krw,tax_krw,settlement_krw,realized_pnl_krw,memo,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(investment_trade_id) DO UPDATE SET request_id=excluded.request_id,trade_date=excluded.trade_date,trade_type=excluded.trade_type,account_id=excluded.account_id,holding_id=excluded.holding_id,stock_code=excluded.stock_code,stock_name=excluded.stock_name,market=excluded.market,quantity=excluded.quantity,unit_price=excluded.unit_price,currency=excluded.currency,fx_rate=excluded.fx_rate,fee_krw=excluded.fee_krw,tax_krw=excluded.tax_krw,settlement_krw=excluded.settlement_krw,realized_pnl_krw=excluded.realized_pnl_krw,memo=excluded.memo,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.investmentTradeId, MB_D1_HOUSEHOLD_ID, item.requestId || null, item.tradeDate || item.date, item.tradeType,
    item.accountId, item.holdingId, item.stockCode || "", item.stockName || null, item.market || null,
    mbD1BackupNumber(item.quantity), mbD1BackupNumber(item.unitPrice), item.currency || null, mbD1BackupNullableNumber(item.fxRate),
    mbD1BackupNumber(item.feeKrw), mbD1BackupNumber(item.taxKrw), mbD1BackupNumber(item.settlementKrw), mbD1BackupNumber(item.realizedPnlKrw),
    item.memo || null, Math.max(1, Math.floor(mbD1BackupNumber(item.version, 1))), item.createdAt || now, item.updatedAt || item.createdAt || now,
    item.createdBy || actor, item.updatedBy || actor, mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  restoreStatements.push(...tradeStatements);

  const snapshotStatements = payload.assetSnapshots.map((item) => env.DB.prepare(
    `INSERT INTO asset_snapshots (household_id,month,assets,liabilities,net_worth,investment_value,cash_like_value,created_at,updated_at,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(household_id,month) DO UPDATE SET assets=excluded.assets,liabilities=excluded.liabilities,net_worth=excluded.net_worth,investment_value=excluded.investment_value,cash_like_value=excluded.cash_like_value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
  ).bind(
    MB_D1_HOUSEHOLD_ID, item.month, mbD1BackupNumber(item.assets), mbD1BackupNumber(item.liabilities), mbD1BackupNumber(item.netWorth),
    mbD1BackupNumber(item.investmentValue), mbD1BackupNumber(item.cashLikeValue), item.createdAt || now, item.updatedAt || now,
    item.createdBy || actor, item.updatedBy || actor
  ));
  restoreStatements.push(...snapshotStatements);

  const inputState = payload.bootstrap?.inputPreferences;
  if (inputState?.preferences) {
    restoreStatements.push(env.DB.prepare(
      `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
    ).bind(
      "PREF_INPUT_SHARED", MB_D1_HOUSEHOLD_ID, null, "input_preferences", JSON.stringify(inputState.preferences),
      Number(inputState.version) || 1, inputState.updatedAt || now, inputState.updatedAt || now
    ));
  } else if (inputState?.configured === false) {
    restoreStatements.push(env.DB.prepare(
      "DELETE FROM user_preferences WHERE household_id=? AND preference_key='input_preferences'"
    ).bind(MB_D1_HOUSEHOLD_ID));
  }

  const automationSettings = payload.bootstrap?.automationSettings;
  if (automationSettings) {
    const normalized = mbD1NormalizeAutomationSettings(automationSettings);
    mbD1ValidateAutomationSettings(normalized);
    restoreStatements.push(env.DB.prepare(
      `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
    ).bind(MB_D1_AUTOMATION_PREF_ID, MB_D1_HOUSEHOLD_ID, null, MB_D1_AUTOMATION_PREF_KEY, JSON.stringify(normalized), 1, now, now));
  }

  if (validated.version >= 2) {
    const deleteUsageStatements = payload.transactions.map((item) => env.DB.prepare(
      "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
    ).bind(MB_D1_HOUSEHOLD_ID, item.transactionId));
    restoreStatements.push(...deleteUsageStatements);

    const usageStatements = (payload.benefitRewardUsage || []).map((item) => env.DB.prepare(
      `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(transaction_id) DO UPDATE SET rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
    ).bind(
      item.transactionId, MB_D1_HOUSEHOLD_ID, item.ruleId, item.accountId, mbD1BackupNumber(item.usedAmount), item.createdAt || now, item.updatedAt || now
    ));
    restoreStatements.push(...usageStatements);
  }

  if (validated.version >= 3) {
    const realEstateStatements = (payload.realEstateAssets || []).map((item) => env.DB.prepare(
      `INSERT INTO real_estate_assets (
        property_id,household_id,name,property_type,address,lawd_code,apartment_name,exclusive_area_sqm,floor,owner_label,purchase_price_krw,
        valuation_mode,manual_value_krw,estimated_value_krw,estimate_low_krw,estimate_high_krw,estimate_trade_count,estimate_updated_at,last_trade_date,recent_trades_json,
        created_at,updated_at,created_by,updated_by,deleted_at,deleted_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(property_id) DO UPDATE SET
        name=excluded.name,property_type=excluded.property_type,address=excluded.address,lawd_code=excluded.lawd_code,apartment_name=excluded.apartment_name,
        exclusive_area_sqm=excluded.exclusive_area_sqm,floor=excluded.floor,owner_label=excluded.owner_label,purchase_price_krw=excluded.purchase_price_krw,
        valuation_mode=excluded.valuation_mode,manual_value_krw=excluded.manual_value_krw,estimated_value_krw=excluded.estimated_value_krw,
        estimate_low_krw=excluded.estimate_low_krw,estimate_high_krw=excluded.estimate_high_krw,estimate_trade_count=excluded.estimate_trade_count,
        estimate_updated_at=excluded.estimate_updated_at,last_trade_date=excluded.last_trade_date,recent_trades_json=excluded.recent_trades_json,
        updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by`
    ).bind(
      item.propertyId, MB_D1_HOUSEHOLD_ID, item.name || item.apartmentName || "아파트", item.propertyType || "아파트",
      item.address || "", item.lawdCode || "", item.apartmentName || item.name || "", mbD1BackupNumber(item.exclusiveAreaSqm),
      mbD1BackupNullableNumber(item.floor), item.owner || null, mbD1BackupNumber(item.purchasePriceKrw),
      item.valuationMode === "manual" ? "manual" : "auto", mbD1BackupNullableNumber(item.manualValueKrw),
      mbD1BackupNumber(item.estimatedValueKrw), mbD1BackupNumber(item.estimateLowKrw), mbD1BackupNumber(item.estimateHighKrw),
      Math.max(0, Math.floor(mbD1BackupNumber(item.estimateTradeCount))), item.estimateUpdatedAt || null, item.lastTradeDate || null,
      JSON.stringify(Array.isArray(item.recentTrades) ? item.recentTrades : []), item.createdAt || now, item.updatedAt || now,
      item.createdBy || actor, item.updatedBy || actor, item.deletedAt || (item.isDeleted ? "1970-01-01T00:00:00.000Z" : null), item.deletedBy || null
    ));
    restoreStatements.push(...realEstateStatements);
  }

  if (payload.userDisplayPreferences !== undefined) {
    if (!Array.isArray(payload.userDisplayPreferences)) mbD1Fail("INVALID_BACKUP", "개인 입력 설정 형식이 올바르지 않습니다.");
    for (const item of payload.userDisplayPreferences) {
      const personal = typeof item?.key === "string" && item.key.startsWith("input_preferences:") && item.key.length > "input_preferences:".length;
      if ((!personal && item?.key !== "household_overview") || !isObject(item.value)) mbD1Fail("INVALID_BACKUP", "입력 설정 항목이 올바르지 않습니다.");
      const id = personal ? `PREF_INPUT_${encodeURIComponent(item.key.slice("input_preferences:".length))}` : "PREF_HOUSEHOLD_OVERVIEW";
      restoreStatements.push(env.DB.prepare(`INSERT INTO user_preferences(preference_id,household_id,preference_key,preference_json,version,created_at,updated_at)
        VALUES (?,?,?,?,1,?,?) ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,updated_at=excluded.updated_at`)
        .bind(id, MB_D1_HOUSEHOLD_ID, item.key, JSON.stringify(item.value), now, now));
    }
  }

  // change_log.action은 created/updated/deleted/restored만 허용하므로 결과 종류는 payload에 남깁니다.
  const change = await mbD1InsertChange(env, "backup_restore", `restore-${Date.now()}`, "updated", null, session, {
    result: "merged",
    version: validated.version,
    exportedAt: validated.exportedAt,
    summary: validated.summary
  });
  restoreStatements.push(change);
  await env.DB.batch(restoreStatements);

  return {
      restored: true,
      mode: "merge",
      version: validated.version,
      exportedAt: validated.exportedAt,
      summary: validated.summary,
      warnings: validated.warnings,
      restoredAt: now,
      restoredBy: actor
  };
}
