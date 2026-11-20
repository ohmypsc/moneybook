// 조회 API 데이터(카테고리·계좌·거래·정산·자산 스냅샷·투자·변경 내역)
import { dateOnly as mbD1DateOnly, monthOnly as mbD1MonthOnly } from "../domain/date.js";
import {
  isSettlementEligibleCategory as mbD1IsSettlementEligibleCategory,
  isSettlementRequestId as mbD1IsSettlementRequestId,
  settlementRemaining as mbD1SettlementRemaining
} from "../domain/settlement.js";
import {
  buildTransactionSearchWhere,
  normalizeTransactionPagination
} from "../domain/transactionSearch.js";
import { mbD1EnsureDefaultCashbackIncomeCategory } from "./benefits.js";
import {
  MB_D1_HOUSEHOLD_ID,
  mbD1All,
  mbD1Fail,
  mbD1First,
  mbD1IsInvestmentAccount,
  mbD1NullableNumber,
  mbD1Number,
  mbD1Round,
  mbD1Text
} from "./core.js";
import { mbD1InvestmentStatusFromData, mbD1LoadFinancialData } from "./dashboard.js";
import {
  MB_D1_TRANSACTION_FROM,
  MB_D1_TRANSACTION_SELECT,
  mbD1Holdings,
  mbD1MapAccountRow,
  mbD1MapCategory,
  mbD1MapTransactionRow,
  mbD1RawAccounts,
  mbD1Trades,
  mbD1TransactionById
} from "./records.js";

export async function mbD1GetCategoriesData(env, url) {
  await mbD1EnsureDefaultCashbackIncomeCategory(env);
  const includeDeleted = ["1", "true"].includes(
    (url.searchParams.get("includeDeleted") || "").toLowerCase()
  );
  const type = mbD1Text(url.searchParams.get("type"));
  let rows = await mbD1All(
    env,
    `SELECT * FROM categories WHERE household_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"} ORDER BY CASE type WHEN '수입' THEN 1 WHEN '지출' THEN 2 WHEN '이체' THEN 3 ELSE 99 END,name`,
    [MB_D1_HOUSEHOLD_ID]
  );
  if (type) rows = rows.filter(row => row.type === type);
  const items = rows.map(mbD1MapCategory);
  return { total: items.length, items };
}

export async function mbD1GetAccountsData(env, url) {
  const includeDeleted = ["1", "true"].includes(
    (url.searchParams.get("includeDeleted") || "").toLowerCase()
  );
  const owner = mbD1Text(url.searchParams.get("owner"));
  const accountType = mbD1Text(url.searchParams.get("accountType"));
  const subType = mbD1Text(url.searchParams.get("subType"));
  const financial = await mbD1LoadFinancialData(env);
  let items = financial.accounts;
  if (!includeDeleted) items = items.filter(item => !item.isDeleted);
  if (owner) items = items.filter(item => item.owner === owner);
  if (accountType) items = items.filter(item => item.accountType === accountType);
  if (subType) items = items.filter(item => item.subType === subType);
  return { total: items.length, items };
}

export async function mbD1GetTransactionsData(env, url) {
  const includeDeleted = ["1", "true"].includes(
    (url.searchParams.get("includeDeleted") || "").toLowerCase()
  );
  const type = mbD1Text(url.searchParams.get("type"));
  const categoryId = mbD1Text(url.searchParams.get("categoryId"));
  const expenseCategory = mbD1Text(url.searchParams.get("expenseCategory"));
  const expenseTarget = mbD1Text(url.searchParams.get("expenseTarget"));
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const spendingTarget = mbD1Text(url.searchParams.get("spendingTarget"));
  const q = mbD1Text(url.searchParams.get("q")).toLowerCase();
  const amountRaw = mbD1Text(url.searchParams.get("amount"));
  const dateFrom = mbD1Text(url.searchParams.get("dateFrom"));
  const dateTo = mbD1Text(url.searchParams.get("dateTo"));

  if (dateFrom && !mbD1DateOnly(dateFrom))
    mbD1Fail("INVALID_DATE_FROM", "dateFrom은 YYYY-MM-DD 형식이어야 합니다.");
  if (dateTo && !mbD1DateOnly(dateTo))
    mbD1Fail("INVALID_DATE_TO", "dateTo는 YYYY-MM-DD 형식이어야 합니다.");
  if (dateFrom && dateTo && dateFrom > dateTo)
    mbD1Fail("INVALID_DATE_RANGE", "조회 시작일은 종료일보다 늦을 수 없습니다.");

  let amount = null;
  if (amountRaw) {
    amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0)
      mbD1Fail("INVALID_AMOUNT_FILTER", "amount는 0 이상의 숫자여야 합니다.");
  }

  const { limit, offset } = normalizeTransactionPagination(
    url.searchParams.get("limit"),
    url.searchParams.get("offset")
  );

  const { whereSql, binds } = buildTransactionSearchWhere({
    householdId: MB_D1_HOUSEHOLD_ID,
    includeDeleted,
    type,
    expenseCategory,
    expenseTarget,
    categoryId,
    accountId,
    spendingTarget,
    dateFrom,
    dateTo,
    amount,
    query: q,
    tag: mbD1Text(url.searchParams.get("tag"))
  });
  const countRow = await mbD1First(
    env,
    `SELECT COUNT(*) AS total ${MB_D1_TRANSACTION_FROM} ${whereSql}`,
    binds
  );
  const total = mbD1Number(countRow?.total, 0);

  const listBinds = [...binds];
  let pagingSql = "";
  if (limit > 0) {
    pagingSql = " LIMIT ? OFFSET ?";
    listBinds.push(limit, offset);
  }

  const rows = await mbD1All(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     ${whereSql}
     ORDER BY t.date DESC, COALESCE(t.source_row,0) DESC, t.created_at DESC${pagingSql}`,
    listBinds
  );

  return {
    total,
    items: rows.map(mbD1MapTransactionRow)
  };
}

export async function mbD1SettlementSummaryData(env, transactionId) {
  const original = await mbD1TransactionById(env, transactionId, true);
  if (!original || original.isDeleted) {
    mbD1Fail("TRANSACTION_NOT_FOUND", "정산할 거래를 찾을 수 없습니다.", 404);
  }
  if (!mbD1IsSettlementEligibleCategory(original.type, original.category, original.categoryId)) {
    mbD1Fail("SETTLEMENT_NOT_ELIGIBLE", "정산받기는 정산 가능한 지출에서만 사용할 수 있습니다.");
  }

  const rows = await mbD1All(
    env,
    `SELECT t.transaction_id,t.request_id,t.date,t.amount,t.to_account_id,t.memo,a.display_name AS to_account_name
     FROM transactions t
     LEFT JOIN accounts a ON a.account_id=t.to_account_id
     WHERE t.household_id=? AND t.reversal_of=? AND t.deleted_at IS NULL
     ORDER BY t.date ASC,t.created_at ASC`,
    [MB_D1_HOUSEHOLD_ID, transactionId]
  );
  const linkedAmounts = rows.map(row => mbD1Number(row.amount));
  const settlements = rows
    .filter(row => mbD1IsSettlementRequestId(row.request_id))
    .map(row => ({
      transactionId: mbD1Text(row.transaction_id),
      date: mbD1Text(row.date),
      amount: mbD1Number(row.amount),
      toAccountId: row.to_account_id || null,
      toAccount: mbD1Text(row.to_account_name) || null,
      memo: mbD1Text(row.memo) || null
    }));
  const settledAmount = settlements.reduce((sum, item) => sum + item.amount, 0);
  const offsetAmount = linkedAmounts.reduce((sum, value) => sum + value, 0);
  return {
    transactionId,
    originalAmount: mbD1Number(original.amount),
    settledAmount: mbD1Round(settledAmount, 2),
    otherOffsetAmount: mbD1Round(Math.max(0, offsetAmount - settledAmount), 2),
    remainingAmount: mbD1Round(mbD1SettlementRemaining(original.amount, linkedAmounts), 2),
    settlements
  };
}

/**
 * 묶음 정산에서 고를 수 있는 지출: '정산 예정'으로 표시했고 아직 다 받지 못한 지출.
 * includeTransactionId로 지정한 지출은 표시가 없어도 함께 돌려줍니다(정산받기를 연 그 지출).
 */
export async function mbD1SettlementCandidatesData(env, url) {
  const includeId = mbD1Text(url.searchParams.get("includeTransactionId"));
  const rows = await mbD1All(
    env,
    `SELECT * FROM (${MB_D1_TRANSACTION_SELECT}
       WHERE t.household_id=? AND t.deleted_at IS NULL AND t.type='지출'
         AND (COALESCE(t.settlement_expected,0)=1 OR t.transaction_id=?)
     ) WHERE amount - reversal_total > 0.0001
     ORDER BY date ASC, created_at ASC
     LIMIT 200`,
    [MB_D1_HOUSEHOLD_ID, includeId]
  );
  const items = rows.map(row => {
    const item = mbD1MapTransactionRow(row);
    return {
      ...item,
      remainingAmount: mbD1Round(
        mbD1SettlementRemaining(item.amount, [mbD1Number(row.reversal_total)]),
        2
      )
    };
  });
  return {
    total: items.length,
    remainingTotal: mbD1Round(
      items.reduce((sum, item) => sum + item.remainingAmount, 0),
      2
    ),
    items
  };
}

export async function mbD1GetAssetSnapshotsData(env, url) {
  const month = mbD1Text(url.searchParams.get("month"));
  if (month && !mbD1MonthOnly(month))
    mbD1Fail("INVALID_MONTH", "month는 YYYY-MM 형식이어야 합니다.");
  let rows = await mbD1All(
    env,
    `SELECT * FROM asset_snapshots WHERE household_id=? ${month ? "AND month=?" : ""} ORDER BY month DESC`,
    month ? [MB_D1_HOUSEHOLD_ID, month] : [MB_D1_HOUSEHOLD_ID]
  );
  const limit = Math.max(0, Math.min(120, Number(url.searchParams.get("limit")) || 0));
  if (limit) rows = rows.slice(0, limit);
  return {
    total: rows.length,
    items: rows.map(row => ({
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
    }))
  };
}

export async function mbD1GetInvestmentAccountsData(env) {
  const raw = await mbD1RawAccounts(env);
  const items = raw
    .map(mbD1MapAccountRow)
    .filter(account => account.active && !account.isDeleted && mbD1IsInvestmentAccount(account))
    .map(account => ({
      accountId: account.accountId,
      accountName: account.displayName,
      owner: account.owner,
      accountType: account.accountType,
      subType: account.subType,
      cashBaselineConfigured: Boolean(account.cashBaselineAt),
      cashBaselineKrw: account.cashBaselineKrw,
      cashBaselineAt: account.cashBaselineAt
    }));
  return { items };
}

export async function mbD1GetHoldingsData(env, url) {
  const includeDeleted = ["1", "true"].includes(
    (url.searchParams.get("includeDeleted") || "").toLowerCase()
  );
  let items = await mbD1Holdings(env, includeDeleted);
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const market = mbD1Text(url.searchParams.get("market"));
  const quoteMode = mbD1Text(url.searchParams.get("quoteMode"));
  if (accountId) items = items.filter(item => item.accountId === accountId);
  if (market) items = items.filter(item => item.market === market);
  if (quoteMode) items = items.filter(item => item.quoteMode === quoteMode);
  return { total: items.length, items };
}

export async function mbD1GetTradesData(env, url) {
  const includeDeleted = ["1", "true"].includes(
    (url.searchParams.get("includeDeleted") || "").toLowerCase()
  );
  let items = await mbD1Trades(env, includeDeleted);
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const holdingId = mbD1Text(url.searchParams.get("holdingId"));
  const tradeType = mbD1Text(url.searchParams.get("tradeType") || url.searchParams.get("type"));
  if (accountId) items = items.filter(item => item.accountId === accountId);
  if (holdingId) items = items.filter(item => item.holdingId === holdingId);
  if (tradeType) items = items.filter(item => item.tradeType === tradeType);
  return { total: items.length, items };
}

export async function mbD1GetInvestmentCashData(env, url) {
  const financial = await mbD1LoadFinancialData(env);
  return mbD1InvestmentStatusFromData(
    financial.accounts,
    financial.transactions,
    financial.trades,
    financial.holdings,
    mbD1Text(url.searchParams.get("accountId"))
  );
}

export async function mbD1GetChangesData(env, url) {
  const latestRow = await mbD1First(
    env,
    "SELECT COALESCE(MAX(change_seq),0) AS latest_seq FROM change_log WHERE household_id=?",
    [MB_D1_HOUSEHOLD_ID]
  );
  const latestSeq = Math.max(0, Math.floor(mbD1Number(latestRow?.latest_seq, 0)));
  if (url.searchParams.get("head") === "1") {
    return { latestSeq, changes: [], hasMore: false };
  }
  const recent = url.searchParams.get("recent") === "1";
  const after = Math.max(0, Math.floor(mbD1Number(url.searchParams.get("after"), 0)));
  const limit = Math.max(
    1,
    Math.min(200, Math.floor(mbD1Number(url.searchParams.get("limit") || (recent ? 20 : 100), 100)))
  );
  const rows = await mbD1All(
    env,
    `SELECT c.change_seq,c.entity_type,c.entity_id,c.action,c.entity_version,c.payload_json,c.changed_at,
            m.display_name AS changed_by
     FROM change_log c
     LEFT JOIN members m ON m.member_id=c.changed_by_member_id
     WHERE c.household_id=? AND c.change_seq>?
       ${recent ? "AND c.entity_type IN ('transaction','account','category','holding','investment_trade','real_estate','backup_restore')" : ""}
     ORDER BY c.change_seq ${recent ? "DESC" : "ASC"}
     LIMIT ?`,
    [MB_D1_HOUSEHOLD_ID, after, limit]
  );
  const changes = rows.map(row => {
    let payload = null;
    if (row.payload_json) {
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        payload = null;
      }
    }
    return {
      changeSeq: Math.max(0, Math.floor(mbD1Number(row.change_seq, 0))),
      entityType: mbD1Text(row.entity_type),
      entityId: mbD1Text(row.entity_id),
      action: mbD1Text(row.action),
      entityVersion: mbD1NullableNumber(row.entity_version),
      changedBy: mbD1Text(row.changed_by) || null,
      changedAt: row.changed_at || null,
      payload
    };
  });
  const lastSeq = changes.length ? changes[changes.length - 1].changeSeq : after;
  return {
    latestSeq,
    changes,
    hasMore: !recent && lastSeq < latestSeq
  };
}
