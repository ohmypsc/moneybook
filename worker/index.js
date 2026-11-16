import { DurableObject } from "cloudflare:workers";

import {
  clearCookie,
  createCookie,
  createSessionToken,
  getLoginUsers,
  getSession,
  isSameOrigin,
  verifyStoredPassword
} from "./auth.js";

import {
  PushError,
  deletePushSubscription,
  getPushConfig,
  notifyPartnersOfTransaction,
  notifyPartnersOfTransactions,
  savePushSubscription,
  sendTestPush
} from "./push.js";

import {
  INCOME_TAX_CODES,
  TAX_CODES,
  aggregateYearSpending,
  isSalaryCategory,
  collectReferencedCategoryIds,
  planCategoryPreset,
  summarizeSalaryIncome,
  buildRecommendations,
  computeCardDeduction,
  getTaxRules,
  isValidTaxCode
} from "./domain/yearEndTax.js";

import {
  installmentAmountForMonth,
  installmentRemainingAfter,
  normalizeInstallmentMonths
} from "./domain/installment.js";

import {
  groupBatchedPush,
  scheduleBatchedPush,
  summarizeTransactionForPush
} from "./domain/webPush.js";

import {
  dateOnly as mbD1DateOnly,
  estimateBillingMonth as mbD1EstimateBilling,
  monthOnly as mbD1MonthOnly,
  resolveBillingState as mbD1ResolveBillingState
} from "./domain/date.js";

import {
  recurringOccurrenceDate as mbD1RecurringOccurrenceDate,
  recurringPayload as mbD1RecurringPayload,
  recurringRuleActiveForMonth as mbD1RecurringRuleActiveForMonth
} from "./domain/automation.js";

import {
  netMonthStats as mbD1NetMonthStats
} from "./domain/monthStats.js";

import {
  SETTLEMENT_INCOME_CATEGORY_NAME,
  BENEFIT_INCOME_CATEGORY_NAME,
  CASHBACK_INCOME_CATEGORY_NAME,
  SETTLEMENT_REQUEST_PREFIX,
  SYSTEM_CATEGORY_IDS,
  DEFAULT_CATEGORY_IDS,
  isSettlementEligibleCategory as mbD1IsSettlementEligibleCategory,
  isSettlementRequestId as mbD1IsSettlementRequestId,
  settlementRemaining as mbD1SettlementRemaining,
  systemCategoryRole as mbD1SystemCategoryRole
} from "./domain/settlement.js";

import {
  getLoginRateLimitStatus,
  recordLoginFailureState
} from "./domain/loginRateLimit.js";

import {
  buildTransactionSearchWhere,
  normalizeTransactionPagination
} from "./domain/transactionSearch.js";

import {
  BackupValidationError,
  findRequestIdConflicts,
  validateBackupDocument
} from "./domain/backupRestore.js";

import {
  isInvestmentSymbolLookupCached,
  lookupInvestmentSymbol,
  normalizeInvestmentLookupCode,
  normalizeInvestmentSearchQuery,
  searchInvestmentSymbols
} from "./investmentSymbols.js";

import {
  chooseCategory as mbImportChooseCategory,
  choosePaymentMethod as mbImportChoosePaymentMethod,
  findDuplicateTransaction as mbImportFindDuplicate
} from "./domain/transactionImport.js";

import {
  analyzeTransactionImport
} from "./transactionImport.js";

import {
  deleteRealEstateAsset,
  ensureRealEstateSchema,
  listRealEstateAssets,
  realEstateSummary,
  refreshAllRealEstateAssets,
  refreshRealEstateAsset,
  resolveLegalRegion,
  saveRealEstateAsset
} from "./realEstate.js";

const encoder = new TextEncoder();

function jsonResponse(
  data,
  status = 200,
  extraHeaders = {}
) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers
    }
  );
}

function errorResponse(
  code,
  message,
  status
) {
  return jsonResponse(
    {
      success: false,

      error: {
        code,
        message
      }
    },
    status
  );
}

function unauthorized() {
  return jsonResponse(
    {
      success: false,
      loggedIn: false,

      error: {
        code: "LOGIN_REQUIRED",
        message: "로그인이 필요합니다."
      }
    },
    401
  );
}

function isObject(
  value
) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

async function readJsonObject(
  request,
  options = {}
) {
  if (
    options.allowEmptyBody
  ) {
    const text =
      await request.text();

    if (
      !text.trim()
    ) {
      return {};
    }

    try {
      const parsed =
        JSON.parse(
          text
        );

      return isObject(
        parsed
      )
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  try {
    const parsed =
      await request.json();

    return isObject(
      parsed
    )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function loginRateLimitKey(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function getHouseholdRealtimeStub(env) {
  if (!env.HOUSEHOLD_REALTIME) {
    return null;
  }

  const namespace = env.HOUSEHOLD_REALTIME;
  return typeof namespace.getByName === "function"
    ? namespace.getByName(MB_D1_HOUSEHOLD_ID)
    : namespace.get(namespace.idFromName(MB_D1_HOUSEHOLD_ID));
}

async function checkLoginRateLimit(request, env) {
  try {
    const stub = await getHouseholdRealtimeStub(env);
    if (!stub) return { blocked: false, retryAfterSeconds: 0 };

    const response = await stub.fetch(
      "https://moneybook-realtime.internal/auth/rate-limit/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: loginRateLimitKey(request) })
      }
    );

    if (!response.ok) return { blocked: false, retryAfterSeconds: 0 };
    return await response.json();
  } catch {
    return { blocked: false, retryAfterSeconds: 0 };
  }
}

async function updateLoginRateLimit(request, env, action) {
  try {
    const stub = await getHouseholdRealtimeStub(env);
    if (!stub) return;

    await stub.fetch(
      `https://moneybook-realtime.internal/auth/rate-limit/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: loginRateLimitKey(request) })
      }
    );
  } catch {
    // rate limit storage failure should not make the household app unavailable
  }
}

async function handleLogin(
  request,
  env,
  ctx,
  origin
) {
  if (
    !isSameOrigin(
      request
    )
  ) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403
    );
  }

  const body =
    await readJsonObject(
      request
    );

  if (
    !body
  ) {
    return errorResponse(
      "INVALID_JSON",
      "로그인 요청 형식이 올바르지 않습니다.",
      400
    );
  }

  const name =
    String(
      body.name ||
      ""
    ).trim();

  const password =
    String(
      body.password ||
      ""
    );

  if (
    !name ||
    !password ||
    name.length > 100 ||
    password.length > 500
  ) {
    return errorResponse(
      "INVALID_LOGIN",
      "이름 또는 비밀번호를 확인해주세요.",
      401
    );
  }

  const rateLimit =
    await checkLoginRateLimit(
      request,
      env
    );

  if (rateLimit.blocked) {
    return errorResponse(
      "LOGIN_RATE_LIMITED",
      "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.",
      429
    );
  }

  const users =
    getLoginUsers(
      env
    );

  const stored =
    Object.prototype
      .hasOwnProperty
      .call(
        users,
        name
      )
      ? String(
          users[name]
        )
      : "";

  if (
    !stored ||
    !(
      await verifyStoredPassword(
        password,
        stored
      )
    )
  ) {
    await updateLoginRateLimit(
      request,
      env,
      "failure"
    );

    return errorResponse(
      "INVALID_LOGIN",
      "이름 또는 비밀번호를 확인해주세요.",
      401
    );
  }

  await updateLoginRateLimit(
    request,
    env,
    "success"
  );

  const token =
    await createSessionToken(
      name,
      env
    );


  return jsonResponse(
    {
      success: true,
      loggedIn: true,

      user: {
        name
      }
    },
    200,
    {
      "Set-Cookie":
        createCookie(
          token
        )
    }
  );
}

async function handleSession(
  request,
  env,
  ctx,
  origin
) {
  const session =
    await getSession(
      request,
      env
    );

  if (
    !session
  ) {
    return unauthorized();
  }

  const token =
    await createSessionToken(
      session.name,
      env
    );


  return jsonResponse(
    {
      success: true,
      loggedIn: true,

      user: {
        name:
          session.name
      }
    },
    200,
    {
      "Set-Cookie":
        createCookie(
          token
        )
    }
  );
}

async function handleInvestmentSymbolLookup(url) {
  const code = normalizeInvestmentLookupCode(
    url.searchParams.get("code")
  );

  if (!code) {
    return errorResponse(
      "INVALID_STOCK_CODE",
      "종목코드 형식이 올바르지 않습니다.",
      400
    );
  }

  const data =
    await lookupInvestmentSymbol(code);

  return jsonResponse(
    {
      success: true,
      data
    },
    200,
    {
      "Cache-Control":
        data.found
          ? "private, max-age=86400"
          : "private, max-age=300"
    }
  );
}

async function handleInvestmentSymbolSearch(url) {
  const query = normalizeInvestmentSearchQuery(
    url.searchParams.get("q")
  );

  if (!query) {
    return jsonResponse(
      {
        success: true,
        data: {
          query: "",
          items: []
        }
      },
      200,
      {
        "Cache-Control": "private, max-age=60"
      }
    );
  }

  const data = await searchInvestmentSymbols(query);

  return jsonResponse(
    {
      success: true,
      data
    },
    200,
    {
      "Cache-Control": "private, max-age=300"
    }
  );
}

const MB_D1_HOUSEHOLD_ID = "HH_MAIN";
const MB_D1_API_VERSION = "D1-2.0";
const MB_D1_QUOTE_REFRESH_MS = 5 * 60 * 1000;
let mbD1LastQuoteRefreshAt = 0;
let mbD1QuoteRefreshPromise = null;

class MbD1Error extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MbD1Error";
    this.code = code;
    this.status = status;
  }
}

function mbD1Fail(code, message, status = 400) {
  throw new MbD1Error(code, message, status);
}

function mbD1Text(value) {
  return String(value ?? "").trim();
}

function mbD1Number(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mbD1NullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mbD1Bool(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function mbD1Round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((mbD1Number(value) + Number.EPSILON) * factor) / factor;
}

function mbD1Has(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function mbD1Id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function mbD1Now() {
  return new Date().toISOString();
}

function mbD1TimestampMs(value) {
  const text = mbD1Text(value);
  if (!text) return null;
  let parsed;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    parsed = Date.parse(text.replace(" ", "T") + "+09:00");
  } else {
    parsed = Date.parse(text);
  }
  return Number.isFinite(parsed) ? parsed : null;
}

function mbD1CurrentYearSeoul() {
  return Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric"
  }).format(new Date()));
}

function mbD1CurrentDateSeoul() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function mbD1CurrentMonthSeoul() {
  return mbD1CurrentDateSeoul().slice(0, 7);
}

function mbD1DisplayName(name, owner) {
  const cleanName = mbD1Text(name);
  const cleanOwner = mbD1Text(owner);
  return cleanOwner && cleanOwner !== "공동"
    ? `${cleanName}(${cleanOwner})`
    : cleanName;
}

function mbD1IsInvestmentAccount(account) {
  return Boolean(account) && (
    account.balanceMethod === "평가입력" ||
    account.subType === "주식" ||
    account.accountType === "투자"
  );
}

function mbD1AccountActive(row) {
  if (!row || row.deleted_at) return false;
  const year = mbD1CurrentYearSeoul();
  const start = mbD1NullableNumber(row.start_year);
  const end = mbD1NullableNumber(row.end_year);
  if (start !== null || end !== null) {
    return (start === null || year >= start) && (end === null || year <= end);
  }
  return mbD1Bool(row.is_active);
}

function mbD1Envelope(data) {
  return jsonResponse({
    success: true,
    apiVersion: MB_D1_API_VERSION,
    data
  });
}

async function mbD1All(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  const result = binds.length ? await statement.bind(...binds).all() : await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function mbD1First(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  return binds.length ? statement.bind(...binds).first() : statement.first();
}

async function mbD1MemberByName(env, name) {
  const clean = mbD1Text(name);
  if (!clean || clean === "공동") return null;
  return mbD1First(
    env,
    "SELECT member_id,display_name FROM members WHERE household_id=? AND display_name=? AND deleted_at IS NULL AND is_active=1 LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, clean]
  );
}

async function mbD1MemberIdByName(env, name) {
  const member = await mbD1MemberByName(env, name);
  return member?.member_id || null;
}

async function mbD1Members(env) {
  const rows = await mbD1All(
    env,
    "SELECT member_id,display_name FROM members WHERE household_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY display_name",
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows;
}

async function mbD1GetLedgerConfigData(env) {
  const row = await mbD1First(
    env,
    "SELECT ledger_start_date FROM households WHERE household_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID]
  );
  return { ledgerStartDate: row?.ledger_start_date || null };
}

async function mbD1ValidateLedgerDate(env, dateValue) {
  const date = mbD1DateOnly(dateValue);
  if (!date) mbD1Fail("INVALID_DATE", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const config = await mbD1GetLedgerConfigData(env);
  if (config.ledgerStartDate && date < config.ledgerStartDate) {
    mbD1Fail(
      "TRANSACTION_BEFORE_LEDGER_START",
      `가계부 시작일 ${config.ledgerStartDate}보다 이전 거래는 입력할 수 없습니다.`
    );
  }
  return date;
}

function mbD1MapCategory(row) {
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

function mbD1MapAccountRow(row) {
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

async function mbD1RawAccounts(env) {
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

function mbD1MapTransactionRow(row) {
  return {
    transactionId: mbD1Text(row.transaction_id),
    date: mbD1Text(row.date),
    type: mbD1Text(row.type),
    categoryId: row.category_id || null,
    category: mbD1Text(row.category_name),
    // 취소·환불 같은 연결 거래는 정산 대상이 아닙니다.
    settlementEligible: !row.reversal_of && mbD1IsSettlementEligibleCategory(row.type, row.category_name, row.category_id),
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

const MB_D1_TRANSACTION_FROM = `
  FROM transactions t
  LEFT JOIN categories c ON c.category_id=t.category_id
  LEFT JOIN accounts fa ON fa.account_id=t.from_account_id
  LEFT JOIN accounts ta ON ta.account_id=t.to_account_id
  LEFT JOIN accounts pm ON pm.account_id=t.payment_method_id
`;

const MB_D1_TRANSACTION_SELECT = `
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

async function mbD1AllTransactions(env, includeDeleted = false) {
  const rows = await mbD1All(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}
     ORDER BY t.date DESC, COALESCE(t.source_row,0) DESC, t.created_at DESC`,
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows.map(mbD1MapTransactionRow);
}

async function mbD1RecentExpenseTransactions(env, limit = 800) {
  const safeLimit = Math.max(1, Math.min(2000, Math.trunc(Number(limit) || 800)));
  const rows = await mbD1All(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? AND t.deleted_at IS NULL AND t.type='지출'
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ?`,
    [MB_D1_HOUSEHOLD_ID, safeLimit]
  );
  return rows.map(mbD1MapTransactionRow);
}

async function mbD1TransactionById(env, transactionId, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? AND t.transaction_id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}
     LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, transactionId]
  );
  return row ? mbD1MapTransactionRow(row) : null;
}

function mbD1MapHoldingRow(row) {
  const quantity = mbD1Number(row.quantity);
  const currentPrice = mbD1NullableNumber(row.current_price);
  const fx = mbD1NullableNumber(row.fx_rate) ?? (mbD1Text(row.market) === "국내" ? 1 : null);
  const value = mbD1NullableNumber(row.value_krw) ?? (
    currentPrice !== null && fx !== null ? quantity * currentPrice * fx : 0
  );
  const bookCost = mbD1NullableNumber(row.book_cost_krw) ?? 0;
  const returnRate = mbD1NullableNumber(row.return_rate) ?? (
    bookCost > 0 ? (value - bookCost) / bookCost : null
  );
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
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

async function mbD1Holdings(env, includeDeleted = false) {
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

function mbD1MapTradeRow(row) {
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

async function mbD1Trades(env, includeDeleted = false) {
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

function mbD1TransactionAfterBaseline(transaction, baselineAt) {
  const baselineMs = mbD1TimestampMs(baselineAt);
  if (baselineMs === null || !transaction?.date) return false;
  const baselineDate = new Date(baselineMs).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  if (transaction.date > baselineDate) return true;
  if (transaction.date < baselineDate) return false;
  const createdMs = mbD1TimestampMs(transaction.createdAt);
  return createdMs !== null && createdMs > baselineMs;
}

function mbD1InvestmentStatusFromData(accounts, transactions, trades, holdings, accountId = "") {
  const valueMap = new Map();
  for (const holding of holdings || []) {
    if (holding.isDeleted) continue;
    valueMap.set(
      holding.accountId,
      (valueMap.get(holding.accountId) || 0) + mbD1Number(holding.valueKrw)
    );
  }
  let items = (accounts || [])
    .filter((account) => !account.isDeleted && account.active && mbD1IsInvestmentAccount(account))
    .map((account) => {
      const configured = Boolean(account.cashBaselineAt);
      let ledgerDelta = 0;
      let tradeDelta = 0;
      let realized = 0;
      if (configured) {
        for (const tx of transactions || []) {
          if (tx.isDeleted || !mbD1TransactionAfterBaseline(tx, account.cashBaselineAt)) continue;
          if (tx.fromAccountId === account.accountId) ledgerDelta -= mbD1Number(tx.amount);
          if (tx.toAccountId === account.accountId) ledgerDelta += mbD1Number(tx.amount);
        }
        const baselineMs = mbD1TimestampMs(account.cashBaselineAt);
        for (const trade of trades || []) {
          if (trade.isDeleted || trade.accountId !== account.accountId) continue;
          const createdMs = mbD1TimestampMs(trade.createdAt);
          if (baselineMs !== null && createdMs !== null && createdMs < baselineMs) continue;
          tradeDelta += trade.tradeType === "매수"
            ? -mbD1Number(trade.settlementKrw)
            : mbD1Number(trade.settlementKrw);
          realized += mbD1Number(trade.realizedPnlKrw);
        }
      }
      const currentCash = configured
        ? mbD1Number(account.cashBaselineKrw) + ledgerDelta + tradeDelta
        : null;
      const holdingValue = mbD1Number(valueMap.get(account.accountId));
      return {
        accountId: account.accountId,
        accountName: account.displayName,
        owner: account.owner,
        accountType: account.accountType,
        subType: account.subType,
        cashBaselineConfigured: configured,
        cashBaselineKrw: configured ? mbD1Number(account.cashBaselineKrw) : null,
        cashBaselineAt: account.cashBaselineAt,
        ledgerCashDeltaKrw: configured ? mbD1Round(ledgerDelta, 2) : null,
        investmentTradeCashDeltaKrw: configured ? mbD1Round(tradeDelta, 2) : null,
        currentCashKrw: currentCash === null ? null : mbD1Round(currentCash, 2),
        holdingValueKrw: mbD1Round(holdingValue, 2),
        accountValueKrw: mbD1Round((currentCash === null ? 0 : currentCash) + holdingValue, 2),
        realizedPnlKrw: mbD1Round(realized, 2)
      };
    });
  if (accountId) items = items.filter((item) => item.accountId === accountId);
  return { accounts: items };
}

async function mbD1LoadFinancialData(env) {
  const rawAccounts = await mbD1RawAccounts(env);
  const accounts = rawAccounts.map(mbD1MapAccountRow);
  const transactions = await mbD1AllTransactions(env, false);
  const holdings = await mbD1Holdings(env, false);
  const trades = await mbD1Trades(env, false);
  const investment = mbD1InvestmentStatusFromData(accounts, transactions, trades, holdings);
  const balances = new Map();
  for (const account of accounts) {
    if (account.active && !account.isDeleted) balances.set(account.accountId, mbD1Number(account.openingBalance));
  }
  for (const tx of transactions) {
    if (tx.fromAccountId && balances.has(tx.fromAccountId)) {
      balances.set(tx.fromAccountId, balances.get(tx.fromAccountId) - mbD1Number(tx.amount));
    }
    if (tx.toAccountId && balances.has(tx.toAccountId)) {
      balances.set(tx.toAccountId, balances.get(tx.toAccountId) + mbD1Number(tx.amount));
    }
  }
  for (const item of investment.accounts) {
    balances.set(item.accountId, item.accountValueKrw);
  }
  for (const account of accounts) {
    account.currentBalance = balances.has(account.accountId)
      ? mbD1Round(balances.get(account.accountId), 2)
      : mbD1Number(account.sheetCurrentBalance);
    const inv = investment.accounts.find((item) => item.accountId === account.accountId);
    if (inv) {
      account.investmentCashConfigured = inv.cashBaselineConfigured;
      account.investmentCashKrw = inv.currentCashKrw ?? 0;
      account.securitiesValueKrw = inv.holdingValueKrw;
      account.realizedPnlKrw = inv.realizedPnlKrw;
    }
  }
  return { accounts, transactions, holdings, trades, investment, balances };
}

async function mbD1BuildDashboard(env, monthValue = "") {
  const month = monthValue || mbD1CurrentMonthSeoul();
  if (!mbD1MonthOnly(month)) mbD1Fail("INVALID_MONTH", "month는 YYYY-MM 형식이어야 합니다.");
  const data = await mbD1LoadFinancialData(env);
  const { accounts, transactions, holdings, trades, investment } = data;
  const realEstate = realEstateSummary(await listRealEstateAssets(env, MB_D1_HOUSEHOLD_ID, false));
  let assets = realEstate.totalValueKrw;
  let liabilities = 0;
  let investmentValue = 0;
  let cashLikeValue = 0;
  for (const account of accounts.filter((item) => item.active && !item.isDeleted)) {
    const balance = mbD1Number(account.currentBalance);
    if (account.accountType === "부채") {
      liabilities += Math.max(0, -balance);
    } else {
      assets += balance;
      if (mbD1IsInvestmentAccount(account)) investmentValue += balance;
      else cashLikeValue += balance;
    }
  }
  const stats = mbD1NetMonthStats(transactions, month);
  const transactionById = new Map(transactions.map((tx) => [tx.transactionId, tx]));
  const cards = accounts
    .filter((account) => account.active && !account.isDeleted && account.subType === "신용카드")
    .map((card) => {
      let usage = 0;
      let payments = 0;
      let installmentRemaining = 0;
      for (const tx of transactions) {
        if (tx.type === "지출" && tx.paymentMethodId === card.accountId) {
          const bill = tx.billingOverride || tx.billingMonth || mbD1EstimateBilling(
            tx.date,
            card.billingCutoffDay,
            card.paymentDay
          );
          // 할부는 첫 청구월부터 개월 수만큼 나눠 청구합니다(일시불이면 그 달 전액).
          usage += installmentAmountForMonth(tx.amount, tx.installmentMonths, bill, month);
          if (tx.installmentMonths) {
            installmentRemaining += installmentRemainingAfter(tx.amount, tx.installmentMonths, bill, month);
          }
        }
        if (tx.type === "이체" && tx.toAccountId === card.accountId) {
          const bill = tx.billingOverride || tx.billingMonth || tx.date.slice(0, 7);
          if (bill === month) payments += tx.amount;
        }
        if (tx.reversalOf) {
          const original = transactionById.get(tx.reversalOf);
          if (
            tx.toAccountId === card.accountId &&
            original &&
            original.type === "지출" &&
            original.paymentMethodId === card.accountId
          ) {
            const bill = original.billingOverride || original.billingMonth || mbD1EstimateBilling(
              original.date,
              card.billingCutoffDay,
              card.paymentDay
            );
            // 할부 거래의 취소·환불은 남은 회차에 같은 비율로 나눠 빼서 전액 취소 시 정확히 0이 되게 합니다.
            usage -= installmentAmountForMonth(tx.amount, original.installmentMonths, bill, month);
            if (original.installmentMonths) {
              installmentRemaining -= installmentRemainingAfter(tx.amount, original.installmentMonths, bill, month);
            }
          }
          if (
            tx.fromAccountId === card.accountId &&
            original &&
            original.type === "이체" &&
            original.toAccountId === card.accountId
          ) {
            const bill = original.billingOverride || original.billingMonth || original.date.slice(0, 7);
            if (bill === month) payments -= tx.amount;
          }
        }
      }
      return {
        accountId: card.accountId,
        accountName: card.displayName,
        billingMonth: month,
        usage: mbD1Round(usage, 2),
        payments: mbD1Round(payments, 2),
        estimatedRemaining: mbD1Round(usage - payments, 2),
        // 이번 청구월 이후에 남은 할부 청구액(다음 달부터 나갈 돈)
        installmentRemaining: mbD1Round(Math.max(0, installmentRemaining), 2)
      };
    });
  const trend = [];
  const [year, monthNumber] = month.split("-").map(Number);
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1 - index, 1));
    const trendMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const item = mbD1NetMonthStats(transactions, trendMonth);
    trend.push({ month: trendMonth, income: item.income, expense: item.expense, net: item.net });
  }
  const recentTransactions = transactions
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 20)
    .map((tx) => ({
      transactionId: tx.transactionId,
      date: tx.date,
      type: tx.type,
      categoryId: tx.categoryId,
      category: tx.category,
      amount: tx.amount,
      fromAccountId: tx.fromAccountId,
      fromAccount: tx.fromAccount,
      toAccountId: tx.toAccountId,
      toAccount: tx.toAccount,
      paymentMethodId: tx.paymentMethodId,
      paymentMethod: tx.paymentMethod,
      spendingTarget: tx.spendingTarget,
      description: tx.description,
      memo: tx.memo,
      reversalOf: tx.reversalOf
    }));
  const staleManual = holdings
    .filter((holding) => holding.quoteMode === "수동" && (
      holding.elapsedDays === null || holding.elapsedDays >= 7
    ))
    .map((holding) => ({
      holdingId: holding.holdingId,
      accountId: holding.accountId,
      accountName: holding.accountName,
      stockCode: holding.stockCode,
      stockName: holding.stockName,
      lastUpdated: holding.lastUpdated,
      elapsedDays: holding.elapsedDays
    }));
  return {
    backendVersion: MB_D1_API_VERSION,
    month,
    summary: {
      assets: mbD1Round(assets, 2),
      liabilities: mbD1Round(liabilities, 2),
      netWorth: mbD1Round(assets - liabilities, 2),
      investmentValue: mbD1Round(investmentValue, 2),
      cashLikeValue: mbD1Round(cashLikeValue, 2),
      realEstateValue: mbD1Round(realEstate.totalValueKrw, 2),
      realEstateCount: realEstate.count,
      monthIncome: stats.income,
      monthIncomeGross: stats.incomeGross,
      monthIncomeReversals: stats.incomeReversals,
      monthExpense: stats.expense,
      monthExpenseGross: stats.expenseGross,
      monthRefunds: stats.expenseRefunds,
      monthNetCashFlow: stats.net
    },
    accounts: accounts.filter((account) => account.active && !account.isDeleted),
    categoryExpense: stats.categoryExpense,
    spendingTargetExpense: stats.targetExpense,
    cards,
    monthlyTrend: trend,
    recentTransactions,
    realEstate,
    investments: {
      totalAccountValue: mbD1Round(investment.accounts.reduce((sum, item) => sum + item.accountValueKrw, 0), 2),
      cashTotal: mbD1Round(investment.accounts.reduce((sum, item) => sum + (item.currentCashKrw ?? 0), 0), 2),
      realizedPnlTotal: mbD1Round(trades.reduce((sum, item) => sum + item.realizedPnlKrw, 0), 2),
      accounts: investment.accounts,
      holdings,
      staleManualPrices: staleManual,
      cashBaselinePending: investment.accounts
        .filter((item) => !item.cashBaselineConfigured)
        .map((item) => ({ accountId: item.accountId, accountName: item.accountName }))
    }
  };
}


const MB_D1_AUTOMATION_PREF_ID = "PREF_AUTOMATION_SHARED";
const MB_D1_AUTOMATION_PREF_KEY = "automation_settings";

function mbD1DefaultAutomationSettings() {
  return {
    version: 1,
    recurringRules: [],
    benefitRules: []
  };
}

function mbD1AutomationId(value, prefix) {
  const clean = mbD1Text(value);
  return clean || mbD1Id(prefix);
}

function mbD1NormalizeBenefitRule(value, index = 0) {
  const source = isObject(value) ? value : {};
  const kind = ["none", "post_reward", "pre_discount"].includes(mbD1Text(source.kind))
    ? mbD1Text(source.kind)
    : "none";
  const ratePercent = Math.max(0, Math.min(100, mbD1Number(source.ratePercent, 0)));
  const monthlyCapRaw = mbD1NullableNumber(source.monthlyCap);
  const validFrom = mbD1DateOnly(source.validFrom) || null;
  const validTo = mbD1DateOnly(source.validTo) || null;
  const rewardOpeningBalance = Math.max(0, mbD1Number(source.rewardOpeningBalance, 0));
  return {
    id: mbD1AutomationId(source.id, `BEN${index + 1}`),
    accountId: mbD1Text(source.accountId),
    enabled: mbD1Bool(source.enabled),
    kind,
    ratePercent,
    monthlyCap: monthlyCapRaw === null ? null : Math.max(0, monthlyCapRaw),
    validFrom,
    validTo,
    rewardOpeningBalance
  };
}

function mbD1NormalizeRecurringRule(value, index = 0) {
  const source = isObject(value) ? value : {};
  const type = ["수입", "지출", "이체"].includes(mbD1Text(source.type))
    ? mbD1Text(source.type)
    : "지출";
  const mode = mbD1Text(source.mode) === "auto" ? "auto" : "confirm";
  const dayOfMonth = Math.max(1, Math.min(31, Math.floor(mbD1Number(source.dayOfMonth, 1))));
  const startMonth = mbD1MonthOnly(source.startMonth) || null;
  const endMonth = mbD1MonthOnly(source.endMonth) || null;
  return {
    id: mbD1AutomationId(source.id, `REC${index + 1}`),
    name: mbD1Text(source.name) || `고정 거래 ${index + 1}`,
    enabled: mbD1Bool(source.enabled),
    mode,
    dayOfMonth,
    startMonth,
    endMonth,
    type,
    amount: Math.max(0, mbD1Number(source.amount, 0)),
    categoryId: mbD1Text(source.categoryId),
    paymentMethodId: mbD1Text(source.paymentMethodId) || null,
    spendingTarget: mbD1Text(source.spendingTarget) || null,
    fromAccountId: mbD1Text(source.fromAccountId) || null,
    toAccountId: mbD1Text(source.toAccountId) || null,
    description: mbD1Text(source.description),
    memo: mbD1Text(source.memo)
  };
}

function mbD1NormalizeAutomationSettings(value) {
  const source = isObject(value) ? value : {};
  const recurringRules = Array.isArray(source.recurringRules)
    ? source.recurringRules.map((item, index) => mbD1NormalizeRecurringRule(item, index))
    : [];
  const benefitRules = Array.isArray(source.benefitRules)
    ? source.benefitRules.map((item, index) => mbD1NormalizeBenefitRule(item, index))
    : [];
  return {
    version: 1,
    recurringRules,
    benefitRules
  };
}

async function mbD1AutomationSettingsData(env) {
  const row = await mbD1First(
    env,
    "SELECT preference_json FROM user_preferences WHERE household_id=? AND preference_key=? ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, MB_D1_AUTOMATION_PREF_KEY]
  );
  if (!row?.preference_json) return mbD1DefaultAutomationSettings();
  try {
    return mbD1NormalizeAutomationSettings(JSON.parse(row.preference_json));
  } catch {
    return mbD1DefaultAutomationSettings();
  }
}

function mbD1ValidateAutomationSettings(settings) {
  const recurringIds = new Set();
  for (const rule of settings.recurringRules) {
    if (!rule.id || recurringIds.has(rule.id)) mbD1Fail("AUTOMATION_RULE_ID_DUPLICATE", "고정 거래 규칙 ID가 중복되었습니다.");
    recurringIds.add(rule.id);
    if (!rule.name) mbD1Fail("AUTOMATION_RULE_NAME_REQUIRED", "고정 거래 이름이 필요합니다.");
    if (!rule.categoryId) mbD1Fail("AUTOMATION_CATEGORY_REQUIRED", `${rule.name}의 카테고리를 선택해주세요.`);
    if (!Number.isFinite(rule.amount) || rule.amount <= 0) mbD1Fail("AUTOMATION_AMOUNT_REQUIRED", `${rule.name}의 금액을 입력해주세요.`);
    if (rule.startMonth && rule.endMonth && rule.startMonth > rule.endMonth) mbD1Fail("AUTOMATION_MONTH_RANGE_INVALID", `${rule.name}의 시작월이 종료월보다 늦습니다.`);
    if (rule.type === "지출" && (!rule.paymentMethodId || !rule.spendingTarget)) mbD1Fail("AUTOMATION_EXPENSE_FIELDS_REQUIRED", `${rule.name}의 결제수단과 지출대상을 선택해주세요.`);
    if (rule.type === "수입" && !rule.toAccountId) mbD1Fail("AUTOMATION_INCOME_ACCOUNT_REQUIRED", `${rule.name}의 입금수단을 선택해주세요.`);
    if (rule.type === "이체" && (!rule.fromAccountId || !rule.toAccountId || rule.fromAccountId === rule.toAccountId)) mbD1Fail("AUTOMATION_TRANSFER_ACCOUNT_REQUIRED", `${rule.name}의 보내는 수단과 받는 수단을 확인해주세요.`);
  }
  const benefitAccounts = new Set();
  for (const rule of settings.benefitRules) {
    if (!rule.accountId) mbD1Fail("BENEFIT_ACCOUNT_REQUIRED", "혜택을 적용할 계좌를 선택해주세요.");
    if (benefitAccounts.has(rule.accountId)) mbD1Fail("BENEFIT_ACCOUNT_DUPLICATE", "한 계좌에는 하나의 현재 혜택 규칙만 설정할 수 있습니다.");
    benefitAccounts.add(rule.accountId);
    if (rule.kind !== "none" && (!Number.isFinite(rule.ratePercent) || rule.ratePercent <= 0)) mbD1Fail("BENEFIT_RATE_REQUIRED", "혜택률은 0보다 커야 합니다.");
    if (!Number.isFinite(rule.rewardOpeningBalance) || rule.rewardOpeningBalance < 0) mbD1Fail("BENEFIT_OPENING_BALANCE_INVALID", "시작 잔액 중 캐시백은 0원 이상이어야 합니다.");
    if (rule.validFrom && rule.validTo && rule.validFrom > rule.validTo) mbD1Fail("BENEFIT_DATE_RANGE_INVALID", "혜택 적용 시작일이 종료일보다 늦습니다.");
  }
}

async function mbD1HandleAutomationSettings(body, session, env) {
  if (!isObject(body.settings)) mbD1Fail("INVALID_AUTOMATION_SETTINGS", "자동화 설정 형식이 올바르지 않습니다.");
  const settings = mbD1NormalizeAutomationSettings(body.settings);
  mbD1ValidateAutomationSettings(settings);
  const now = mbD1Now();
  const update = env.DB.prepare(
    `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
  ).bind(
    MB_D1_AUTOMATION_PREF_ID,
    MB_D1_HOUSEHOLD_ID,
    null,
    MB_D1_AUTOMATION_PREF_KEY,
    JSON.stringify(settings),
    1,
    now,
    now
  );
  const change = await mbD1InsertChange(env, "automation_settings", "shared", "updated", 1, session);
  await env.DB.batch([update, change]);
  return { settings, updatedAt: now, updatedBy: session.name };
}

function mbD1BenefitRuleIsActive(rule, date) {
  if (!rule || !rule.enabled || rule.kind === "none" || rule.ratePercent <= 0) return false;
  if (rule.validFrom && date < rule.validFrom) return false;
  if (rule.validTo && date > rule.validTo) return false;
  return true;
}

async function mbD1EnsureSystemCategory(env, { categoryId, type, name }) {
  let row = await mbD1First(
    env,
    `SELECT category_id,name,is_active,deleted_at,type
     FROM categories
     WHERE household_id=?
       AND (category_id=? OR (type=? AND name=?))
     ORDER BY
       CASE WHEN type=? AND name=? AND deleted_at IS NULL AND is_active=1 THEN 0
            WHEN type=? AND name=? THEN 1
            WHEN category_id=? THEN 2
            ELSE 3 END,
       updated_at DESC
     LIMIT 1`,
    [
      MB_D1_HOUSEHOLD_ID,
      categoryId,
      type,
      name,
      type,
      name,
      type,
      name,
      categoryId
    ]
  );

  const now = mbD1Now();
  if (row?.category_id) {
    const needsRepair = row.type !== type || row.name !== name || row.deleted_at || !mbD1Bool(row.is_active);
    if (needsRepair) {
      await env.DB.prepare(
        `UPDATE categories
         SET type=?,name=?,is_active=1,deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?
         WHERE household_id=? AND category_id=?`
      ).bind(type, name, now, "system", MB_D1_HOUSEHOLD_ID, row.category_id).run();
      return { ...row, type, name, is_active: 1, deleted_at: null };
    }
    return row;
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
  ).bind(
    categoryId,
    MB_D1_HOUSEHOLD_ID,
    type,
    name,
    1,
    now,
    now,
    "system",
    "system",
    null,
    null
  ).run();

  row = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND category_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, categoryId]
  );
  if (!row?.category_id) mbD1Fail("SYSTEM_CATEGORY_CREATE_FAILED", `${name} 카테고리를 준비하지 못했습니다.`, 500);
  return row;
}

async function mbD1EnsureDefaultCashbackIncomeCategory(env) {
  const categoryId = DEFAULT_CATEGORY_IDS.cashbackIncome;

  // 고정 ID가 한 번이라도 만들어졌다면 이후 이름 변경/삭제는 사용자의 선택으로 존중한다.
  const byId = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND category_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, categoryId]
  );
  if (byId?.category_id) return byId;

  // 기존에 사용자가 만든 '캐시백' 카테고리가 있거나 삭제 이력이 있으면 중복 생성하지 않는다.
  const existing = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND type='수입' AND name=? ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, CASHBACK_INCOME_CATEGORY_NAME]
  );
  if (existing?.category_id) return existing;

  const now = mbD1Now();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
  ).bind(
    categoryId,
    MB_D1_HOUSEHOLD_ID,
    "수입",
    CASHBACK_INCOME_CATEGORY_NAME,
    1,
    now,
    now,
    "system-default",
    "system-default",
    null,
    null
  ).run();

  return mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND category_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, categoryId]
  );
}


async function mbD1SettlementIncomeCategory(env) {
  return mbD1EnsureSystemCategory(env, {
    categoryId: SYSTEM_CATEGORY_IDS.settlementIncome,
    type: "수입",
    name: SETTLEMENT_INCOME_CATEGORY_NAME
  });
}

async function mbD1BenefitCategory(env) {
  return mbD1EnsureSystemCategory(env, {
    categoryId: SYSTEM_CATEGORY_IDS.benefitIncome,
    type: "수입",
    name: BENEFIT_INCOME_CATEGORY_NAME
  });
}

let mbD1BenefitUsageSchemaReady = false;
let mbD1BenefitUsageSchemaPromise = null;

async function mbD1EnsureBenefitUsageSchema(env) {
  if (mbD1BenefitUsageSchemaReady) return;
  if (!mbD1BenefitUsageSchemaPromise) {
    mbD1BenefitUsageSchemaPromise = env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS benefit_reward_usage (
          transaction_id TEXT PRIMARY KEY,
          household_id TEXT NOT NULL,
          rule_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          used_amount REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      ),
      env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_benefit_reward_usage_household_rule ON benefit_reward_usage(household_id, rule_id, account_id)"
      )
    ])
      .then(() => {
        mbD1BenefitUsageSchemaReady = true;
      })
      .catch((error) => {
        mbD1BenefitUsageSchemaPromise = null;
        throw error;
      });
  }
  await mbD1BenefitUsageSchemaPromise;
}

async function mbD1BenefitRewardUsageRecord(env, transactionId) {
  await mbD1EnsureBenefitUsageSchema(env);
  return mbD1First(
    env,
    `SELECT transaction_id,rule_id,account_id,used_amount
     FROM benefit_reward_usage
     WHERE household_id=? AND transaction_id=? LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, transactionId]
  );
}

async function mbD1BenefitRewardBalance(env, rule, excludeTransactionId = "", excludeBenefitRequestId = "") {
  await mbD1EnsureBenefitUsageSchema(env);
  const earnedSql = `SELECT COALESCE(SUM(amount),0) AS earned
                     FROM transactions
                     WHERE household_id=? AND type='수입' AND to_account_id=?
                       AND request_id LIKE ? AND deleted_at IS NULL
                       ${excludeBenefitRequestId ? "AND request_id<>?" : ""}`;
  const earnedBinds = [MB_D1_HOUSEHOLD_ID, rule.accountId, `BENEFIT_${rule.id}_%`];
  if (excludeBenefitRequestId) earnedBinds.push(excludeBenefitRequestId);
  const earnedRow = await mbD1First(env, earnedSql, earnedBinds);
  const usedSql = `SELECT COALESCE(SUM(u.used_amount),0) AS used
                   FROM benefit_reward_usage u
                   JOIN transactions t
                     ON t.transaction_id=u.transaction_id
                    AND t.household_id=u.household_id
                   WHERE u.household_id=? AND u.rule_id=? AND u.account_id=?
                     AND t.deleted_at IS NULL
                     ${excludeTransactionId ? "AND u.transaction_id<>?" : ""}`;
  const usedBinds = [MB_D1_HOUSEHOLD_ID, rule.id, rule.accountId];
  if (excludeTransactionId) usedBinds.push(excludeTransactionId);
  const usedRow = await mbD1First(env, usedSql, usedBinds);
  const opening = Math.max(0, mbD1Number(rule.rewardOpeningBalance, 0));
  const earned = Math.max(0, mbD1Number(earnedRow?.earned, 0));
  const used = Math.max(0, mbD1Number(usedRow?.used, 0));
  return Math.max(0, Math.floor(opening + earned - used + 1e-9));
}


async function mbD1BenefitRewardBalancesData(env) {
  const settings = await mbD1AutomationSettingsData(env);
  const rules = settings.benefitRules.filter((rule) => rule.accountId && (rule.kind === "post_reward" || rule.rewardOpeningBalance > 0));
  return Promise.all(
    rules.map(async (rule) => ({
      ruleId: rule.id,
      accountId: rule.accountId,
      rewardBalance: await mbD1BenefitRewardBalance(env, rule)
    }))
  );
}

async function mbD1BenefitUsedThisMonth(env, rule, date, excludeRequestId = "") {
  if (rule.monthlyCap === null) return 0;
  const month = date.slice(0, 7);
  const sql = `SELECT COALESCE(SUM(amount),0) AS used
               FROM transactions
               WHERE household_id=? AND type='수입' AND date>=? AND date<?
                 AND request_id LIKE ? AND deleted_at IS NULL
                 ${excludeRequestId ? "AND request_id<>?" : ""}`;
  const binds = [MB_D1_HOUSEHOLD_ID, `${month}-01`, `${month}-32`, `BENEFIT_${rule.id}_%`];
  if (excludeRequestId) binds.push(excludeRequestId);
  const row = await mbD1First(env, sql, binds);
  return Math.max(0, mbD1Number(row?.used, 0));
}

async function mbD1CalculateBenefit(env, rule, baseAmount, date, excludeRequestId = "") {
  if (!mbD1BenefitRuleIsActive(rule, date)) return 0;
  const gross = Math.max(0, Math.floor((mbD1Number(baseAmount) * rule.ratePercent) / 100 + 1e-9));
  if (gross <= 0) return 0;
  if (rule.monthlyCap === null) return gross;
  const used = await mbD1BenefitUsedThisMonth(env, rule, date, excludeRequestId);
  return Math.max(0, Math.min(gross, Math.floor(rule.monthlyCap - used)));
}

async function mbD1PrepareBenefit(env, body, options = {}) {
  const ruleId = mbD1Text(body.benefitRuleId);
  if (!ruleId) return null;
  const settings = await mbD1AutomationSettingsData(env);
  const rule = settings.benefitRules.find((item) => item.id === ruleId);
  if (!rule) mbD1Fail("BENEFIT_RULE_NOT_FOUND", "선택한 혜택 규칙을 찾을 수 없습니다.");
  const date = mbD1DateOnly(body.date);
  if (!date || !mbD1BenefitRuleIsActive(rule, date)) return null;
  const type = mbD1Text(body.type);

  if (type === "지출") {
    if (rule.kind !== "post_reward" || mbD1Text(body.paymentMethodId) !== rule.accountId) return null;
    const faceAmount = Math.max(0, mbD1Number(body.amount));
    const rewardBalanceBefore = await mbD1BenefitRewardBalance(env, rule);
    const maxRewardUsable = Math.max(0, Math.min(faceAmount, rewardBalanceBefore));
    const requestedRewardUse = Math.max(0, Math.floor(mbD1Number(body.benefitRewardUsedAmount, 0)));
    if (options.strictRewardUsage && requestedRewardUse > maxRewardUsable) {
      mbD1Fail(
        "BENEFIT_REWARD_USAGE_EXCEEDS_BALANCE",
        `사용 가능한 캐시백은 ${Math.round(maxRewardUsable).toLocaleString("ko-KR")}원입니다.`
      );
    }
    const rewardUsedAmount = Math.min(requestedRewardUse, maxRewardUsable);
    const eligibleAmount = Math.max(0, faceAmount - rewardUsedAmount);
    const accrualEnabled = body.benefitAccrualEnabled !== false;
    const benefitAmount = accrualEnabled
      ? await mbD1CalculateBenefit(env, rule, eligibleAmount, date)
      : 0;
    return {
      rule,
      kind: rule.kind,
      faceAmount,
      actualAmount: faceAmount,
      eligibleAmount,
      benefitAmount,
      accountId: rule.accountId,
      creditAccountId: rule.accountId,
      rewardBalanceBefore,
      rewardUsedAmount,
      rewardBalanceAfter: Math.max(0, rewardBalanceBefore - rewardUsedAmount + benefitAmount),
      maxRewardUsable
    };
  }

  if (type === "이체") {
    if (rule.kind !== "pre_discount" || mbD1Text(body.toAccountId) !== rule.accountId) return null;
    const category = await mbD1CategoryById(env, mbD1Text(body.categoryId), false);
    if (!category || category.name !== "지역화폐충전") return null;
    const faceAmount = Math.max(0, mbD1Number(body.benefitFaceAmount || body.amount));
    const benefitAmount = await mbD1CalculateBenefit(env, rule, faceAmount, date);
    return {
      rule,
      kind: rule.kind,
      faceAmount,
      actualAmount: Math.max(0, faceAmount - benefitAmount),
      eligibleAmount: faceAmount,
      benefitAmount,
      accountId: rule.accountId,
      creditAccountId: mbD1Text(body.fromAccountId),
      rewardBalanceBefore: 0,
      rewardUsedAmount: 0,
      rewardBalanceAfter: 0,
      maxRewardUsable: 0
    };
  }

  return null;
}

async function mbD1PreviewBenefit(env, body) {
  const benefit = await mbD1PrepareBenefit(env, body);
  if (!benefit) return null;
  return {
    kind: benefit.kind,
    ratePercent: benefit.rule.ratePercent,
    benefitAmount: benefit.benefitAmount,
    faceAmount: benefit.faceAmount,
    actualAmount: benefit.actualAmount,
    eligibleAmount: benefit.eligibleAmount,
    rewardBalanceBefore: benefit.rewardBalanceBefore,
    rewardUsedAmount: benefit.rewardUsedAmount,
    rewardBalanceAfter: benefit.rewardBalanceAfter,
    maxRewardUsable: benefit.maxRewardUsable
  };
}

async function mbD1RecurringAlreadyCreated(env, ruleId, month) {
  const requestId = `RECUR_${ruleId}_${month}`;
  const row = await mbD1First(
    env,
    "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, requestId]
  );
  return Boolean(row?.transaction_id);
}

async function mbD1CreateRecurringOccurrence(env, session, rule, month) {
  const date = mbD1RecurringOccurrenceDate(rule, month);
  if (!date) mbD1Fail("RECURRING_MONTH_INVALID", "고정 거래 대상 월이 올바르지 않습니다.");
  const requestId = `RECUR_${rule.id}_${month}`;
  let result;
  try {
    result = await mbD1HandleTransactionMutation(
      "/api/transactions",
      mbD1RecurringPayload(rule, date, requestId),
      session,
      env
    );
  } catch (error) {
    const duplicate = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (!duplicate?.transaction_id) throw error;
    result = { transactionId: duplicate.transaction_id };
  }
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    transactionId: result.transactionId,
    month,
    date
  };
}

async function mbD1ProcessRecurring(env, session, options = {}) {
  const settings = await mbD1AutomationSettingsData(env);
  const month = mbD1MonthOnly(options.month) || mbD1CurrentMonthSeoul();
  const today = mbD1CurrentDateSeoul();
  const created = [];
  const due = [];
  for (const rule of settings.recurringRules) {
    if (!mbD1RecurringRuleActiveForMonth(rule, month)) continue;
    const date = mbD1RecurringOccurrenceDate(rule, month);
    let alreadyCreated = await mbD1RecurringAlreadyCreated(env, rule.id, month);
    const isDue = month < today.slice(0, 7) || (month === today.slice(0, 7) && date <= today);
    const requestedRuleId = mbD1Text(options.ruleId);
    const shouldCreate = requestedRuleId
      ? requestedRuleId === rule.id
      : rule.mode === "auto" && isDue;
    if (!alreadyCreated && shouldCreate) {
      created.push(await mbD1CreateRecurringOccurrence(env, session, rule, month));
      alreadyCreated = true;
    }
    due.push({
      ruleId: rule.id,
      ruleName: rule.name,
      month,
      date,
      alreadyCreated,
      enabled: rule.enabled,
      mode: rule.mode
    });
  }
  return { created, due };
}

async function mbD1InputPreferencesData(env) {
  const row = await mbD1First(
    env,
    "SELECT preference_json,version,updated_at FROM user_preferences WHERE household_id=? AND preference_key='input_preferences' ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID]
  );
  if (!row) {
    return { configured: false, version: 1, preferences: null, updatedAt: null, updatedBy: null };
  }
  let preferences = null;
  try {
    preferences = JSON.parse(row.preference_json || "null");
  } catch {
    mbD1Fail("INPUT_PREFERENCES_CORRUPT", "저장된 입력 설정 형식을 읽을 수 없습니다.", 500);
  }
  return {
    configured: true,
    version: mbD1Number(row.version, 1),
    preferences,
    updatedAt: row.updated_at || null,
    updatedBy: null
  };
}

async function mbD1BuildBootstrap(env) {
  await mbD1EnsureDefaultCashbackIncomeCategory(env);
  const [members, rawAccounts, categoryRows, ledgerConfig, inputPreferences, automationSettings] = await Promise.all([
    mbD1Members(env),
    mbD1RawAccounts(env),
    mbD1All(
      env,
      "SELECT * FROM categories WHERE household_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY CASE type WHEN '수입' THEN 1 WHEN '지출' THEN 2 WHEN '이체' THEN 3 ELSE 99 END,name",
      [MB_D1_HOUSEHOLD_ID]
    ),
    mbD1GetLedgerConfigData(env),
    mbD1InputPreferencesData(env),
    mbD1AutomationSettingsData(env)
  ]);
  const accounts = rawAccounts.map(mbD1MapAccountRow).filter((account) => account.active && !account.isDeleted);
  const categories = categoryRows.map(mbD1MapCategory);
  const memberNames = members.map((member) => mbD1Text(member.display_name)).filter(Boolean);
  return {
    backendVersion: MB_D1_API_VERSION,
    transactionTypes: ["수입", "지출", "이체"],
    investmentTradeTypes: ["매수", "매도"],
    members: memberNames,
    spendingTargets: [...memberNames, "공동"],
    accounts,
    categories,
    investmentAccounts: accounts
      .filter(mbD1IsInvestmentAccount)
      .map((account) => ({
        accountId: account.accountId,
        accountName: account.displayName,
        owner: account.owner,
        accountType: account.accountType,
        subType: account.subType,
        cashBaselineConfigured: Boolean(account.cashBaselineAt),
        cashBaselineKrw: account.cashBaselineKrw,
        cashBaselineAt: account.cashBaselineAt
      })),
    ledgerConfig,
    inputPreferences,
    automationSettings
  };
}

async function mbD1GetCategoriesData(env, url) {
  await mbD1EnsureDefaultCashbackIncomeCategory(env);
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  const type = mbD1Text(url.searchParams.get("type"));
  let rows = await mbD1All(
    env,
    `SELECT * FROM categories WHERE household_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"} ORDER BY CASE type WHEN '수입' THEN 1 WHEN '지출' THEN 2 WHEN '이체' THEN 3 ELSE 99 END,name`,
    [MB_D1_HOUSEHOLD_ID]
  );
  if (type) rows = rows.filter((row) => row.type === type);
  const items = rows.map(mbD1MapCategory);
  return { total: items.length, items };
}

async function mbD1GetAccountsData(env, url) {
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  const owner = mbD1Text(url.searchParams.get("owner"));
  const accountType = mbD1Text(url.searchParams.get("accountType"));
  const subType = mbD1Text(url.searchParams.get("subType"));
  const financial = await mbD1LoadFinancialData(env);
  let items = financial.accounts;
  if (!includeDeleted) items = items.filter((item) => !item.isDeleted);
  if (owner) items = items.filter((item) => item.owner === owner);
  if (accountType) items = items.filter((item) => item.accountType === accountType);
  if (subType) items = items.filter((item) => item.subType === subType);
  return { total: items.length, items };
}

async function mbD1GetTransactionsData(env, url) {
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  const type = mbD1Text(url.searchParams.get("type"));
  const categoryId = mbD1Text(url.searchParams.get("categoryId"));
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const spendingTarget = mbD1Text(url.searchParams.get("spendingTarget"));
  const q = mbD1Text(url.searchParams.get("q")).toLowerCase();
  const amountRaw = mbD1Text(url.searchParams.get("amount"));
  const dateFrom = mbD1Text(url.searchParams.get("dateFrom"));
  const dateTo = mbD1Text(url.searchParams.get("dateTo"));

  if (dateFrom && !mbD1DateOnly(dateFrom)) mbD1Fail("INVALID_DATE_FROM", "dateFrom은 YYYY-MM-DD 형식이어야 합니다.");
  if (dateTo && !mbD1DateOnly(dateTo)) mbD1Fail("INVALID_DATE_TO", "dateTo는 YYYY-MM-DD 형식이어야 합니다.");
  if (dateFrom && dateTo && dateFrom > dateTo) mbD1Fail("INVALID_DATE_RANGE", "조회 시작일은 종료일보다 늦을 수 없습니다.");

  let amount = null;
  if (amountRaw) {
    amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0) mbD1Fail("INVALID_AMOUNT_FILTER", "amount는 0 이상의 숫자여야 합니다.");
  }

  const { limit, offset } = normalizeTransactionPagination(
    url.searchParams.get("limit"),
    url.searchParams.get("offset")
  );

  const { whereSql, binds } = buildTransactionSearchWhere({
    householdId: MB_D1_HOUSEHOLD_ID,
    includeDeleted,
    type,
    categoryId,
    accountId,
    spendingTarget,
    dateFrom,
    dateTo,
    amount,
    query: q
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

async function mbD1SettlementSummaryData(env, transactionId) {
  const original = await mbD1TransactionById(env, transactionId, true);
  if (!original || original.isDeleted) {
    mbD1Fail("TRANSACTION_NOT_FOUND", "정산할 거래를 찾을 수 없습니다.", 404);
  }
  if (original.reversalOf || !mbD1IsSettlementEligibleCategory(original.type, original.category, original.categoryId)) {
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
  const linkedAmounts = rows.map((row) => mbD1Number(row.amount));
  const settlements = rows
    .filter((row) => mbD1IsSettlementRequestId(row.request_id))
    .map((row) => ({
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

async function mbD1GetAssetSnapshotsData(env, url) {
  const month = mbD1Text(url.searchParams.get("month"));
  if (month && !mbD1MonthOnly(month)) mbD1Fail("INVALID_MONTH", "month는 YYYY-MM 형식이어야 합니다.");
  let rows = await mbD1All(
    env,
    `SELECT * FROM asset_snapshots WHERE household_id=? ${month ? "AND month=?" : ""} ORDER BY month DESC`,
    month ? [MB_D1_HOUSEHOLD_ID, month] : [MB_D1_HOUSEHOLD_ID]
  );
  const limit = Math.max(0, Math.min(120, Number(url.searchParams.get("limit")) || 0));
  if (limit) rows = rows.slice(0, limit);
  return {
    total: rows.length,
    items: rows.map((row) => ({
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

async function mbD1GetInvestmentAccountsData(env) {
  const raw = await mbD1RawAccounts(env);
  const items = raw.map(mbD1MapAccountRow)
    .filter((account) => account.active && !account.isDeleted && mbD1IsInvestmentAccount(account))
    .map((account) => ({
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

async function mbD1GetHoldingsData(env, url) {
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  let items = await mbD1Holdings(env, includeDeleted);
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const market = mbD1Text(url.searchParams.get("market"));
  const quoteMode = mbD1Text(url.searchParams.get("quoteMode"));
  if (accountId) items = items.filter((item) => item.accountId === accountId);
  if (market) items = items.filter((item) => item.market === market);
  if (quoteMode) items = items.filter((item) => item.quoteMode === quoteMode);
  return { total: items.length, items };
}

async function mbD1GetTradesData(env, url) {
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  let items = await mbD1Trades(env, includeDeleted);
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const holdingId = mbD1Text(url.searchParams.get("holdingId"));
  const tradeType = mbD1Text(url.searchParams.get("tradeType") || url.searchParams.get("type"));
  if (accountId) items = items.filter((item) => item.accountId === accountId);
  if (holdingId) items = items.filter((item) => item.holdingId === holdingId);
  if (tradeType) items = items.filter((item) => item.tradeType === tradeType);
  return { total: items.length, items };
}

async function mbD1GetInvestmentCashData(env, url) {
  const financial = await mbD1LoadFinancialData(env);
  return mbD1InvestmentStatusFromData(
    financial.accounts,
    financial.transactions,
    financial.trades,
    financial.holdings,
    mbD1Text(url.searchParams.get("accountId"))
  );
}

async function mbD1CategoryById(env, id, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `SELECT * FROM categories WHERE household_id=? AND category_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"} LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, id]
  );
  return row ? mbD1MapCategory(row) : null;
}

async function mbD1AccountById(env, id, includeDeleted = true) {
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

async function mbD1BuildTransactionModel(env, payload, current = null, forCreate = false) {
  const source = current || {};
  const dateInput = mbD1Has(payload, "date") ? payload.date : source.date;
  const date = forCreate
    ? await mbD1ValidateLedgerDate(env, dateInput)
    : mbD1DateOnly(dateInput);
  if (!date) mbD1Fail("INVALID_DATE", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  if (!forCreate && mbD1Has(payload, "date")) await mbD1ValidateLedgerDate(env, date);
  const type = mbD1Text(mbD1Has(payload, "type") ? payload.type : source.type);
  if (!["수입", "지출", "이체"].includes(type)) mbD1Fail("INVALID_TYPE", "유형은 수입, 지출, 이체 중 하나여야 합니다.");
  const amount = Number(mbD1Has(payload, "amount") ? payload.amount : source.amount);
  if (!Number.isFinite(amount) || amount <= 0) mbD1Fail("INVALID_NUMBER", "금액은 0보다 큰 숫자여야 합니다.");
  const categoryId = mbD1Text(mbD1Has(payload, "categoryId") ? payload.categoryId : source.categoryId);
  const keepsExistingCategory = !forCreate && categoryId === mbD1Text(source.categoryId);
  const category = await mbD1CategoryById(env, categoryId, keepsExistingCategory);
  if (!category || ((!category.active || category.isDeleted) && !keepsExistingCategory)) {
    mbD1Fail("CATEGORY_NOT_FOUND", "사용 가능한 카테고리를 찾을 수 없습니다.");
  }
  if (category.type !== type) mbD1Fail("CATEGORY_TYPE_MISMATCH", `선택한 카테고리는 \"${category.type}\" 유형입니다.`);

  const rawAccounts = await mbD1RawAccounts(env);
  const accounts = rawAccounts.map(mbD1MapAccountRow);
  const accountMap = new Map(accounts.map((account) => [account.accountId, account]));
  const keepsExistingType = !forCreate && type === mbD1Text(source.type);

  function resolveTransactionAccount(id, existingIds, code, message) {
    const account = accountMap.get(id);
    const keepsExistingAccount = !forCreate && existingIds.some((existingId) => mbD1Text(existingId) === id);
    if (!account || ((!account.active || account.isDeleted) && !keepsExistingAccount)) {
      mbD1Fail(code, message);
    }
    return account;
  }
  let fromAccount = null;
  let toAccount = null;
  let paymentMethod = null;
  let spendingTarget = "";
  if (type === "수입") {
    const toId = mbD1Text(mbD1Has(payload, "toAccountId") ? payload.toAccountId : source.toAccountId);
    if (!toId) mbD1Fail("INCOME_TO_REQUIRED", "수입 거래에는 입금수단이 필요합니다.");
    toAccount = resolveTransactionAccount(
      toId,
      keepsExistingType ? [source.toAccountId] : [],
      "TO_ACCOUNT_NOT_FOUND",
      "입금수단을 찾을 수 없습니다."
    );
    if (mbD1Has(payload, "fromAccountId") && mbD1Text(payload.fromAccountId)) mbD1Fail("INCOME_FROM_NOT_ALLOWED", "수입 거래에는 출금수단을 사용할 수 없습니다.");
    if (mbD1Has(payload, "paymentMethodId") && mbD1Text(payload.paymentMethodId)) mbD1Fail("INCOME_PAYMENT_NOT_ALLOWED", "수입 거래에는 결제수단을 사용할 수 없습니다.");
  }
  if (type === "지출") {
    const paymentId = mbD1Text(
      mbD1Has(payload, "paymentMethodId")
        ? payload.paymentMethodId
        : (source.paymentMethodId || source.fromAccountId)
    );
    if (!paymentId) mbD1Fail("PAYMENT_METHOD_REQUIRED", "지출 거래에는 결제수단이 필요합니다.");
    paymentMethod = resolveTransactionAccount(
      paymentId,
      keepsExistingType ? [source.paymentMethodId, source.fromAccountId] : [],
      "PAYMENT_METHOD_NOT_FOUND",
      "결제수단을 찾을 수 없습니다."
    );
    spendingTarget = mbD1Text(mbD1Has(payload, "spendingTarget") ? payload.spendingTarget : source.spendingTarget);
    if (!spendingTarget) mbD1Fail("SPENDING_TARGET_REQUIRED", "지출 거래에는 지출대상이 필요합니다.");
    if (spendingTarget !== "공동") {
      const member = await mbD1MemberByName(env, spendingTarget);
      if (!member) mbD1Fail("INVALID_SPENDING_TARGET", "사용할 수 없는 지출대상입니다.");
    }
    if (paymentMethod.subType === "체크카드") {
      const keepsExistingPaymentMethod = keepsExistingType && paymentId === mbD1Text(source.paymentMethodId || source.fromAccountId);
      const paymentAccountId = keepsExistingPaymentMethod && source.fromAccountId
        ? mbD1Text(source.fromAccountId)
        : mbD1Text(paymentMethod.paymentAccountId);
      if (!paymentAccountId) mbD1Fail("CHECK_CARD_ACCOUNT_MISSING", `${paymentMethod.displayName}의 결제계좌가 설정되어 있지 않습니다.`);
      fromAccount = resolveTransactionAccount(
        paymentAccountId,
        keepsExistingPaymentMethod ? [source.fromAccountId] : [],
        "CHECK_CARD_ACCOUNT_NOT_FOUND",
        `${paymentMethod.displayName}의 연결 통장을 찾을 수 없습니다.`
      );
    } else {
      fromAccount = paymentMethod;
    }
    if (mbD1Has(payload, "toAccountId") && mbD1Text(payload.toAccountId)) mbD1Fail("EXPENSE_TO_NOT_ALLOWED", "지출 거래에는 입금수단을 사용할 수 없습니다.");
  }
  if (type === "이체") {
    const fromId = mbD1Text(mbD1Has(payload, "fromAccountId") ? payload.fromAccountId : source.fromAccountId);
    const toId = mbD1Text(mbD1Has(payload, "toAccountId") ? payload.toAccountId : source.toAccountId);
    if (!fromId || !toId) mbD1Fail("TRANSFER_ACCOUNT_REQUIRED", "이체에는 보내는 수단과 받는 수단이 모두 필요합니다.");
    if (fromId === toId) mbD1Fail("SAME_TRANSFER_ACCOUNT", "이체의 보내는 수단과 받는 수단은 같을 수 없습니다.");
    fromAccount = resolveTransactionAccount(
      fromId,
      keepsExistingType ? [source.fromAccountId] : [],
      "FROM_ACCOUNT_NOT_FOUND",
      "보내는 수단을 찾을 수 없습니다."
    );
    toAccount = resolveTransactionAccount(
      toId,
      keepsExistingType ? [source.toAccountId] : [],
      "TO_ACCOUNT_NOT_FOUND",
      "받는 수단을 찾을 수 없습니다."
    );
    if (mbD1Has(payload, "paymentMethodId") && mbD1Text(payload.paymentMethodId)) mbD1Fail("TRANSFER_PAYMENT_NOT_ALLOWED", "이체에는 결제수단을 사용할 수 없습니다.");
  }
  const hasBillingMonthInput = mbD1Has(payload, "billingMonth");
  const requestedBillingMonth = hasBillingMonthInput
    ? mbD1Text(payload.billingMonth)
    : "";
  if (requestedBillingMonth && !mbD1MonthOnly(requestedBillingMonth)) {
    mbD1Fail("INVALID_BILLING_MONTH", "청구월은 YYYY-MM 형식이어야 합니다.");
  }

  const { billingOverride, billingMonth } = mbD1ResolveBillingState({
    type,
    isCreditCard: paymentMethod?.subType === "신용카드",
    date,
    cutoffDay: paymentMethod?.billingCutoffDay,
    paymentDay: paymentMethod?.paymentDay,
    hasBillingMonthInput,
    requestedBillingMonth,
    sourceBillingOverride: mbD1Text(source.billingOverride),
    sourceBillingMonth: mbD1Text(source.billingMonth),
    forCreate
  });

  if (billingOverride && !mbD1MonthOnly(billingOverride)) {
    mbD1Fail("INVALID_BILLING_MONTH", "청구월은 YYYY-MM 형식이어야 합니다.");
  }

  // 할부는 신용카드 지출에만 둡니다. 결제수단이 바뀌어 신용카드가 아니게 되면 일시불로 돌립니다.
  let installmentMonths = null;
  if (type === "지출" && paymentMethod?.subType === "신용카드") {
    const installmentInput = mbD1Has(payload, "installmentMonths")
      ? payload.installmentMonths
      : source.installmentMonths;
    const normalizedInstallment = normalizeInstallmentMonths(installmentInput);
    if (normalizedInstallment.error) mbD1Fail("INVALID_INSTALLMENT_MONTHS", normalizedInstallment.error);
    installmentMonths = normalizedInstallment.months;
  } else if (mbD1Has(payload, "installmentMonths")) {
    const normalizedInstallment = normalizeInstallmentMonths(payload.installmentMonths);
    if (normalizedInstallment.months) {
      mbD1Fail("INSTALLMENT_CREDIT_CARD_ONLY", "할부는 신용카드 지출에서만 선택할 수 있습니다.");
    }
  }

  return {
    installmentMonths,
    date,
    type,
    categoryId,
    amount,
    fromAccountId: fromAccount?.accountId || null,
    toAccountId: toAccount?.accountId || null,
    paymentMethodId: paymentMethod?.accountId || null,
    spendingTarget: type === "지출" ? spendingTarget : null,
    spenderMemberId: type === "지출" ? await mbD1MemberIdByName(env, spendingTarget) : null,
    description: mbD1Has(payload, "description") ? mbD1Text(payload.description) : mbD1Text(source.description),
    memo: mbD1Has(payload, "memo") ? mbD1Text(payload.memo) : mbD1Text(source.memo),
    billingOverride,
    billingMonth,
    groupId: mbD1Has(payload, "groupId") ? mbD1Text(payload.groupId) || null : source.groupId || null,
    reversalOf: mbD1Has(payload, "reversalOf") ? mbD1Text(payload.reversalOf) || null : source.reversalOf || null
  };
}

async function mbD1InsertChange(env, entityType, entityId, action, version, session, payload = null) {
  const memberId = await mbD1MemberIdByName(env, session?.name);
  return env.DB.prepare(
    "INSERT INTO change_log (household_id,entity_type,entity_id,action,entity_version,changed_by_member_id,payload_json,changed_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(
    MB_D1_HOUSEHOLD_ID,
    entityType,
    entityId,
    action,
    version ?? null,
    memberId,
    payload ? JSON.stringify(payload) : null,
    mbD1Now()
  );
}

async function mbD1GetChangesData(env, url) {
  const latestRow = await mbD1First(
    env,
    "SELECT COALESCE(MAX(change_seq),0) AS latest_seq FROM change_log WHERE household_id=?",
    [MB_D1_HOUSEHOLD_ID]
  );
  const latestSeq = Math.max(0, Math.floor(mbD1Number(latestRow?.latest_seq, 0)));
  if (url.searchParams.get("head") === "1") {
    return { latestSeq, changes: [], hasMore: false };
  }
  const after = Math.max(0, Math.floor(mbD1Number(url.searchParams.get("after"), 0)));
  const limit = Math.max(1, Math.min(200, Math.floor(mbD1Number(url.searchParams.get("limit"), 100))));
  const rows = await mbD1All(
    env,
    `SELECT c.change_seq,c.entity_type,c.entity_id,c.action,c.entity_version,c.payload_json,c.changed_at,
            m.display_name AS changed_by
     FROM change_log c
     LEFT JOIN members m ON m.member_id=c.changed_by_member_id
     WHERE c.household_id=? AND c.change_seq>?
     ORDER BY c.change_seq ASC
     LIMIT ?`,
    [MB_D1_HOUSEHOLD_ID, after, limit]
  );
  const changes = rows.map((row) => {
    let payload = null;
    if (row.payload_json) {
      try { payload = JSON.parse(row.payload_json); } catch { payload = null; }
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
    hasMore: lastSeq < latestSeq
  };
}

async function mbD1RealtimePoke(env, detail = {}) {
  if (!env.HOUSEHOLD_REALTIME) return;
  try {
    const stub = await getHouseholdRealtimeStub(env);
    if (!stub) return;
    await stub.fetch("https://moneybook-realtime.internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "ledger.poke",
        householdId: MB_D1_HOUSEHOLD_ID,
        changedAt: mbD1Now(),
        ...detail
      })
    });
  } catch {
  }
}


function mbD1BenefitRuleIdFromRequestId(requestId, originalRequestId) {
  const request = mbD1Text(requestId);
  const original = mbD1Text(originalRequestId);
  const prefix = "BENEFIT_";
  const suffix = `_${original}`;
  if (!original || !request.startsWith(prefix) || !request.endsWith(suffix)) return "";
  return request.slice(prefix.length, request.length - suffix.length);
}

async function mbD1LinkedBenefit(env, current) {
  if (!current?.groupId || mbD1Text(current.requestId).startsWith("BENEFIT_")) return null;
  const row = await mbD1First(
    env,
    `SELECT transaction_id,request_id,version,deleted_at
     FROM transactions
     WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%'
     ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, current.groupId]
  );
  if (!row) return null;
  const ruleId = mbD1BenefitRuleIdFromRequestId(row.request_id, current.requestId);
  return ruleId ? { ...row, ruleId } : null;
}

async function mbD1MatchingBenefitRule(env, model) {
  const settings = await mbD1AutomationSettingsData(env);
  const activeRules = settings.benefitRules.filter((rule) => mbD1BenefitRuleIsActive(rule, model.date));

  if (model.type === "지출" && model.paymentMethodId) {
    return activeRules.find(
      (rule) => rule.kind === "post_reward" && rule.accountId === model.paymentMethodId
    ) || null;
  }

  if (model.type === "이체" && model.toAccountId) {
    const category = await mbD1CategoryById(env, model.categoryId, false);
    if (category?.name !== "지역화폐충전") return null;
    return activeRules.find(
      (rule) => rule.kind === "pre_discount" && rule.accountId === model.toAccountId
    ) || null;
  }

  return null;
}

async function mbD1LinkedBenefitUpdateStatements(env, current, model, actor, session, now, matchingRule = undefined) {
  const [linked, usage] = await Promise.all([
    mbD1LinkedBenefit(env, current),
    mbD1BenefitRewardUsageRecord(env, current.transactionId)
  ]);
  const rule = matchingRule === undefined
    ? await mbD1MatchingBenefitRule(env, model)
    : matchingRule;
  const statements = [];

  if (!rule) {
    if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
    if (linked && !linked.deleted_at) {
      const nextVersion = mbD1Number(linked.version, 1) + 1;
      statements.push(
        env.DB.prepare(
          "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
        ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
        await mbD1InsertChange(env, "transaction", linked.transaction_id, "deleted", nextVersion, session, { automaticBenefit: true })
      );
    }
    return statements;
  }

  let creditAccountId = null;
  let benefitBaseAmount = model.amount;

  if (rule.kind === "post_reward") {
    creditAccountId = rule.accountId;
    const sameRuleUsage = usage && mbD1Text(usage.rule_id) === rule.id;
    const excludeRequestId = linked?.ruleId === rule.id ? linked.request_id : "";
    const rewardBalanceBefore = await mbD1BenefitRewardBalance(
      env,
      rule,
      current.transactionId,
      excludeRequestId
    );
    const oldRewardUsed = sameRuleUsage
      ? Math.max(0, Math.floor(mbD1Number(usage.used_amount, 0)))
      : 0;
    const rewardUsedAmount = Math.min(
      oldRewardUsed,
      Math.max(0, model.amount),
      rewardBalanceBefore
    );
    benefitBaseAmount = Math.max(0, model.amount - rewardUsedAmount);

    if (rewardUsedAmount > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
        ).bind(
          current.transactionId,
          MB_D1_HOUSEHOLD_ID,
          rule.id,
          rule.accountId,
          rewardUsedAmount,
          now,
          now
        )
      );
    } else if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
  } else if (rule.kind === "pre_discount") {
    creditAccountId = model.fromAccountId;
    if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
  }

  if (!creditAccountId) return statements;

  const linkedRequestIdForCap = linked?.ruleId === rule.id ? linked.request_id : "";
  const benefitAmount = await mbD1CalculateBenefit(
    env,
    rule,
    benefitBaseAmount,
    model.date,
    linkedRequestIdForCap
  );

  if (benefitAmount <= 0) {
    if (linked && !linked.deleted_at) {
      const nextVersion = mbD1Number(linked.version, 1) + 1;
      statements.push(
        env.DB.prepare(
          "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
        ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
        await mbD1InsertChange(env, "transaction", linked.transaction_id, "deleted", nextVersion, session, { automaticBenefit: true })
      );
    }
    return statements;
  }

  const benefitCategory = await mbD1BenefitCategory(env);
  if (!benefitCategory?.category_id) {
    mbD1Fail("BENEFIT_CATEGORY_MISSING", "수입 카테고리 '캐시백/할인혜택'이 필요합니다.");
  }
  const account = await mbD1AccountById(env, creditAccountId, false);
  if (!account) mbD1Fail("BENEFIT_ACCOUNT_NOT_FOUND", "혜택 반영 계좌를 찾을 수 없습니다.");
  const description = rule.kind === "pre_discount"
    ? `${account.displayName} 선할인`
    : `${account.displayName} 혜택 적립`;
  const benefitRequestId = `BENEFIT_${rule.id}_${current.requestId}`;

  if (linked) {
    const nextVersion = mbD1Number(linked.version, 1) + 1;
    statements.push(
      env.DB.prepare(
        `UPDATE transactions
         SET request_id=?,date=?,category_id=?,amount=?,from_account_id=NULL,to_account_id=?,payment_method_id=NULL,
             spending_target=NULL,spender_member_id=NULL,description=?,memo=NULL,billing_month_override=NULL,billing_month=NULL,
             group_id=?,version=?,updated_at=?,updated_by=?,deleted_at=NULL,deleted_by=NULL
         WHERE household_id=? AND transaction_id=?`
      ).bind(
        benefitRequestId,
        model.date,
        benefitCategory.category_id,
        benefitAmount,
        creditAccountId,
        description,
        model.groupId,
        nextVersion,
        now,
        actor,
        MB_D1_HOUSEHOLD_ID,
        linked.transaction_id
      ),
      await mbD1InsertChange(env, "transaction", linked.transaction_id, "updated", nextVersion, session, {
        automaticBenefit: true,
        benefitRuleId: rule.id,
        amount: benefitAmount
      })
    );
    return statements;
  }

  if (!model.groupId || !current.requestId) return statements;
  const enteredBy = await mbD1MemberIdByName(env, actor);
  const benefitModel = await mbD1BuildTransactionModel(
    env,
    {
      date: model.date,
      type: "수입",
      categoryId: benefitCategory.category_id,
      amount: benefitAmount,
      toAccountId: creditAccountId,
      description,
      memo: "",
      groupId: model.groupId
    },
    null,
    true
  );
  const benefitTransactionId = mbD1Id("TX");
  statements.push(
    env.DB.prepare(
      `INSERT INTO transactions (
        transaction_id,household_id,request_id,date,type,category_id,amount,
        from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
        entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
        version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      benefitTransactionId, MB_D1_HOUSEHOLD_ID, benefitRequestId, benefitModel.date, benefitModel.type, benefitModel.categoryId, benefitModel.amount,
      benefitModel.fromAccountId, benefitModel.toAccountId, benefitModel.paymentMethodId, benefitModel.spendingTarget, benefitModel.spenderMemberId,
      enteredBy, benefitModel.description || null, benefitModel.memo || null, benefitModel.billingOverride, benefitModel.billingMonth,
      benefitModel.groupId, benefitModel.reversalOf, 1, now, now, actor, actor, null, null, null
    ),
    await mbD1InsertChange(env, "transaction", benefitTransactionId, "created", 1, session, {
      date: benefitModel.date,
      type: benefitModel.type,
      amount: benefitModel.amount,
      automaticBenefit: true,
      benefitRuleId: rule.id
    })
  );
  return statements;
}

function mbD1LooksLikeRequestIdUniqueConflict(error, tableName) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("UNIQUE constraint failed") &&
    message.includes(`${tableName}.household_id`) &&
    message.includes(`${tableName}.request_id`);
}

const MB_D1_CONCURRENCY_GUARD_TOKEN = "mb_concurrent_modification";

// SQLite의 json()은 올바르지 않은 JSON을 받으면 오류를 내므로, batch 안에서 조건부로 트랜잭션을 중단하는 데 씁니다.
function mbD1LooksLikeConcurrencyGuardFailure(error) {
  const message = String(error?.message || error?.cause?.message || "");
  return /malformed JSON/i.test(message);
}

async function mbD1HandleTransactionMutation(path, body, session, env) {
  const actor = session.name;
  if (path === "/api/transactions") {
    const started = Date.now();
    const requestId = mbD1Text(body.requestId) || mbD1Id("REQ");
    const duplicateRow = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (duplicateRow?.transaction_id) {
      const transaction = await mbD1TransactionById(env, duplicateRow.transaction_id, true);
      return {
        created: false,
        duplicate: true,
        transactionId: duplicateRow.transaction_id,
        requestId,
        row: transaction?.row || 0,
        transaction,
        serverElapsedMs: Date.now() - started
      };
    }

    const benefit = await mbD1PrepareBenefit(env, body, { strictRewardUsage: true });
    const needsBenefitGroup = Boolean(
      benefit && (benefit.benefitAmount > 0 || benefit.rewardUsedAmount > 0)
    );
    const benefitGroupId = needsBenefitGroup
      ? mbD1Text(body.groupId) || `BENEFIT_GROUP_${requestId}`
      : mbD1Text(body.groupId) || null;
    const modelInput = benefitGroupId
      ? { ...body, groupId: benefitGroupId }
      : body;
    const model = await mbD1BuildTransactionModel(env, modelInput, null, true);
    const transactionId = mbD1Id("TX");
    const now = mbD1Now();
    const enteredBy = await mbD1MemberIdByName(env, actor);
    const insert = env.DB.prepare(
      `INSERT INTO transactions (
        transaction_id,household_id,request_id,date,type,category_id,amount,
        from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
        entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
        version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row,installment_months
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      transactionId, MB_D1_HOUSEHOLD_ID, requestId, model.date, model.type, model.categoryId, model.amount,
      model.fromAccountId, model.toAccountId, model.paymentMethodId, model.spendingTarget, model.spenderMemberId,
      enteredBy, model.description || null, model.memo || null, model.billingOverride, model.billingMonth,
      model.groupId, model.reversalOf, 1, now, now, actor, actor, null, null, null, model.installmentMonths
    );
    const change = await mbD1InsertChange(env, "transaction", transactionId, "created", 1, session, {
      date: model.date,
      type: model.type,
      amount: model.amount
    });

    const statements = [insert, change];
    let benefitTransactionId = null;
    if (benefit && benefit.benefitAmount > 0) {
      const benefitCategory = await mbD1BenefitCategory(env);
      if (!benefitCategory?.category_id) {
        mbD1Fail("BENEFIT_CATEGORY_MISSING", "수입 카테고리 '캐시백/할인혜택'이 필요합니다.");
      }
      const account = await mbD1AccountById(env, benefit.creditAccountId, false);
      if (!account) mbD1Fail("BENEFIT_ACCOUNT_NOT_FOUND", "혜택 반영 계좌를 찾을 수 없습니다.");
      const benefitRequestId = `BENEFIT_${benefit.rule.id}_${requestId}`;
      const benefitDescription = benefit.kind === "pre_discount"
        ? `${account.displayName} 선할인`
        : `${account.displayName} 혜택 적립`;
      const benefitModel = await mbD1BuildTransactionModel(
        env,
        {
          date: model.date,
          type: "수입",
          categoryId: benefitCategory.category_id,
          amount: benefit.benefitAmount,
          toAccountId: benefit.creditAccountId,
          description: benefitDescription,
          memo: "",
          groupId: benefitGroupId
        },
        null,
        true
      );
      benefitTransactionId = mbD1Id("TX");
      const benefitInsert = env.DB.prepare(
        `INSERT INTO transactions (
          transaction_id,household_id,request_id,date,type,category_id,amount,
          from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
          entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
          version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        benefitTransactionId, MB_D1_HOUSEHOLD_ID, benefitRequestId, benefitModel.date, benefitModel.type, benefitModel.categoryId, benefitModel.amount,
        benefitModel.fromAccountId, benefitModel.toAccountId, benefitModel.paymentMethodId, benefitModel.spendingTarget, benefitModel.spenderMemberId,
        enteredBy, benefitModel.description || null, benefitModel.memo || null, benefitModel.billingOverride, benefitModel.billingMonth,
        benefitModel.groupId, benefitModel.reversalOf, 1, now, now, actor, actor, null, null, null
      );
      const benefitChange = await mbD1InsertChange(env, "transaction", benefitTransactionId, "created", 1, session, {
        date: benefitModel.date,
        type: benefitModel.type,
        amount: benefitModel.amount,
        automaticBenefit: true
      });
      statements.push(benefitInsert, benefitChange);
    }

    if (benefit?.kind === "post_reward" && benefit.rewardUsedAmount > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
        ).bind(
          transactionId,
          MB_D1_HOUSEHOLD_ID,
          benefit.rule.id,
          benefit.rule.accountId,
          benefit.rewardUsedAmount,
          now,
          now
        )
      );
    }

    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (mbD1LooksLikeRequestIdUniqueConflict(error, "transactions")) {
        const duplicate = await mbD1First(
          env,
          "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
          [MB_D1_HOUSEHOLD_ID, requestId]
        );
        if (duplicate?.transaction_id) {
          const transaction = await mbD1TransactionById(env, duplicate.transaction_id, true);
          return {
            created: false,
            duplicate: true,
            transactionId: duplicate.transaction_id,
            requestId,
            row: transaction?.row || 0,
            transaction,
            serverElapsedMs: Date.now() - started
          };
        }
      }
      throw error;
    }
    const transaction = await mbD1TransactionById(env, transactionId, true);
    return {
      created: true,
      duplicate: false,
      transactionId,
      requestId,
      row: 0,
      transaction,
      benefit: benefit
        ? {
            kind: benefit.kind,
            ratePercent: benefit.rule.ratePercent,
            faceAmount: benefit.faceAmount,
            actualAmount: benefit.actualAmount,
            benefitAmount: benefit.benefitAmount,
            eligibleAmount: benefit.eligibleAmount,
            rewardBalanceBefore: benefit.rewardBalanceBefore,
            rewardUsedAmount: benefit.rewardUsedAmount,
            rewardBalanceAfter: benefit.rewardBalanceAfter,
            benefitTransactionId
          }
        : null,
      serverElapsedMs: Date.now() - started
    };
  }

  const transactionId = mbD1Text(body.transactionId);
  if (!transactionId) mbD1Fail("TRANSACTION_ID_REQUIRED", "transactionId가 필요합니다.");
  const current = await mbD1TransactionById(env, transactionId, true);
  if (!current) mbD1Fail("TRANSACTION_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);

  if (path === "/api/transactions/settle") {
    if (current.isDeleted) mbD1Fail("TRANSACTION_NOT_FOUND", "정산할 거래를 찾을 수 없습니다.", 404);
    if (current.reversalOf || !mbD1IsSettlementEligibleCategory(current.type, current.category, current.categoryId)) {
      mbD1Fail("SETTLEMENT_NOT_ELIGIBLE", "정산받기는 정산 가능한 지출에서만 사용할 수 있습니다.");
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) mbD1Fail("INVALID_SETTLEMENT_AMOUNT", "정산받은 금액을 입력해주세요.");
    const receiveAccountId = mbD1Text(body.toAccountId);
    if (!receiveAccountId) mbD1Fail("SETTLEMENT_ACCOUNT_REQUIRED", "정산금을 받은 현금 또는 계좌를 선택해주세요.");
    const receiveAccount = await mbD1AccountById(env, receiveAccountId, false);
    if (!receiveAccount || !receiveAccount.active || receiveAccount.isDeleted) {
      mbD1Fail("SETTLEMENT_ACCOUNT_NOT_FOUND", "정산금을 받은 계좌를 찾을 수 없습니다.");
    }
    if (receiveAccount.accountType !== "자산" || ["신용카드", "체크카드"].includes(receiveAccount.subType)) {
      mbD1Fail("SETTLEMENT_ACCOUNT_INVALID", "정산금은 현금이나 입금 가능한 자산 계좌로 받아주세요.");
    }

    const before = await mbD1SettlementSummaryData(env, transactionId);
    if (amount > before.remainingAmount + 0.0001) {
      mbD1Fail(
        "SETTLEMENT_AMOUNT_EXCEEDS_REMAINING",
        `남은 정산 가능 금액 ${Math.round(before.remainingAmount).toLocaleString("ko-KR")}원을 초과할 수 없습니다.`
      );
    }

    const rawRequestId = mbD1Text(body.requestId);
    const requestId = rawRequestId
      ? (rawRequestId.startsWith(SETTLEMENT_REQUEST_PREFIX) ? rawRequestId : `${SETTLEMENT_REQUEST_PREFIX}${rawRequestId}`)
      : `${SETTLEMENT_REQUEST_PREFIX}${transactionId}_${mbD1Id("REQ")}`;
    const duplicateRow = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (duplicateRow?.transaction_id) {
      return {
        created: false,
        duplicate: true,
        transaction: await mbD1TransactionById(env, duplicateRow.transaction_id, true),
        summary: await mbD1SettlementSummaryData(env, transactionId)
      };
    }

    const category = await mbD1SettlementIncomeCategory(env);
    const date = await mbD1ValidateLedgerDate(env, body.date || mbD1CurrentDateSeoul());
    const model = await mbD1BuildTransactionModel(
      env,
      {
        date,
        type: "수입",
        categoryId: category.category_id,
        amount,
        toAccountId: receiveAccountId,
        description: `${current.description || current.category || "지출"} 정산받음`,
        memo: mbD1Text(body.memo),
        reversalOf: transactionId
      },
      null,
      true
    );
    const settlementTransactionId = mbD1Id("TX");
    const now = mbD1Now();
    const enteredBy = await mbD1MemberIdByName(env, actor);
    const insert = env.DB.prepare(
      `INSERT INTO transactions (
        transaction_id,household_id,request_id,date,type,category_id,amount,
        from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
        entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
        version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      settlementTransactionId, MB_D1_HOUSEHOLD_ID, requestId, model.date, model.type, model.categoryId, model.amount,
      model.fromAccountId, model.toAccountId, model.paymentMethodId, model.spendingTarget, model.spenderMemberId,
      enteredBy, model.description || null, model.memo || null, model.billingOverride, model.billingMonth,
      model.groupId, model.reversalOf, 1, now, now, actor, actor, null, null, null
    );
    const change = await mbD1InsertChange(env, "transaction", settlementTransactionId, "created", 1, session, {
      date: model.date,
      type: model.type,
      amount: model.amount,
      settlementOf: transactionId
    });
    try {
      await env.DB.batch([insert, change]);
    } catch (error) {
      if (mbD1LooksLikeRequestIdUniqueConflict(error, "transactions")) {
        const duplicate = await mbD1First(
          env,
          "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
          [MB_D1_HOUSEHOLD_ID, requestId]
        );
        if (duplicate?.transaction_id) {
          return {
            created: false,
            duplicate: true,
            transaction: await mbD1TransactionById(env, duplicate.transaction_id, true),
            summary: await mbD1SettlementSummaryData(env, transactionId)
          };
        }
      }
      throw error;
    }
    return {
      created: true,
      duplicate: false,
      transaction: await mbD1TransactionById(env, settlementTransactionId, true),
      summary: await mbD1SettlementSummaryData(env, transactionId)
    };
  }

  if (path === "/api/transactions/update") {
    if (current.isDeleted) mbD1Fail("TRANSACTION_NOT_FOUND", "수정할 거래를 찾을 수 없습니다.", 404);
    if (!mbD1Has(body, "expectedUpdatedAtMs")) mbD1Fail("UPDATE_VERSION_REQUIRED", "거래의 최신 버전 정보가 필요합니다. 화면을 새로고침한 뒤 다시 시도하세요.", 409);
    const expected = body.expectedUpdatedAtMs === null || body.expectedUpdatedAtMs === ""
      ? null
      : Number(body.expectedUpdatedAtMs);
    if (expected !== null && !Number.isFinite(expected)) mbD1Fail("INVALID_UPDATE_VERSION", "업데이트 버전 정보가 올바르지 않습니다.");
    if (current.updatedAtMs !== expected) mbD1Fail("CONCURRENT_MODIFICATION", "거래가 다른 기기에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 수정하세요.", 409);
    const financialKeys = ["date","type","categoryId","amount","fromAccountId","toAccountId","paymentMethodId","spendingTarget","billingMonth","groupId","reversalOf","installmentMonths"];
    const financialChange = financialKeys.some((key) => mbD1Has(body, key));
    if (financialChange && current.reversalOf) mbD1Fail("REVERSAL_FINANCIAL_EDIT_NOT_ALLOWED", "환불/정산 거래의 금액·계좌·유형은 직접 수정할 수 없습니다.");
    if (financialChange && !current.reversalOf) {
      const reversal = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND reversal_of=? AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, transactionId]
      );
      if (reversal) mbD1Fail("ORIGINAL_WITH_REVERSAL_EDIT_NOT_ALLOWED", "이미 환불/정산이 연결된 원거래의 금액·계좌·유형은 직접 수정할 수 없습니다.");
    }
    let model = await mbD1BuildTransactionModel(env, body, current, false);
    const matchingBenefitRule = financialChange
      ? await mbD1MatchingBenefitRule(env, model)
      : null;
    if (financialChange && matchingBenefitRule && !model.groupId) {
      model = {
        ...model,
        groupId: `BENEFIT_GROUP_${current.requestId || transactionId}`
      };
    }
    const now = mbD1Now();
    const nextVersion = mbD1Number((await mbD1First(env, "SELECT version FROM transactions WHERE transaction_id=?", [transactionId]))?.version, 1) + 1;
    const update = env.DB.prepare(
      `UPDATE transactions SET date=?,type=?,category_id=?,amount=?,from_account_id=?,to_account_id=?,payment_method_id=?,
       spending_target=?,spender_member_id=?,description=?,memo=?,billing_month_override=?,billing_month=?,group_id=?,reversal_of=?,
       installment_months=?,version=?,updated_at=?,updated_by=? WHERE household_id=? AND transaction_id=? AND deleted_at IS NULL`
    ).bind(
      model.date, model.type, model.categoryId, model.amount, model.fromAccountId, model.toAccountId, model.paymentMethodId,
      model.spendingTarget, model.spenderMemberId, model.description || null, model.memo || null, model.billingOverride,
      model.billingMonth, model.groupId, model.reversalOf, model.installmentMonths, nextVersion, now, actor, MB_D1_HOUSEHOLD_ID, transactionId
    );
    const change = await mbD1InsertChange(env, "transaction", transactionId, "updated", nextVersion, session, {
      date: model.date,
      type: model.type,
      amount: model.amount
    });
    const linkedBenefitStatements = financialChange
      ? await mbD1LinkedBenefitUpdateStatements(
          env,
          current,
          model,
          actor,
          session,
          now,
          matchingBenefitRule
        )
      : [];
    // 위의 버전 확인과 실제 저장 사이에 다른 기기가 먼저 저장했다면 batch 전체를 취소합니다.
    const concurrencyGuard = env.DB.prepare(
      `SELECT CASE
         WHEN (SELECT updated_at FROM transactions WHERE household_id=? AND transaction_id=? AND deleted_at IS NULL) IS ?
         THEN 1
         ELSE json('${MB_D1_CONCURRENCY_GUARD_TOKEN}')
       END AS ok`
    ).bind(MB_D1_HOUSEHOLD_ID, transactionId, current.updatedAt ?? null);
    try {
      await env.DB.batch([concurrencyGuard, update, change, ...linkedBenefitStatements]);
    } catch (error) {
      if (mbD1LooksLikeConcurrencyGuardFailure(error)) {
        mbD1Fail("CONCURRENT_MODIFICATION", "거래가 다른 기기에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 수정하세요.", 409);
      }
      throw error;
    }
    return { updated: true, transaction: await mbD1TransactionById(env, transactionId, true) };
  }

  if (path === "/api/transactions/delete") {
    if (current.isDeleted) return { deleted: true, alreadyDeleted: true, transactionId };
    if (!current.reversalOf) {
      const reversal = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND reversal_of=? AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, transactionId]
      );
      if (reversal) mbD1Fail("ORIGINAL_WITH_REVERSAL_DELETE_NOT_ALLOWED", "활성 환불/정산이 연결된 원거래는 삭제할 수 없습니다. 연결된 거래를 먼저 삭제하세요.");
    }
    const now = mbD1Now();
    const versionRow = await mbD1First(env, "SELECT version FROM transactions WHERE transaction_id=?", [transactionId]);
    const nextVersion = mbD1Number(versionRow?.version, 1) + 1;
    const update = env.DB.prepare(
      "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
    ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, transactionId);
    const change = await mbD1InsertChange(env, "transaction", transactionId, "deleted", nextVersion, session);
    const statements = [update, change];
    if (current.groupId && !mbD1Text(current.requestId).startsWith("BENEFIT_")) {
      const linkedBenefits = await mbD1All(
        env,
        "SELECT transaction_id,version FROM transactions WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%' AND deleted_at IS NULL",
        [MB_D1_HOUSEHOLD_ID, current.groupId]
      );
      for (const linked of linkedBenefits) {
        const linkedVersion = mbD1Number(linked.version, 1) + 1;
        statements.push(
          env.DB.prepare(
            "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
          ).bind(now, actor, now, actor, linkedVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
          await mbD1InsertChange(env, "transaction", linked.transaction_id, "deleted", linkedVersion, session, { automaticBenefit: true })
        );
      }
    }
    await env.DB.batch(statements);
    return { deleted: true, transactionId };
  }

  if (path === "/api/transactions/restore") {
    if (!current.isDeleted) return { restored: true, alreadyActive: true, transactionId };
    if (mbD1Text(current.requestId).startsWith("BENEFIT_") && current.groupId) {
      const activeMain = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND group_id=? AND request_id NOT LIKE 'BENEFIT_%' AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, current.groupId]
      );
      if (!activeMain) mbD1Fail("BENEFIT_ORIGINAL_NOT_ACTIVE", "혜택 적립의 원거래를 먼저 복원해주세요.");
    }
    if (current.reversalOf) {
      const original = await mbD1TransactionById(env, current.reversalOf, true);
      if (!original || original.isDeleted) mbD1Fail("REVERSAL_ORIGINAL_NOT_ACTIVE", "원거래가 활성 상태가 아니어서 환불/정산 거래를 복원할 수 없습니다.");
      if (mbD1IsSettlementRequestId(current.requestId)) {
        const summary = await mbD1SettlementSummaryData(env, current.reversalOf);
        if (mbD1Number(current.amount) > summary.remainingAmount + 0.0001) {
          mbD1Fail(
            "SETTLEMENT_RESTORE_EXCEEDS_REMAINING",
            `현재 남은 정산 가능 금액 ${Math.round(summary.remainingAmount).toLocaleString("ko-KR")}원을 초과해 이 정산 내역을 복원할 수 없습니다.`
          );
        }
      }
    }
    await mbD1BuildTransactionModel(env, {}, current, false);
    const now = mbD1Now();
    const versionRow = await mbD1First(env, "SELECT version FROM transactions WHERE transaction_id=?", [transactionId]);
    const nextVersion = mbD1Number(versionRow?.version, 1) + 1;
    const update = env.DB.prepare(
      "UPDATE transactions SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
    ).bind(now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, transactionId);
    const change = await mbD1InsertChange(env, "transaction", transactionId, "restored", nextVersion, session);
    const statements = [update, change];
    if (current.groupId && !mbD1Text(current.requestId).startsWith("BENEFIT_")) {
      const linkedBenefits = await mbD1All(
        env,
        "SELECT transaction_id,version FROM transactions WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%' AND deleted_at=?",
        [MB_D1_HOUSEHOLD_ID, current.groupId, current.deletedAt]
      );
      for (const linked of linkedBenefits) {
        const linkedVersion = mbD1Number(linked.version, 1) + 1;
        statements.push(
          env.DB.prepare(
            "UPDATE transactions SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
          ).bind(now, actor, linkedVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
          await mbD1InsertChange(env, "transaction", linked.transaction_id, "restored", linkedVersion, session, { automaticBenefit: true })
        );
      }
    }
    await env.DB.batch(statements);
    return { restored: true, transaction: await mbD1TransactionById(env, transactionId, true) };
  }

  mbD1Fail("UNSUPPORTED_TRANSACTION_ACTION", "지원하지 않는 거래 작업입니다.");
}

async function mbD1HandleCategoryMutation(path, body, session, env) {
  const actor = session.name;
  if (path === "/api/categories") {
    const type = mbD1Text(body.type);
    const name = mbD1Text(body.name || body.category);
    if (!["수입", "지출", "이체"].includes(type)) mbD1Fail("INVALID_CATEGORY_TYPE", "카테고리 유형은 수입/지출/이체여야 합니다.");
    if (!name) mbD1Fail("CATEGORY_NAME_REQUIRED", "대분류 이름이 필요합니다.");
    const duplicate = await mbD1First(
      env,
      "SELECT category_id FROM categories WHERE household_id=? AND type=? AND name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, type, name]
    );
    if (duplicate) mbD1Fail("CATEGORY_DUPLICATE", "같은 유형/대분류가 이미 존재합니다.", 409);
    const id = mbD1Id("CAT");
    const now = mbD1Now();
    const active = mbD1Has(body, "active") ? (mbD1Bool(body.active) ? 1 : 0) : 1;
    const insert = env.DB.prepare(
      "INSERT INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
    ).bind(id, MB_D1_HOUSEHOLD_ID, type, name, active, now, now, actor, actor, null, null);
    const change = await mbD1InsertChange(env, "category", id, "created", 1, session, { type, name });
    await env.DB.batch([insert, change]);
    return { created: true, category: await mbD1CategoryById(env, id, true) };
  }

  const id = mbD1Text(body.categoryId);
  if (!id) mbD1Fail("CATEGORY_ID_REQUIRED", "categoryId가 필요합니다.");
  const current = await mbD1CategoryById(env, id, true);
  if (!current) mbD1Fail("CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없습니다.", 404);

  if (current.systemLocked && (path === "/api/categories/update" || path === "/api/categories/delete")) {
    mbD1Fail(
      "SYSTEM_CATEGORY_LOCKED",
      "이 카테고리는 자동 기록에 사용되는 시스템 카테고리라 수정하거나 삭제할 수 없습니다.",
      409
    );
  }

  if (path === "/api/categories/update") {
    if (current.isDeleted) mbD1Fail("CATEGORY_NOT_FOUND", "수정할 카테고리를 찾을 수 없습니다.", 404);
    const type = mbD1Has(body, "type") ? mbD1Text(body.type) : current.type;
    const name = mbD1Has(body, "name") ? mbD1Text(body.name) : current.name;
    const active = mbD1Has(body, "active") ? mbD1Bool(body.active) : current.active;
    if (!["수입", "지출", "이체"].includes(type)) mbD1Fail("INVALID_CATEGORY_TYPE", "카테고리 유형은 수입/지출/이체여야 합니다.");
    if (!name) mbD1Fail("CATEGORY_NAME_REQUIRED", "대분류 이름이 필요합니다.");
    const duplicate = await mbD1First(
      env,
      "SELECT category_id FROM categories WHERE household_id=? AND category_id<>? AND type=? AND name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, type, name]
    );
    if (duplicate) mbD1Fail("CATEGORY_DUPLICATE", "같은 유형/대분류가 이미 존재합니다.", 409);
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE categories SET type=?,name=?,is_active=?,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
    ).bind(type, name, active ? 1 : 0, now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "category", id, "updated", null, session, { type, name, active });
    await env.DB.batch([update, change]);
    return { updated: true, category: await mbD1CategoryById(env, id, true) };
  }

  if (path === "/api/categories/delete") {
    if (current.isDeleted) return { deleted: true, categoryId: id };
    const used = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND category_id=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id]
    );
    if (used) mbD1Fail("CATEGORY_IN_USE", "거래에서 사용 중인 카테고리는 삭제할 수 없습니다. 사용여부를 끄는 방식을 사용하세요.");
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE categories SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
    ).bind(now, actor, now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "category", id, "deleted", null, session);
    await env.DB.batch([update, change]);
    return { deleted: true, restored: false, categoryId: id };
  }

  if (path === "/api/categories/restore") {
    if (!current.isDeleted) return { restored: true, categoryId: id };
    const duplicate = await mbD1First(
      env,
      "SELECT category_id FROM categories WHERE household_id=? AND category_id<>? AND type=? AND name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, current.type, current.name]
    );
    if (duplicate) mbD1Fail("CATEGORY_RESTORE_CONFLICT", "같은 유형과 이름의 카테고리가 이미 있어 복원할 수 없습니다.", 409);
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE categories SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
    ).bind(now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "category", id, "restored", null, session);
    await env.DB.batch([update, change]);
    return { restored: true, deleted: false, categoryId: id, category: await mbD1CategoryById(env, id, true) };
  }

  mbD1Fail("UNSUPPORTED_CATEGORY_ACTION", "지원하지 않는 카테고리 작업입니다.");
}

async function mbD1AccountModel(env, body, current = null, selfId = null) {
  const source = current || {};
  const accountName = mbD1Text(mbD1Has(body, "accountName") ? body.accountName : source.accountName);
  const accountType = mbD1Text(mbD1Has(body, "accountType") ? body.accountType : source.accountType);
  const subType = mbD1Text(mbD1Has(body, "subType") ? body.subType : source.subType);
  const owner = mbD1Text(mbD1Has(body, "owner") ? body.owner : source.owner);
  if (!accountName) mbD1Fail("ACCOUNT_NAME_REQUIRED", "계좌명이 필요합니다.");
  if (!accountType) mbD1Fail("ACCOUNT_TYPE_REQUIRED", "계좌유형이 필요합니다.");
  if (!subType) mbD1Fail("ACCOUNT_SUBTYPE_REQUIRED", "세부구분이 필요합니다.");
  if (!owner) mbD1Fail("ACCOUNT_OWNER_REQUIRED", "명의자가 필요합니다.");
  const ownerMemberId = await mbD1MemberIdByName(env, owner);
  if (owner !== "공동" && !ownerMemberId) mbD1Fail("ACCOUNT_OWNER_REQUIRED", "등록된 구성원을 명의자로 선택해주세요.");
  const openingBalance = Number(mbD1Has(body, "openingBalance") ? body.openingBalance : source.openingBalance);
  if (!Number.isFinite(openingBalance)) mbD1Fail("INVALID_NUMBER", "시작잔액은 숫자여야 합니다.");
  const nullableInteger = (value, code, message, min, max) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) mbD1Fail(code, message);
    return number;
  };
  const billingCutoffDay = nullableInteger(
    mbD1Has(body, "billingCutoffDay") ? body.billingCutoffDay : source.billingCutoffDay,
    "INVALID_CUTOFF_DAY", "청구마감일은 1~31 정수여야 합니다.", 1, 31
  );
  const paymentDay = nullableInteger(
    mbD1Has(body, "paymentDay") ? body.paymentDay : source.paymentDay,
    "INVALID_PAYMENT_DAY", "결제일은 1~31 정수여야 합니다.", 1, 31
  );
  const startYear = nullableInteger(
    mbD1Has(body, "startYear") ? body.startYear : source.startYear,
    "INVALID_START_YEAR", "사용시작연도가 올바르지 않습니다.", 1900, 2200
  );
  const endYear = nullableInteger(
    mbD1Has(body, "endYear") ? body.endYear : source.endYear,
    "INVALID_END_YEAR", "사용종료연도가 올바르지 않습니다.", 1900, 2200
  );
  if (startYear !== null && endYear !== null && startYear > endYear) mbD1Fail("INVALID_YEAR_RANGE", "사용시작연도는 사용종료연도보다 늦을 수 없습니다.");
  const year = mbD1CurrentYearSeoul();
  const active = (startYear === null || year >= startYear) && (endYear === null || year <= endYear);
  const balanceMethod = mbD1Text(mbD1Has(body, "balanceMethod") ? body.balanceMethod : source.balanceMethod) || (subType === "주식" ? "평가입력" : "자동계산");
  const assetAttribution = mbD1Text(mbD1Has(body, "assetAttribution") ? body.assetAttribution : source.assetAttribution) || owner;
  let paymentAccountId = mbD1Text(mbD1Has(body, "paymentAccountId") ? body.paymentAccountId : source.paymentAccountId);
  if (subType === "선불/지역화폐") paymentAccountId = "";
  if ((subType === "체크카드" || subType === "신용카드") && !paymentAccountId) mbD1Fail("CARD_PAYMENT_ACCOUNT_REQUIRED", "카드는 결제계좌가 필요합니다.");
  if (paymentAccountId) {
    if (paymentAccountId === selfId) mbD1Fail("SELF_PAYMENT_ACCOUNT", "자기 자신을 결제계좌로 지정할 수 없습니다.");
    const payment = await mbD1AccountById(env, paymentAccountId, false);
    if (!payment || payment.isDeleted) mbD1Fail("PAYMENT_ACCOUNT_NOT_FOUND", "결제계좌를 찾을 수 없습니다.");
  }
  return {
    accountName,
    accountType,
    subType,
    owner,
    ownerMemberId,
    openingBalance,
    billingCutoffDay,
    paymentDay,
    startYear,
    endYear,
    active,
    balanceMethod,
    assetAttribution,
    paymentAccountId: paymentAccountId || null,
    displayName: mbD1DisplayName(accountName, owner)
  };
}

async function mbD1HandleAccountMutation(path, body, session, env) {
  const actor = session.name;
  if (path === "/api/accounts") {
    const model = await mbD1AccountModel(env, body, null, null);
    const duplicate = await mbD1First(
      env,
      "SELECT account_id FROM accounts WHERE household_id=? AND display_name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, model.displayName]
    );
    if (duplicate) mbD1Fail("ACCOUNT_DUPLICATE", "같은 표시명의 계좌가 이미 존재합니다.", 409);
    const id = mbD1Id("ACC");
    const now = mbD1Now();
    const insert = env.DB.prepare(
      `INSERT INTO accounts (
        account_id,household_id,name,display_name,account_type,sub_type,owner_member_id,owner_label,
        opening_balance,billing_cutoff_day,payment_day,payment_account_id,start_year,end_year,is_active,balance_method,
        current_balance_override,asset_attribution,investment_cash_baseline_krw,investment_cash_baseline_at,
        created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, MB_D1_HOUSEHOLD_ID, model.accountName, model.displayName, model.accountType, model.subType,
      model.ownerMemberId, model.owner, model.openingBalance, model.billingCutoffDay, model.paymentDay,
      model.paymentAccountId, model.startYear, model.endYear, model.active ? 1 : 0, model.balanceMethod,
      null, model.assetAttribution, null, null, now, now, actor, actor, null, null, null
    );
    const change = await mbD1InsertChange(env, "account", id, "created", null, session, { displayName: model.displayName });
    await env.DB.batch([insert, change]);
    return { created: true, account: await mbD1AccountById(env, id, true) };
  }

  const id = mbD1Text(body.accountId);
  if (!id) mbD1Fail("ACCOUNT_ID_REQUIRED", "accountId가 필요합니다.");
  const current = await mbD1AccountById(env, id, true);
  if (!current) mbD1Fail("ACCOUNT_NOT_FOUND", "계좌를 찾을 수 없습니다.", 404);

  if (path === "/api/accounts/update") {
    if (current.isDeleted) mbD1Fail("ACCOUNT_NOT_FOUND", "수정할 계좌를 찾을 수 없습니다.", 404);
    const model = await mbD1AccountModel(env, body, current, id);
    const duplicate = await mbD1First(
      env,
      "SELECT account_id FROM accounts WHERE household_id=? AND account_id<>? AND display_name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, model.displayName]
    );
    if (duplicate) mbD1Fail("ACCOUNT_DUPLICATE", "같은 표시명의 계좌가 이미 존재합니다.", 409);
    const now = mbD1Now();
    const update = env.DB.prepare(
      `UPDATE accounts SET name=?,display_name=?,account_type=?,sub_type=?,owner_member_id=?,owner_label=?,opening_balance=?,
       billing_cutoff_day=?,payment_day=?,payment_account_id=?,start_year=?,end_year=?,is_active=?,balance_method=?,asset_attribution=?,
       updated_at=?,updated_by=? WHERE household_id=? AND account_id=?`
    ).bind(
      model.accountName, model.displayName, model.accountType, model.subType, model.ownerMemberId, model.owner,
      model.openingBalance, model.billingCutoffDay, model.paymentDay, model.paymentAccountId, model.startYear,
      model.endYear, model.active ? 1 : 0, model.balanceMethod, model.assetAttribution, now, actor,
      MB_D1_HOUSEHOLD_ID, id
    );
    const change = await mbD1InsertChange(env, "account", id, "updated", null, session, { displayName: model.displayName });
    await env.DB.batch([update, change]);
    return { updated: true, account: await mbD1AccountById(env, id, true) };
  }

  if (path === "/api/accounts/delete") {
    if (current.isDeleted) return { deleted: true, accountId: id };
    const cardUse = await mbD1First(
      env,
      "SELECT account_id,display_name FROM accounts WHERE household_id=? AND account_id<>? AND payment_account_id=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, id]
    );
    if (cardUse) mbD1Fail("ACCOUNT_IN_USE_AS_PAYMENT_ACCOUNT", `${cardUse.display_name || "다른 카드"}의 결제계좌로 사용 중이라 삭제할 수 없습니다.`);
    const txUse = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND deleted_at IS NULL AND (from_account_id=? OR to_account_id=? OR payment_method_id=?) LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, id, id]
    );
    if (txUse) mbD1Fail("ACCOUNT_IN_USE", "거래에서 사용 중인 계좌는 삭제할 수 없습니다. 사용종료연도 또는 사용여부를 이용하세요.");
    const holdingUse = await mbD1First(
      env,
      "SELECT holding_id FROM holdings WHERE household_id=? AND account_id=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id]
    );
    if (holdingUse) mbD1Fail("ACCOUNT_IN_USE", "보유종목이 연결된 계좌는 삭제할 수 없습니다.");
    const tradeUse = await mbD1First(
      env,
      "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND account_id=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id]
    );
    if (tradeUse) mbD1Fail("INVESTMENT_ACCOUNT_IN_USE", "매매내역이 있는 투자계좌는 삭제할 수 없습니다.");
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE accounts SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=? WHERE household_id=? AND account_id=?"
    ).bind(now, actor, now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "account", id, "deleted", null, session);
    await env.DB.batch([update, change]);
    return { deleted: true, accountId: id };
  }

  if (path === "/api/accounts/restore") {
    if (!current.isDeleted) return { restored: true, alreadyActive: true, accountId: id };
    const duplicate = await mbD1First(
      env,
      "SELECT account_id FROM accounts WHERE household_id=? AND account_id<>? AND display_name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, current.displayName]
    );
    if (duplicate) mbD1Fail("ACCOUNT_RESTORE_CONFLICT", "같은 표시명의 계좌가 이미 있어 복원할 수 없습니다.", 409);
    if (current.paymentAccountId) {
      const payment = await mbD1AccountById(env, current.paymentAccountId, false);
      if (!payment || payment.isDeleted) mbD1Fail("ACCOUNT_RESTORE_PAYMENT_ACCOUNT_MISSING", "연결된 결제계좌를 먼저 복원한 뒤 다시 시도하세요.");
    }
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE accounts SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=? WHERE household_id=? AND account_id=?"
    ).bind(now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "account", id, "restored", null, session);
    await env.DB.batch([update, change]);
    return { restored: true, accountId: id, account: await mbD1AccountById(env, id, true) };
  }

  mbD1Fail("UNSUPPORTED_ACCOUNT_ACTION", "지원하지 않는 계좌 작업입니다.");
}

async function mbD1HandleInputPreferences(body, session, env) {
  if (!isObject(body.preferences)) mbD1Fail("INVALID_INPUT_PREFERENCES", "입력 설정 형식이 올바르지 않습니다.");
  const preferences = body.preferences;
  if (Number(preferences.version) !== 1) mbD1Fail("INVALID_INPUT_PREFERENCES_VERSION", "지원하지 않는 입력 설정 버전입니다.");
  if (!isObject(preferences.categoryOrder)) mbD1Fail("INVALID_INPUT_PREFERENCES", "카테고리 순서 형식이 올바르지 않습니다.");
  for (const type of ["지출", "수입", "이체"]) {
    if (!Array.isArray(preferences.categoryOrder[type])) mbD1Fail("INVALID_INPUT_PREFERENCES", `${type} 카테고리 순서는 배열이어야 합니다.`);
  }
  const now = mbD1Now();
  const update = env.DB.prepare(
    `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
  ).bind(
    "PREF_INPUT_SHARED", MB_D1_HOUSEHOLD_ID, null, "input_preferences", JSON.stringify(preferences), 1, now, now
  );
  const change = await mbD1InsertChange(env, "input_preferences", "shared", "updated", 1, session);
  await env.DB.batch([update, change]);
  return { configured: true, version: 1, preferences, updatedAt: now, updatedBy: session.name };
}

async function mbD1HandleLedgerConfig(path, body, session, env) {
  const now = mbD1Now();
  if (path.endsWith("/clear")) {
    const update = env.DB.prepare(
      "UPDATE households SET ledger_start_date=NULL,updated_at=? WHERE household_id=?"
    ).bind(now, MB_D1_HOUSEHOLD_ID);
    const change = await mbD1InsertChange(env, "ledger_config", "ledger-start-date", "updated", null, session, { ledgerStartDate: null });
    await env.DB.batch([update, change]);
    return { cleared: true, ledgerStartDate: null };
  }
  const value = mbD1DateOnly(body.ledgerStartDate || body.date);
  if (!value) mbD1Fail("INVALID_LEDGER_START_DATE", "가계부 시작일은 YYYY-MM-DD 형식이어야 합니다.");
  const update = env.DB.prepare(
    "UPDATE households SET ledger_start_date=?,updated_at=? WHERE household_id=?"
  ).bind(value, now, MB_D1_HOUSEHOLD_ID);
  const change = await mbD1InsertChange(env, "ledger_config", "ledger-start-date", "updated", null, session, { ledgerStartDate: value });
  await env.DB.batch([update, change]);
  return { updated: true, ledgerStartDate: value };
}

async function mbD1HandleAssetSnapshot(body, session, env) {
  const month = mbD1Text(body.month) || mbD1CurrentMonthSeoul();
  if (!mbD1MonthOnly(month)) mbD1Fail("INVALID_MONTH", "month는 YYYY-MM 형식이어야 합니다.");
  if (month !== mbD1CurrentMonthSeoul()) mbD1Fail("SNAPSHOT_CURRENT_MONTH_ONLY", "순자산 스냅샷은 현재 월만 기록할 수 있습니다.");
  const dashboard = await mbD1BuildDashboard(env, month);
  const now = mbD1Now();
  const existing = await mbD1First(
    env,
    "SELECT month FROM asset_snapshots WHERE household_id=? AND month=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, month]
  );
  const upsert = env.DB.prepare(
    `INSERT INTO asset_snapshots (household_id,month,assets,liabilities,net_worth,investment_value,cash_like_value,created_at,updated_at,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(household_id,month) DO UPDATE SET assets=excluded.assets,liabilities=excluded.liabilities,net_worth=excluded.net_worth,
     investment_value=excluded.investment_value,cash_like_value=excluded.cash_like_value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
  ).bind(
    MB_D1_HOUSEHOLD_ID, month, dashboard.summary.assets, dashboard.summary.liabilities,
    dashboard.summary.netWorth, dashboard.summary.investmentValue, dashboard.summary.cashLikeValue,
    now, now, session.name, session.name
  );
  const change = await mbD1InsertChange(env, "asset_snapshot", month, existing ? "updated" : "created", null, session, { month });
  await env.DB.batch([upsert, change]);
  const row = await mbD1First(
    env,
    "SELECT * FROM asset_snapshots WHERE household_id=? AND month=?",
    [MB_D1_HOUSEHOLD_ID, month]
  );
  return {
    saved: true,
    updated: Boolean(existing),
    snapshot: {
      month: row.month,
      assets: mbD1Number(row.assets),
      liabilities: mbD1Number(row.liabilities),
      netWorth: mbD1Number(row.net_worth),
      investmentValue: mbD1Number(row.investment_value),
      cashLikeValue: mbD1Number(row.cash_like_value),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      row: 0
    }
  };
}

async function mbD1HoldingById(env, id, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `SELECT h.*,a.display_name AS account_name FROM holdings h LEFT JOIN accounts a ON a.account_id=h.account_id
     WHERE h.household_id=? AND h.holding_id=? ${includeDeleted ? "" : "AND h.deleted_at IS NULL"} LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, id]
  );
  return row ? mbD1MapHoldingRow(row) : null;
}

async function mbD1HandleCashBaseline(body, session, env) {
  const accountId = mbD1Text(body.accountId);
  if (!accountId) mbD1Fail("INVESTMENT_ACCOUNT_ID_REQUIRED", "투자계좌 accountId가 필요합니다.");
  const amountRaw = mbD1Has(body, "amount") ? body.amount : body.cashBaselineKrw;
  if (amountRaw === null || amountRaw === undefined || amountRaw === "") mbD1Fail("INVESTMENT_CASH_AMOUNT_REQUIRED", "현재 예수금 금액이 필요합니다.");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount)) mbD1Fail("INVALID_NUMBER", "예수금은 숫자여야 합니다.");
  const account = await mbD1AccountById(env, accountId, false);
  if (!account || !account.active || !mbD1IsInvestmentAccount(account)) mbD1Fail("INVESTMENT_ACCOUNT_NOT_FOUND", "사용 가능한 투자계좌를 찾을 수 없습니다.");
  const hasTrades = await mbD1First(
    env,
    "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND account_id=? AND deleted_at IS NULL LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, accountId]
  );
  if (account.cashBaselineAt && hasTrades && !mbD1Bool(body.force)) mbD1Fail("INVESTMENT_CASH_BASELINE_LOCKED", "이미 투자거래가 있는 계좌입니다. 새 기준점으로 강제 재설정하려면 force가 필요합니다.");
  const now = mbD1Now();
  const update = env.DB.prepare(
    "UPDATE accounts SET investment_cash_baseline_krw=?,investment_cash_baseline_at=?,updated_at=?,updated_by=? WHERE household_id=? AND account_id=?"
  ).bind(amount, now, now, session.name, MB_D1_HOUSEHOLD_ID, accountId);
  const change = await mbD1InsertChange(env, "account", accountId, "updated", null, session, { cashBaselineKrw: amount });
  await env.DB.batch([update, change]);
  return { updated: true, accountId, accountName: account.displayName, cashBaselineKrw: amount, cashBaselineAt: now };
}

async function mbD1HandleHoldingUpdate(body, session, env) {
  const holdingId = mbD1Text(body.holdingId);
  if (!holdingId) mbD1Fail("HOLDING_ID_REQUIRED", "holdingId가 필요합니다.");
  const holding = await mbD1HoldingById(env, holdingId, false);
  if (!holding) mbD1Fail("HOLDING_NOT_FOUND", "수정할 보유종목을 찾을 수 없습니다.", 404);
  const manualPrice = Number(body.manualPrice);
  if (!Number.isFinite(manualPrice) || manualPrice < 0) mbD1Fail("INVALID_NUMBER", "수동입력가는 0 이상의 숫자여야 합니다.");
  const lastUpdated = mbD1DateOnly(body.lastUpdated) || mbD1CurrentDateSeoul();
  const fx = holding.market === "국내" ? 1 : (holding.fx || 0);
  const valueKrw = mbD1Round(holding.quantity * manualPrice * fx, 2);
  const returnRate = holding.bookCostKrw > 0 ? (valueKrw - holding.bookCostKrw) / holding.bookCostKrw : null;
  const now = mbD1Now();
  const update = env.DB.prepare(
    "UPDATE holdings SET manual_price=?,current_price=?,value_krw=?,return_rate=?,last_updated=?,elapsed_days=0,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND holding_id=?"
  ).bind(manualPrice, manualPrice, valueKrw, returnRate, lastUpdated, now, session.name, MB_D1_HOUSEHOLD_ID, holdingId);
  const change = await mbD1InsertChange(env, "holding", holdingId, "updated", null, session, { manualPrice, lastUpdated });
  await env.DB.batch([update, change]);
  return { updated: true, holding: await mbD1HoldingById(env, holdingId, true) };
}

function mbD1ValidatePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) mbD1Fail("INVALID_NUMBER", `${label}은 0보다 큰 숫자여야 합니다.`);
  return number;
}

function mbD1ValidateNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) mbD1Fail("INVALID_NUMBER", `${label}은 0 이상의 숫자여야 합니다.`);
  return number;
}

function mbD1TradeModel(payload, current, account, holding, requestId) {
  const source = current || {};
  const tradeType = mbD1Text(mbD1Has(payload, "tradeType") || mbD1Has(payload, "type") ? (payload.tradeType || payload.type) : source.tradeType);
  if (!["매수", "매도"].includes(tradeType)) mbD1Fail("INVALID_INVESTMENT_TRADE_TYPE", "투자거래 구분은 매수/매도 중 하나여야 합니다.");
  const date = mbD1DateOnly(mbD1Has(payload, "date") || mbD1Has(payload, "tradeDate") ? (payload.date || payload.tradeDate) : source.date || source.tradeDate);
  if (!date) mbD1Fail("INVALID_INVESTMENT_TRADE_DATE", "투자거래일은 YYYY-MM-DD 형식이어야 합니다.");
  const quantity = mbD1ValidatePositive(mbD1Has(payload, "quantity") ? payload.quantity : source.quantity, "수량");
  const unitPrice = mbD1ValidatePositive(mbD1Has(payload, "unitPrice") ? payload.unitPrice : (mbD1Has(payload, "price") ? payload.price : source.unitPrice), "체결단가");
  let currency = mbD1Text(mbD1Has(payload, "currency") ? payload.currency : source.currency).toUpperCase();
  if (!currency) currency = holding.market === "국내" ? "KRW" : "USD";
  if (!/^[A-Z]{3}$/.test(currency)) mbD1Fail("INVALID_INVESTMENT_CURRENCY", "통화는 KRW, USD처럼 3자리 코드로 입력해야 합니다.");
  if (holding.market === "국내" && currency !== "KRW") mbD1Fail("DOMESTIC_CURRENCY_MUST_BE_KRW", "국내 종목의 체결통화는 KRW여야 합니다.");
  const fxRate = currency === "KRW" ? 1 : mbD1ValidatePositive(mbD1Has(payload, "fxRate") ? payload.fxRate : source.fxRate, "체결환율");
  const feeKrw = mbD1ValidateNonNegative(mbD1Has(payload, "feeKrw") ? payload.feeKrw : source.feeKrw, "수수료");
  const taxKrw = mbD1ValidateNonNegative(mbD1Has(payload, "taxKrw") ? payload.taxKrw : source.taxKrw, "세금");
  const financeChanged = !source.investmentTradeId || ["tradeType","type","quantity","unitPrice","price","currency","fxRate","feeKrw","taxKrw"].some((key) => mbD1Has(payload, key));
  let settlementKrw;
  if (mbD1Has(payload, "settlementKrw")) {
    settlementKrw = mbD1ValidatePositive(payload.settlementKrw, "원화결제금액");
  } else if (!financeChanged && mbD1Number(source.settlementKrw) > 0) {
    settlementKrw = mbD1Number(source.settlementKrw);
  } else {
    const gross = quantity * unitPrice * fxRate;
    settlementKrw = tradeType === "매수" ? gross + feeKrw + taxKrw : gross - feeKrw - taxKrw;
    if (!Number.isFinite(settlementKrw) || settlementKrw <= 0) mbD1Fail("INVALID_INVESTMENT_SETTLEMENT", "원화결제금액 계산 결과가 0보다 커야 합니다.");
  }
  return {
    date,
    tradeType,
    accountId: account.accountId,
    accountName: account.displayName,
    holdingId: holding.holdingId,
    stockCode: holding.stockCode,
    stockName: holding.stockName,
    market: holding.market,
    quantity,
    unitPrice,
    currency,
    fxRate,
    feeKrw,
    taxKrw,
    settlementKrw: mbD1Round(settlementKrw, 2),
    memo: mbD1Has(payload, "memo") ? mbD1Text(payload.memo) : mbD1Text(source.memo),
    requestId
  };
}

function mbD1SimulateHolding(holding, trades) {
  let quantity = mbD1Number(holding.baselineQuantity);
  let avgPrice = mbD1Number(holding.baselineAvgPrice);
  let bookCost = mbD1Number(holding.baselineBookCostKrw);
  const realized = new Map();
  const sorted = trades.slice().sort((a, b) =>
    (a.date || "").localeCompare(b.date || "") ||
    (a.createdAt || "").localeCompare(b.createdAt || "") ||
    a.investmentTradeId.localeCompare(b.investmentTradeId)
  );
  for (const trade of sorted) {
    if (trade.tradeType === "매수") {
      const nativeBefore = quantity * avgPrice;
      const nativeBuy = trade.quantity * trade.unitPrice;
      const nextQty = quantity + trade.quantity;
      avgPrice = nextQty > 0 ? (nativeBefore + nativeBuy) / nextQty : 0;
      quantity = nextQty;
      bookCost += trade.settlementKrw;
      realized.set(trade.investmentTradeId, 0);
      continue;
    }
    if (trade.quantity > quantity + 1e-9) mbD1Fail("SELL_QUANTITY_EXCEEDS_HOLDING", `${trade.date} 매도수량 ${trade.quantity}주가 당시 보유수량 ${mbD1Round(quantity, 8)}주를 초과합니다.`);
    if (quantity <= 0) mbD1Fail("SELL_WITHOUT_HOLDING", `${trade.date} 매도 시점에 보유수량이 없습니다.`);
    const removedBook = bookCost * (trade.quantity / quantity);
    const pnl = trade.settlementKrw - removedBook;
    quantity -= trade.quantity;
    bookCost -= removedBook;
    if (Math.abs(quantity) < 1e-9) {
      quantity = 0;
      avgPrice = 0;
      bookCost = 0;
    }
    if (Math.abs(bookCost) < 0.000001) bookCost = 0;
    realized.set(trade.investmentTradeId, mbD1Round(pnl, 2));
  }
  return {
    quantity: mbD1Round(quantity, 8),
    avgBuyPrice: mbD1Round(avgPrice, 8),
    bookCostKrw: mbD1Round(bookCost, 2),
    realized
  };
}

async function mbD1CashForAccountWithTrades(env, account, proposedTrades) {
  if (!account.cashBaselineAt) return null;
  const transactions = await mbD1AllTransactions(env, false);
  let ledgerDelta = 0;
  for (const tx of transactions) {
    if (!mbD1TransactionAfterBaseline(tx, account.cashBaselineAt)) continue;
    if (tx.fromAccountId === account.accountId) ledgerDelta -= tx.amount;
    if (tx.toAccountId === account.accountId) ledgerDelta += tx.amount;
  }
  const baselineMs = mbD1TimestampMs(account.cashBaselineAt);
  let tradeDelta = 0;
  for (const trade of proposedTrades) {
    const createdMs = mbD1TimestampMs(trade.createdAt);
    if (baselineMs !== null && createdMs !== null && createdMs < baselineMs) continue;
    tradeDelta += trade.tradeType === "매수" ? -trade.settlementKrw : trade.settlementKrw;
  }
  return mbD1Round(mbD1Number(account.cashBaselineKrw) + ledgerDelta + tradeDelta, 2);
}

async function mbD1HandleTradeMutation(path, body, session, env, ctx) {
  const actor = session.name;
  if (path === "/api/investments/trades") {
    const requestId = mbD1Text(body.requestId) || mbD1Id("IREQ");
    const dup = await mbD1First(
      env,
      "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (dup?.investment_trade_id) {
      const trade = (await mbD1Trades(env, true)).find((item) => item.investmentTradeId === dup.investment_trade_id) || null;
      return { created: false, duplicate: true, investmentTradeId: dup.investment_trade_id, requestId, trade };
    }
    const accountId = mbD1Text(body.accountId);
    const account = await mbD1AccountById(env, accountId, false);
    if (!account || !account.active || !mbD1IsInvestmentAccount(account)) mbD1Fail("INVESTMENT_ACCOUNT_NOT_FOUND", "사용 가능한 투자계좌를 찾을 수 없습니다.");
    if (!account.cashBaselineAt) mbD1Fail("INVESTMENT_CASH_BASELINE_REQUIRED", "먼저 이 투자계좌의 현재 예수금 기준값을 설정해야 합니다.");
    const type = mbD1Text(body.tradeType || body.type);
    if (!["매수", "매도"].includes(type)) mbD1Fail("INVALID_INVESTMENT_TRADE_TYPE", "투자거래 구분은 매수/매도 중 하나여야 합니다.");
    const stockCode = mbD1Text(body.stockCode).toUpperCase();
    if (!stockCode) mbD1Fail("STOCK_CODE_REQUIRED", "종목코드가 필요합니다.");
    let holding = (await mbD1Holdings(env, false)).find((item) => item.accountId === accountId && item.stockCode.toUpperCase() === stockCode) || null;
    let newHolding = false;
    const now = mbD1Now();
    const statements = [];
    if (!holding) {
      if (type === "매도") mbD1Fail("SELL_HOLDING_NOT_FOUND", "매도할 보유종목을 찾을 수 없습니다.");
      const market = mbD1Text(body.market);
      if (!["국내", "해외"].includes(market)) mbD1Fail("INVALID_MARKET", "신규 종목의 시장은 국내/해외 중 하나여야 합니다.");
      const quoteMode = mbD1Text(body.quoteMode) || "자동";
      if (!["자동", "수동"].includes(quoteMode)) mbD1Fail("INVALID_QUOTE_MODE", "시세조회방식은 자동/수동이어야 합니다.");
      let manualPrice = null;
      if (quoteMode === "수동") manualPrice = mbD1ValidatePositive(body.manualPrice, "수동입력가");
      else if (mbD1Has(body, "manualPrice") && body.manualPrice !== "" && body.manualPrice !== null) manualPrice = mbD1ValidateNonNegative(body.manualPrice, "수동입력가");
      const holdingId = mbD1Id("STK");
      holding = {
        holdingId,
        accountId,
        accountName: account.displayName,
        stockCode,
        stockName: mbD1Text(body.stockName),
        market,
        quantity: 0,
        avgBuyPrice: 0,
        quoteMode,
        manualPrice,
        currentPrice: manualPrice || 0,
        fx: market === "국내" ? 1 : 0,
        valueKrw: 0,
        bookCostKrw: 0,
        returnRate: null,
        owner: account.owner,
        lastUpdated: quoteMode === "수동" ? mbD1CurrentDateSeoul() : null,
        elapsedDays: 0,
        baselineQuantity: 0,
        baselineAvgPrice: 0,
        baselineBookCostKrw: 0,
        baselineAt: now,
        managedByTradesV22: true,
        isDeleted: false
      };
      statements.push(env.DB.prepare(
        `INSERT INTO holdings (holding_id,household_id,account_id,stock_code,stock_name,market,quantity,avg_buy_price,quote_mode,manual_price,current_price,fx_rate,value_krw,book_cost_krw,return_rate,owner_label,last_updated,elapsed_days,baseline_quantity,baseline_avg_price,baseline_book_cost_krw,baseline_at,managed_by_trades,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        holdingId, MB_D1_HOUSEHOLD_ID, accountId, stockCode, holding.stockName || null, market, 0, 0,
        quoteMode, manualPrice, manualPrice, market === "국내" ? 1 : null, 0, 0, null, account.owner,
        holding.lastUpdated, 0, 0, 0, 0, now, 1, 1, now, now, actor, actor, null, null, null
      ));
      newHolding = true;
    } else if (!holding.baselineAt) {
      const baselineBook = holding.bookCostKrw || (holding.quantity * holding.avgBuyPrice * (holding.fx || 1));
      holding.baselineQuantity = holding.quantity;
      holding.baselineAvgPrice = holding.avgBuyPrice;
      holding.baselineBookCostKrw = baselineBook;
      holding.baselineAt = now;
      holding.managedByTradesV22 = true;
      statements.push(env.DB.prepare(
        "UPDATE holdings SET baseline_quantity=?,baseline_avg_price=?,baseline_book_cost_krw=?,baseline_at=?,book_cost_krw=?,managed_by_trades=1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
      ).bind(
        holding.baselineQuantity, holding.baselineAvgPrice, holding.baselineBookCostKrw, holding.baselineAt,
        holding.baselineBookCostKrw, now, actor, MB_D1_HOUSEHOLD_ID, holding.holdingId
      ));
    }
    const tradeDate = mbD1DateOnly(body.tradeDate || body.date);
    if (holding.baselineAt && tradeDate) {
      const baselineDate = new Date(mbD1TimestampMs(holding.baselineAt)).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      if (tradeDate < baselineDate) mbD1Fail("INVESTMENT_TRADE_BEFORE_BASELINE", `기준일 ${baselineDate}보다 이전의 매매는 등록할 수 없습니다.`);
    }
    const model = mbD1TradeModel(body, null, account, holding, requestId);
    const tradeId = mbD1Id("ITX");
    const existingTrades = (await mbD1Trades(env, false)).filter((item) => item.holdingId === holding.holdingId);
    const proposedTrade = {
      investmentTradeId: tradeId,
      ...model,
      createdAt: now,
      updatedAt: now,
      isDeleted: false
    };
    const proposedTrades = [...existingTrades, proposedTrade];
    const state = mbD1SimulateHolding(holding, proposedTrades);
    const allAccountTrades = (await mbD1Trades(env, false)).filter((item) => item.accountId === accountId);
    const cashBefore = await mbD1CashForAccountWithTrades(env, account, allAccountTrades);
    if (type === "매수" && (cashBefore === null || cashBefore + 0.000001 < model.settlementKrw)) {
      mbD1Fail("INSUFFICIENT_INVESTMENT_CASH", `예수금이 부족합니다. 현재 ${cashBefore ?? 0}원 / 필요 ${model.settlementKrw}원`);
    }
    const cashAfter = await mbD1CashForAccountWithTrades(env, account, [...allAccountTrades, proposedTrade]);
    if (cashAfter !== null && cashAfter < -0.000001) mbD1Fail("INSUFFICIENT_INVESTMENT_CASH", "거래 후 예수금이 음수가 됩니다.");
    statements.push(env.DB.prepare(
      `INSERT INTO investment_trades (investment_trade_id,household_id,request_id,trade_date,trade_type,account_id,holding_id,stock_code,stock_name,market,quantity,unit_price,currency,fx_rate,fee_krw,tax_krw,settlement_krw,realized_pnl_krw,memo,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      tradeId, MB_D1_HOUSEHOLD_ID, requestId, model.date, model.tradeType, accountId, holding.holdingId,
      holding.stockCode, holding.stockName || null, holding.market, model.quantity, model.unitPrice, model.currency,
      model.fxRate, model.feeKrw, model.taxKrw, model.settlementKrw, state.realized.get(tradeId) || 0,
      model.memo || null, 1, now, now, actor, actor, null, null, null
    ));
    for (const [id, pnl] of state.realized.entries()) {
      if (id === tradeId) continue;
      statements.push(env.DB.prepare("UPDATE investment_trades SET realized_pnl_krw=? WHERE household_id=? AND investment_trade_id=?").bind(pnl, MB_D1_HOUSEHOLD_ID, id));
    }
    const currentPrice = holding.quoteMode === "수동" ? (holding.manualPrice || 0) : (holding.currentPrice || 0);
    const fx = holding.market === "국내" ? 1 : (holding.fx || model.fxRate || 0);
    const valueKrw = mbD1Round(state.quantity * currentPrice * fx, 2);
    const returnRate = state.bookCostKrw > 0 ? (valueKrw - state.bookCostKrw) / state.bookCostKrw : null;
    statements.push(env.DB.prepare(
      "UPDATE holdings SET quantity=?,avg_buy_price=?,book_cost_krw=?,value_krw=?,return_rate=?,managed_by_trades=1,version=version+1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
    ).bind(state.quantity, state.avgBuyPrice, state.bookCostKrw, valueKrw, returnRate, now, actor, MB_D1_HOUSEHOLD_ID, holding.holdingId));
    statements.push(await mbD1InsertChange(env, "investment_trade", tradeId, "created", 1, session, { accountId, holdingId: holding.holdingId, tradeType: model.tradeType }));
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (mbD1LooksLikeRequestIdUniqueConflict(error, "investment_trades")) {
        const duplicate = await mbD1First(
          env,
          "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND request_id=? LIMIT 1",
          [MB_D1_HOUSEHOLD_ID, requestId]
        );
        if (duplicate?.investment_trade_id) {
          const trade = (await mbD1Trades(env, true)).find(
            (item) => item.investmentTradeId === duplicate.investment_trade_id
          ) || null;
          return {
            created: false,
            duplicate: true,
            investmentTradeId: duplicate.investment_trade_id,
            requestId,
            trade
          };
        }
      }
      throw error;
    }
    if (ctx?.waitUntil) ctx.waitUntil(mbD1RefreshQuotes(env, true));
    const trade = (await mbD1Trades(env, true)).find((item) => item.investmentTradeId === tradeId) || null;
    return {
      created: true,
      duplicate: false,
      newHoldingCreated: newHolding,
      investmentTradeId: tradeId,
      requestId,
      trade,
      holding: {
        holdingId: holding.holdingId,
        accountId,
        stockCode: holding.stockCode,
        stockName: holding.stockName,
        quantity: state.quantity,
        avgBuyPrice: state.avgBuyPrice,
        bookCostKrw: state.bookCostKrw,
        activeTradeCount: proposedTrades.length
      }
    };
  }

  const id = mbD1Text(body.investmentTradeId);
  if (!id) mbD1Fail("INVESTMENT_TRADE_ID_REQUIRED", "investmentTradeId가 필요합니다.");
  const allTrades = await mbD1Trades(env, true);
  const current = allTrades.find((item) => item.investmentTradeId === id) || null;
  if (!current) mbD1Fail("INVESTMENT_TRADE_NOT_FOUND", "투자거래를 찾을 수 없습니다.", 404);
  const account = await mbD1AccountById(env, current.accountId, false);
  const holding = await mbD1HoldingById(env, current.holdingId, false);
  if (!account || !holding) mbD1Fail("INVESTMENT_LINK_BROKEN", "연결된 투자계좌 또는 보유종목을 찾을 수 없습니다.");

  const recomputeAndWrite = async (nextTrade, action) => {
    const activeHoldingTrades = (await mbD1Trades(env, false)).filter((item) => item.holdingId === holding.holdingId && item.investmentTradeId !== id);
    if (nextTrade && !nextTrade.isDeleted) activeHoldingTrades.push(nextTrade);
    const state = mbD1SimulateHolding(holding, activeHoldingTrades);
    const activeAccountTrades = (await mbD1Trades(env, false)).filter((item) => item.accountId === account.accountId && item.investmentTradeId !== id);
    if (nextTrade && !nextTrade.isDeleted) activeAccountTrades.push(nextTrade);
    const cash = await mbD1CashForAccountWithTrades(env, account, activeAccountTrades);
    if (cash !== null && cash < -0.000001) mbD1Fail("INSUFFICIENT_INVESTMENT_CASH", "변경 결과 예수금이 음수가 됩니다.");
    const now = mbD1Now();
    const statements = [];
    if (action === "updated") {
      statements.push(env.DB.prepare(
        `UPDATE investment_trades SET trade_date=?,trade_type=?,quantity=?,unit_price=?,currency=?,fx_rate=?,fee_krw=?,tax_krw=?,settlement_krw=?,memo=?,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?`
      ).bind(nextTrade.date, nextTrade.tradeType, nextTrade.quantity, nextTrade.unitPrice, nextTrade.currency, nextTrade.fxRate, nextTrade.feeKrw, nextTrade.taxKrw, nextTrade.settlementKrw, nextTrade.memo || null, now, actor, MB_D1_HOUSEHOLD_ID, id));
    } else if (action === "deleted") {
      statements.push(env.DB.prepare(
        "UPDATE investment_trades SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?"
      ).bind(now, actor, now, actor, MB_D1_HOUSEHOLD_ID, id));
    } else if (action === "restored") {
      statements.push(env.DB.prepare(
        "UPDATE investment_trades SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?"
      ).bind(now, actor, MB_D1_HOUSEHOLD_ID, id));
    }
    for (const trade of activeHoldingTrades) {
      statements.push(env.DB.prepare("UPDATE investment_trades SET realized_pnl_krw=? WHERE household_id=? AND investment_trade_id=?").bind(state.realized.get(trade.investmentTradeId) || 0, MB_D1_HOUSEHOLD_ID, trade.investmentTradeId));
    }
    const currentPrice = holding.quoteMode === "수동" ? (holding.manualPrice || 0) : (holding.currentPrice || 0);
    const fx = holding.market === "국내" ? 1 : (holding.fx || 0);
    const valueKrw = mbD1Round(state.quantity * currentPrice * fx, 2);
    const returnRate = state.bookCostKrw > 0 ? (valueKrw - state.bookCostKrw) / state.bookCostKrw : null;
    statements.push(env.DB.prepare(
      "UPDATE holdings SET quantity=?,avg_buy_price=?,book_cost_krw=?,value_krw=?,return_rate=?,version=version+1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
    ).bind(state.quantity, state.avgBuyPrice, state.bookCostKrw, valueKrw, returnRate, now, actor, MB_D1_HOUSEHOLD_ID, holding.holdingId));
    statements.push(await mbD1InsertChange(env, "investment_trade", id, action, null, session));
    await env.DB.batch(statements);
    return state;
  };

  if (path === "/api/investments/trades/update") {
    if (current.isDeleted) mbD1Fail("INVESTMENT_TRADE_NOT_FOUND", "수정할 투자거래를 찾을 수 없습니다.", 404);
    if (!mbD1Has(body, "expectedUpdatedAtMs")) mbD1Fail("UPDATE_VERSION_REQUIRED", "투자거래의 최신 버전 정보가 필요합니다. 화면을 새로고침한 뒤 다시 시도하세요.", 409);
    const expected = body.expectedUpdatedAtMs === null || body.expectedUpdatedAtMs === "" ? null : Number(body.expectedUpdatedAtMs);
    if (expected !== current.updatedAtMs) mbD1Fail("CONCURRENT_MODIFICATION", "투자거래가 다른 기기에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 수정하세요.", 409);
    for (const [key, oldValue, label] of [["accountId", current.accountId, "투자계좌"],["holdingId", current.holdingId, "보유종목"],["stockCode", current.stockCode, "종목코드"]]) {
      if (mbD1Has(body, key) && mbD1Text(body[key]).toUpperCase() !== mbD1Text(oldValue).toUpperCase()) mbD1Fail("INVESTMENT_LINK_CHANGE_NOT_ALLOWED", `${label} 변경은 기존 거래를 삭제한 뒤 새 거래로 등록해야 합니다.`);
    }
    const model = mbD1TradeModel(body, current, account, holding, current.requestId);
    if (holding.baselineAt) {
      const baselineDate = new Date(mbD1TimestampMs(holding.baselineAt)).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      if (model.date < baselineDate) mbD1Fail("INVESTMENT_TRADE_BEFORE_BASELINE", `기준일 ${baselineDate}보다 이전의 매매는 등록할 수 없습니다.`);
    }
    const nextTrade = { ...current, ...model, investmentTradeId: id, createdAt: current.createdAt, updatedAt: mbD1Now(), isDeleted: false };
    const state = await recomputeAndWrite(nextTrade, "updated");
    const trade = (await mbD1Trades(env, true)).find((item) => item.investmentTradeId === id) || null;
    return { updated: true, investmentTradeId: id, trade, holding: { holdingId: holding.holdingId, accountId: holding.accountId, stockCode: holding.stockCode, stockName: holding.stockName, quantity: state.quantity, avgBuyPrice: state.avgBuyPrice, bookCostKrw: state.bookCostKrw, activeTradeCount: state.realized.size } };
  }

  if (path === "/api/investments/trades/delete") {
    if (current.isDeleted) return { deleted: true, alreadyDeleted: true, investmentTradeId: id };
    const state = await recomputeAndWrite(null, "deleted");
    return { deleted: true, investmentTradeId: id, holding: { holdingId: holding.holdingId, accountId: holding.accountId, stockCode: holding.stockCode, stockName: holding.stockName, quantity: state.quantity, avgBuyPrice: state.avgBuyPrice, bookCostKrw: state.bookCostKrw, activeTradeCount: state.realized.size } };
  }

  if (path === "/api/investments/trades/restore") {
    if (!current.isDeleted) return { restored: true, alreadyActive: true, investmentTradeId: id };
    const nextTrade = { ...current, isDeleted: false };
    const state = await recomputeAndWrite(nextTrade, "restored");
    const trade = (await mbD1Trades(env, true)).find((item) => item.investmentTradeId === id) || null;
    return { restored: true, investmentTradeId: id, trade, holding: { holdingId: holding.holdingId, accountId: holding.accountId, stockCode: holding.stockCode, stockName: holding.stockName, quantity: state.quantity, avgBuyPrice: state.avgBuyPrice, bookCostKrw: state.bookCostKrw, activeTradeCount: state.realized.size } };
  }

  mbD1Fail("UNSUPPORTED_INVESTMENT_ACTION", "지원하지 않는 투자거래 작업입니다.");
}

async function mbD1FetchYahooChart(symbol) {
  const clean = mbD1Text(symbol);
  if (!clean) return null;
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?range=1d&interval=1d`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 moneybook-price" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, currency: mbD1Text(meta?.currency).toUpperCase(), symbol: clean };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Cloudflare 무료 플랜은 Worker 호출 한 번당 외부 요청 수가 50개로 제한됩니다.
// 시세 갱신은 그보다 넉넉히 적은 예산 안에서만 외부 요청을 보냅니다.
const MB_D1_QUOTE_SUBREQUEST_BUDGET = 30;
// 종목 코드 조회(lookupInvestmentSymbol)는 캐시가 없으면 최대 3번 외부 요청을 보냅니다.
const MB_D1_QUOTE_LOOKUP_COST = 3;

function mbD1CreateQuoteContext() {
  return { remaining: MB_D1_QUOTE_SUBREQUEST_BUDGET, fx: new Map() };
}

function mbD1SpendQuoteBudget(context, cost = 1) {
  if (context.remaining < cost) return false;
  context.remaining -= cost;
  return true;
}

async function mbD1FxRate(currency, context) {
  const code = mbD1Text(currency).toUpperCase();
  if (!code || code === "KRW") return 1;
  if (context.fx.has(code)) return context.fx.get(code);
  const candidates = code === "USD" ? ["KRW=X", "USDKRW=X"] : [`${code}KRW=X`];
  let rate = null;
  for (const symbol of candidates) {
    if (!mbD1SpendQuoteBudget(context)) return null;
    const quote = await mbD1FetchYahooChart(symbol);
    if (quote) {
      rate = quote.price;
      break;
    }
  }
  context.fx.set(code, rate);
  return rate;
}

async function mbD1QuoteForHolding(holding, context) {
  const code = mbD1Text(holding.stockCode).toUpperCase();
  const candidates = [];
  // 메모리에 있는 조회 결과는 외부 요청을 쓰지 않으므로 예산에서 빼지 않습니다.
  const lookupCost = isInvestmentSymbolLookupCached(code) ? 0 : MB_D1_QUOTE_LOOKUP_COST;
  if (mbD1SpendQuoteBudget(context, lookupCost)) {
    try {
      const lookup = await lookupInvestmentSymbol(code);
      if (lookup?.found && lookup.symbol) candidates.push(lookup.symbol);
    } catch {}
  }
  if (holding.market === "국내" && /^\d{6}$/.test(code)) {
    candidates.push(`${code}.KS`, `${code}.KQ`);
  } else {
    candidates.push(code);
  }
  const unique = Array.from(new Set(candidates.filter(Boolean)));
  for (const symbol of unique) {
    if (!mbD1SpendQuoteBudget(context)) return null;
    const quote = await mbD1FetchYahooChart(symbol);
    if (!quote) continue;
    const fx = holding.market === "국내" ? 1 : await mbD1FxRate(quote.currency || "USD", context);
    if (fx === null) continue;
    return { price: quote.price, fx };
  }
  return null;
}

async function mbD1RefreshQuotes(env, force = false) {
  if (!env.DB) return;
  if (!force && Date.now() - mbD1LastQuoteRefreshAt < MB_D1_QUOTE_REFRESH_MS) return;
  if (mbD1QuoteRefreshPromise) return mbD1QuoteRefreshPromise;

  mbD1QuoteRefreshPromise = (async () => {
    // 갱신이 오래된 종목부터 처리해 외부 요청 예산이 모자라도 다음 호출에서 나머지가 갱신되게 합니다.
    const holdings = (await mbD1Holdings(env, false))
      .filter((holding) => holding.quoteMode === "자동")
      .sort((a, b) => (a.updatedAtMs || 0) - (b.updatedAtMs || 0));
    if (!holdings.length) {
      mbD1LastQuoteRefreshAt = Date.now();
      return;
    }

    // Worker 인스턴스가 바뀌어도 5분 간격이 지켜지도록 DB에 저장된 갱신 시각도 확인합니다.
    const oldestUpdatedAtMs = holdings[0].updatedAtMs || 0;
    if (!force && Date.now() - oldestUpdatedAtMs < MB_D1_QUOTE_REFRESH_MS) {
      mbD1LastQuoteRefreshAt = Date.now();
      return;
    }

    const context = mbD1CreateQuoteContext();
    for (const holding of holdings) {
      if (context.remaining <= 0) break;
      const quote = await mbD1QuoteForHolding(holding, context);
      if (!quote) continue;
      const valueKrw = mbD1Round(holding.quantity * quote.price * quote.fx, 2);
      const returnRate = holding.bookCostKrw > 0 ? (valueKrw - holding.bookCostKrw) / holding.bookCostKrw : null;
      await env.DB.prepare(
        "UPDATE holdings SET current_price=?,fx_rate=?,value_krw=?,return_rate=?,updated_at=? WHERE household_id=? AND holding_id=?"
      ).bind(quote.price, quote.fx, valueKrw, returnRate, mbD1Now(), MB_D1_HOUSEHOLD_ID, holding.holdingId).run();
    }

    mbD1LastQuoteRefreshAt = Date.now();
  })().finally(() => {
    mbD1QuoteRefreshPromise = null;
  });
  return mbD1QuoteRefreshPromise;
}

async function mbD1BuildBackupDocument(env) {
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

async function mbD1BackupCurrentIdSets(env) {
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

async function mbD1AssertBackupRequestIdCompatibility(validated, env) {
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

async function mbD1PreviewBackupRestore(document, env) {
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
      "복원은 여러 D1 배치로 처리되므로, 복원 직전에 현재 상태의 안전 백업을 먼저 보관합니다."
    ]
  };
}

function mbD1BackupDeletedAt(item) {
  if (item?.deletedAt) return item.deletedAt;
  return item?.isDeleted ? "1970-01-01T00:00:00.000Z" : null;
}

function mbD1BackupNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mbD1BackupNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function mbD1RunBackupBatches(env, statements, size = 40) {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size));
  }
}

function mbD1BackupMemberId(name) {
  const clean = mbD1Text(name);
  if (!clean || clean === "공동") return null;
  const bytes = encoder.encode(clean);
  return "MEM_" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mbD1RestoreBackupMerge(document, session, env) {
  const validated = validateBackupDocument(document);
  const payload = validated.payload;
  const now = mbD1Now();
  const actor = session?.name || "restore";
  await mbD1EnsureBenefitUsageSchema(env);
  await ensureRealEstateSchema(env);
  await mbD1AssertBackupRequestIdCompatibility(validated, env);

  let restoreStarted = false;
  try {
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
    restoreStarted = true;
    await mbD1RunBackupBatches(env, memberStatements);

  const ledgerStartDate = payload.bootstrap?.ledgerConfig?.ledgerStartDate || null;
  await env.DB.prepare(
    "UPDATE households SET ledger_start_date=?,updated_at=? WHERE household_id=?"
  ).bind(ledgerStartDate, now, MB_D1_HOUSEHOLD_ID).run();

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
  await mbD1RunBackupBatches(env, categoryStatements);

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
  await mbD1RunBackupBatches(env, accountBaseStatements);

  const accountLinkStatements = payload.accounts
    .filter((item) => item.paymentAccountId)
    .map((item) => env.DB.prepare(
      "UPDATE accounts SET payment_account_id=? WHERE household_id=? AND account_id=?"
    ).bind(item.paymentAccountId, MB_D1_HOUSEHOLD_ID, item.accountId));
  await mbD1RunBackupBatches(env, accountLinkStatements);

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
  await mbD1RunBackupBatches(env, holdingStatements);

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
  await mbD1RunBackupBatches(env, transactionStatements);

  const reversalStatements = payload.transactions
    .filter((item) => item.reversalOf)
    .map((item) => env.DB.prepare(
      "UPDATE transactions SET reversal_of=? WHERE household_id=? AND transaction_id=?"
    ).bind(item.reversalOf, MB_D1_HOUSEHOLD_ID, item.transactionId));
  await mbD1RunBackupBatches(env, reversalStatements);

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
  await mbD1RunBackupBatches(env, tradeStatements);

  const snapshotStatements = payload.assetSnapshots.map((item) => env.DB.prepare(
    `INSERT INTO asset_snapshots (household_id,month,assets,liabilities,net_worth,investment_value,cash_like_value,created_at,updated_at,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(household_id,month) DO UPDATE SET assets=excluded.assets,liabilities=excluded.liabilities,net_worth=excluded.net_worth,investment_value=excluded.investment_value,cash_like_value=excluded.cash_like_value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
  ).bind(
    MB_D1_HOUSEHOLD_ID, item.month, mbD1BackupNumber(item.assets), mbD1BackupNumber(item.liabilities), mbD1BackupNumber(item.netWorth),
    mbD1BackupNumber(item.investmentValue), mbD1BackupNumber(item.cashLikeValue), item.createdAt || now, item.updatedAt || now,
    item.createdBy || actor, item.updatedBy || actor
  ));
  await mbD1RunBackupBatches(env, snapshotStatements);

  const inputState = payload.bootstrap?.inputPreferences;
  if (inputState?.preferences) {
    await env.DB.prepare(
      `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
    ).bind(
      "PREF_INPUT_SHARED", MB_D1_HOUSEHOLD_ID, null, "input_preferences", JSON.stringify(inputState.preferences),
      Number(inputState.version) || 1, inputState.updatedAt || now, inputState.updatedAt || now
    ).run();
  } else if (inputState?.configured === false) {
    await env.DB.prepare(
      "DELETE FROM user_preferences WHERE household_id=? AND preference_key='input_preferences'"
    ).bind(MB_D1_HOUSEHOLD_ID).run();
  }

  const automationSettings = payload.bootstrap?.automationSettings;
  if (automationSettings) {
    const normalized = mbD1NormalizeAutomationSettings(automationSettings);
    mbD1ValidateAutomationSettings(normalized);
    await env.DB.prepare(
      `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
    ).bind(MB_D1_AUTOMATION_PREF_ID, MB_D1_HOUSEHOLD_ID, null, MB_D1_AUTOMATION_PREF_KEY, JSON.stringify(normalized), 1, now, now).run();
  }

  if (validated.version >= 2) {
    const deleteUsageStatements = payload.transactions.map((item) => env.DB.prepare(
      "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
    ).bind(MB_D1_HOUSEHOLD_ID, item.transactionId));
    await mbD1RunBackupBatches(env, deleteUsageStatements);

    const usageStatements = (payload.benefitRewardUsage || []).map((item) => env.DB.prepare(
      `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(transaction_id) DO UPDATE SET rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
    ).bind(
      item.transactionId, MB_D1_HOUSEHOLD_ID, item.ruleId, item.accountId, mbD1BackupNumber(item.usedAmount), item.createdAt || now, item.updatedAt || now
    ));
    await mbD1RunBackupBatches(env, usageStatements);
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
    await mbD1RunBackupBatches(env, realEstateStatements);
  }

  // change_log.action은 created/updated/deleted/restored만 허용하므로 결과 종류는 payload에 남깁니다.
  const change = await mbD1InsertChange(env, "backup_restore", `restore-${Date.now()}`, "updated", null, session, {
    result: "merged",
    version: validated.version,
    exportedAt: validated.exportedAt,
    summary: validated.summary
  });
  await env.DB.batch([change]);

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
  } catch (error) {
    if (restoreStarted) {
      try {
        const failureChange = await mbD1InsertChange(
          env,
          "backup_restore",
          `restore-failed-${Date.now()}`,
          "updated",
          null,
          session,
          {
            result: "partial_failure",
            version: validated.version,
            exportedAt: validated.exportedAt,
            summary: validated.summary
          }
        );
        await env.DB.batch([failureChange]);
      } catch {
        // 원래 복원 오류를 보존합니다.
      }
    }
    throw error;
  }
}


async function mbD1AnalyzeImportedTransactions(body, session, env) {
  const analysisPromise = analyzeTransactionImport(env, {
    text: body.text,
    images: body.images,
    today: mbD1CurrentDateSeoul()
  }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  const categoriesPromise = mbD1All(
    env,
    "SELECT * FROM categories WHERE household_id=? AND type='지출' AND deleted_at IS NULL AND is_active=1 ORDER BY name",
    [MB_D1_HOUSEHOLD_ID]
  ).then((rows) => rows.map(mbD1MapCategory));
  const accountsPromise = mbD1RawAccounts(env).then((rows) => rows.map(mbD1MapAccountRow));
  const recentTransactionsPromise = mbD1RecentExpenseTransactions(env, 800);
  const membersPromise = mbD1Members(env);

  const [analysisResult, categories, accounts, recentTransactions, memberRows] = await Promise.all([
    analysisPromise,
    categoriesPromise,
    accountsPromise,
    recentTransactionsPromise,
    membersPromise
  ]);
  const paymentMethods = accounts.filter((account) =>
    account.active && !account.isDeleted && ["신용카드", "체크카드", "선불/지역화폐"].includes(account.subType)
  );

  let extracted;
  try {
    if (!analysisResult.ok) throw analysisResult.error;
    extracted = analysisResult.value;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error || "");
    const looksLikeLimit = error?.status === 429 || /(?:429|quota|rate.?limit|neuron|usage.?limit|too many requests)/i.test(rawMessage);
    if (looksLikeLimit) {
      mbD1Fail("AI_DAILY_LIMIT", "오늘 사용할 수 있는 AI 분석량을 모두 사용했습니다. 무료 할당량이 초기화된 뒤 다시 이용해주세요.", 429);
    }
    const code = error?.code || "AI_ANALYSIS_FAILED";
    const message = rawMessage || "거래 내역을 분석하지 못했습니다.";
    mbD1Fail(code, message, code === "AI_NOT_BOUND" ? 503 : 400);
  }

  const memberNames = memberRows.map((row) => mbD1Text(row.display_name)).filter(Boolean);
  const defaultTarget = memberNames.includes(session?.name) ? session.name : "공동";
  return {
    model: "@cf/moondream/moondream3.1-9B-A2B",
    items: extracted.map((candidate) => {
      let paymentMethod = mbImportChoosePaymentMethod(candidate.cardName, paymentMethods);
      if (!paymentMethod && paymentMethods.length === 1) paymentMethod = paymentMethods[0];
      const categoryMatch = mbImportChooseCategory(candidate, categories, recentTransactions);
      const duplicate = candidate.kind === "expense"
        ? mbImportFindDuplicate(candidate, recentTransactions, paymentMethod?.accountId || null)
        : null;
      const reasons = [];
      if (!candidate.date) reasons.push("날짜 확인 필요");
      if (!candidate.amount) reasons.push("금액 확인 필요");
      if (!candidate.merchant) reasons.push("가맹점 확인 필요");
      if (!paymentMethod) reasons.push("결제수단 선택 필요");
      if (!categoryMatch.category) reasons.push("카테고리 선택 필요");
      if (candidate.confidence === "low") reasons.push("인식 결과 확인 필요");
      if (duplicate) reasons.push("중복 거래 의심");
      if (candidate.kind === "refund") reasons.push("취소/환불은 원거래 연결 확인 필요");
      return {
        ...candidate,
        categoryId: categoryMatch.category?.categoryId || null,
        categoryName: categoryMatch.category?.name || "",
        categorySuggestionSource: categoryMatch.source,
        paymentMethodId: paymentMethod?.accountId || null,
        paymentMethodName: paymentMethod?.displayName || "",
        spendingTarget: defaultTarget,
        duplicate: duplicate ? {
          transactionId: duplicate.transactionId,
          date: duplicate.date,
          amount: duplicate.amount,
          description: duplicate.description,
          paymentMethod: duplicate.paymentMethod,
          category: duplicate.category
        } : null,
        selected: candidate.kind === "expense" && reasons.length === 0,
        reviewReasons: reasons
      };
    })
  };
}

async function mbD1GetRealEstateData(env) {
  const items = await listRealEstateAssets(env, MB_D1_HOUSEHOLD_ID, false);
  return realEstateSummary(items);
}

async function mbD1SaveRealEstate(body, session, env) {
  let result;
  try {
    result = await saveRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, body, session.name, mbD1Now());
  } catch (error) {
    mbD1Fail(error?.code || "REAL_ESTATE_SAVE_FAILED", error instanceof Error ? error.message : "부동산 자산을 저장하지 못했습니다.");
  }
  const change = await mbD1InsertChange(env, "real_estate", result.item.propertyId, result.created ? "created" : "updated", null, session, {
    name: result.item.name,
    currentValueKrw: result.item.currentValueKrw
  });
  await env.DB.batch([change]);
  return result;
}

async function mbD1DeleteRealEstate(body, session, env) {
  const propertyId = mbD1Text(body.propertyId);
  if (!propertyId) mbD1Fail("REAL_ESTATE_ID_REQUIRED", "부동산 자산 ID가 필요합니다.");
  const result = await deleteRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, propertyId, session.name, mbD1Now());
  const change = await mbD1InsertChange(env, "real_estate", propertyId, "deleted", null, session, {});
  await env.DB.batch([change]);
  return result;
}

async function mbD1RefreshRealEstate(body, session, env) {
  const propertyId = mbD1Text(body.propertyId);
  if (!propertyId) mbD1Fail("REAL_ESTATE_ID_REQUIRED", "부동산 자산 ID가 필요합니다.");
  let item;
  try {
    item = await refreshRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, propertyId, session.name, mbD1Now(), mbD1CurrentDateSeoul());
  } catch (error) {
    mbD1Fail(error?.code || "REAL_ESTATE_REFRESH_FAILED", error instanceof Error ? error.message : "아파트 실거래 시세를 갱신하지 못했습니다.", 400);
  }
  try {
    const change = await mbD1InsertChange(env, "real_estate", propertyId, "updated", null, session, {
      refresh: true,
      estimatedValueKrw: item.estimatedValueKrw,
      tradeCount: item.estimateTradeCount
    });
    await env.DB.batch([change]);
  } catch (error) {
    console.error("real estate refresh change-log failed", propertyId, error);
    mbD1Fail(
      "REAL_ESTATE_CHANGE_LOG_FAILED",
      error instanceof Error
        ? `시세는 갱신됐지만 변경 이력 저장에 실패했습니다: ${error.message}`
        : "시세는 갱신됐지만 변경 이력 저장에 실패했습니다.",
      500
    );
  }
  return { refreshed: true, item };
}

// ── 연말정산 도우미 ───────────────────────────────────────────

function mbD1TaxYear(value) {
  const text = mbD1Text(value);
  if (!text) return Number(mbD1CurrentYearSeoul());
  const year = Number(text);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    mbD1Fail("INVALID_TAX_YEAR", "연도가 올바르지 않습니다.");
  }
  return year;
}

async function mbD1TaxSummaryData(env, url) {
  const year = mbD1TaxYear(url.searchParams.get("year"));
  const rules = getTaxRules(year);

  const [memberRows, rawAccounts, categoryRows, profileRows, transactionRows] = await Promise.all([
    mbD1Members(env),
    mbD1RawAccounts(env),
    mbD1All(
      env,
      "SELECT category_id,name,type,default_tax_category_code FROM categories WHERE household_id=? AND deleted_at IS NULL AND type IN ('지출','수입') ORDER BY name",
      [MB_D1_HOUSEHOLD_ID]
    ),
    mbD1All(
      env,
      "SELECT member_id,gross_salary_krw,profile_json FROM tax_year_profiles WHERE household_id=? AND tax_year=?",
      [MB_D1_HOUSEHOLD_ID, year]
    ),
    mbD1All(
      env,
      `${MB_D1_TRANSACTION_SELECT}
       WHERE t.household_id=? AND t.deleted_at IS NULL AND t.type IN ('지출','수입') AND t.date BETWEEN ? AND ?`,
      [MB_D1_HOUSEHOLD_ID, `${year}-01-01`, `${year}-12-31`]
    )
  ]);

  const members = memberRows
    .map((row) => ({ memberId: mbD1Text(row.member_id), name: mbD1Text(row.display_name) }))
    .filter((member) => member.name);
  const profiles = new Map(profileRows.map((row) => {
    let extra = {};
    try { extra = JSON.parse(row.profile_json || "{}") || {}; } catch { extra = {}; }
    return [mbD1Text(row.member_id), { grossSalary: mbD1Number(row.gross_salary_krw, 0), children: mbD1Number(extra.children, 0) }];
  }));

  const expenseCategoryRows = categoryRows.filter((row) => row.type === "지출");
  const incomeCategoryRows = categoryRows.filter((row) => row.type === "수입");
  const categoryTaxCodes = new Map(
    expenseCategoryRows.map((row) => [mbD1Text(row.category_id), isValidTaxCode(row.default_tax_category_code) ? mbD1Text(row.default_tax_category_code) : ""])
  );
  const incomeCodeOf = (row) => {
    const code = mbD1Text(row.default_tax_category_code);
    return Object.prototype.hasOwnProperty.call(INCOME_TAX_CODES, code) ? code : "";
  };
  const salaryCategoryIds = new Set(
    incomeCategoryRows
      .filter((row) => isSalaryCategory(row.name, incomeCodeOf(row)))
      .map((row) => mbD1Text(row.category_id))
  );
  const accounts = rawAccounts.map(mbD1MapAccountRow);
  const transactions = transactionRows.map(mbD1MapTransactionRow);
  const memberNames = members.map((member) => member.name);
  const people = aggregateYearSpending({ year, members: memberNames, accounts, categoryTaxCodes, transactions });
  const salaries = summarizeSalaryIncome({
    year,
    members: memberNames,
    accounts,
    salaryCategoryIds,
    transactions,
    currentMonth: mbD1CurrentMonthSeoul()
  });

  const memberResults = members.map((member) => {
    const profile = profiles.get(member.memberId) || { grossSalary: 0, children: 0 };
    const aggregated = people.get(member.name);
    const salaryIncome = salaries.get(member.name) || null;
    // 직접 입력한 총급여가 우선이고, 없으면 가계부 급여 수입으로 추정한 값으로 계산합니다.
    const salarySource = profile.grossSalary > 0
      ? "profile"
      : salaryIncome?.estimatedGross > 0 ? "estimate" : "none";
    const salary = salarySource === "profile"
      ? profile.grossSalary
      : salarySource === "estimate" ? salaryIncome.estimatedGross : 0;
    return {
      name: member.name,
      grossSalary: profile.grossSalary,
      children: profile.children,
      salarySource,
      salaryUsed: salary,
      salaryIncome,
      card: computeCardDeduction({ salary, children: profile.children, usage: aggregated.usage }, rules),
      medicalThreshold: Math.round(salary * rules.medicalThresholdRate),
      items: aggregated.items
    };
  });

  const unassigned = people.get("명의 미지정") || null;

  return {
    year,
    rules: {
      estimated: rules.estimated,
      basedOnYear: rules.basedOnYear || year,
      thresholdRate: rules.thresholdRate,
      rates: rules.rates,
      medicalThresholdRate: rules.medicalThresholdRate
    },
    members: memberResults,
    unassigned: unassigned ? { usage: unassigned.usage, items: unassigned.items } : null,
    categories: expenseCategoryRows.map((row) => ({
      categoryId: mbD1Text(row.category_id),
      name: mbD1Text(row.name),
      taxCode: categoryTaxCodes.get(mbD1Text(row.category_id)) || ""
    })),
    incomeCategories: incomeCategoryRows.map((row) => ({
      categoryId: mbD1Text(row.category_id),
      name: mbD1Text(row.name),
      taxCode: incomeCodeOf(row),
      countedAsSalary: salaryCategoryIds.has(mbD1Text(row.category_id))
    })),
    taxCodes: Object.entries(TAX_CODES).map(([code, meta]) => ({ code, label: meta.label })),
    incomeTaxCodes: Object.entries(INCOME_TAX_CODES).map(([code, label]) => ({ code, label })),
    recommendations: buildRecommendations(memberResults, rules)
  };
}

async function mbD1HandleTaxProfile(body, session, env) {
  const year = mbD1TaxYear(body.year);
  const memberName = mbD1Text(body.memberName);
  const member = await mbD1MemberByName(env, memberName);
  if (!member) mbD1Fail("MEMBER_NOT_FOUND", "구성원을 찾을 수 없습니다.", 404);
  const grossSalary = Math.round(Number(body.grossSalary));
  if (!Number.isFinite(grossSalary) || grossSalary < 0 || grossSalary > 10_000_000_000) {
    mbD1Fail("INVALID_GROSS_SALARY", "총급여를 올바르게 입력해주세요.");
  }
  const children = Math.trunc(Number(body.children ?? 0));
  if (!Number.isFinite(children) || children < 0 || children > 20) {
    mbD1Fail("INVALID_CHILDREN", "자녀 수를 올바르게 입력해주세요.");
  }
  const memberId = mbD1Text(member.member_id);
  const now = mbD1Now();
  const upsert = env.DB.prepare(
    `INSERT INTO tax_year_profiles (household_id,member_id,tax_year,gross_salary_krw,profile_json,updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(household_id,member_id,tax_year) DO UPDATE SET
       gross_salary_krw=excluded.gross_salary_krw,profile_json=excluded.profile_json,updated_at=excluded.updated_at`
  ).bind(MB_D1_HOUSEHOLD_ID, memberId, year, grossSalary, JSON.stringify({ children }), now);
  const change = await mbD1InsertChange(env, "tax_profile", `${memberId}:${year}`, "updated", null, session, { year });
  await env.DB.batch([upsert, change]);
  return { saved: true, year, memberName, grossSalary, children };
}

async function mbD1HandleTaxCategory(body, session, env) {
  const categoryId = mbD1Text(body.categoryId);
  const taxCode = mbD1Text(body.taxCode);
  const category = await mbD1First(
    env,
    "SELECT category_id,type FROM categories WHERE household_id=? AND category_id=? AND type IN ('지출','수입') AND deleted_at IS NULL",
    [MB_D1_HOUSEHOLD_ID, categoryId]
  );
  if (!category) mbD1Fail("CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없습니다.", 404);
  const validCode = category.type === "수입"
    ? Object.prototype.hasOwnProperty.call(INCOME_TAX_CODES, taxCode)
    : isValidTaxCode(taxCode);
  if (!validCode) mbD1Fail("INVALID_TAX_CODE", "연말정산 분류가 올바르지 않습니다.");
  const now = mbD1Now();
  const update = env.DB.prepare(
    "UPDATE categories SET default_tax_category_code=?,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
  ).bind(taxCode || null, now, session.name, MB_D1_HOUSEHOLD_ID, categoryId);
  const change = await mbD1InsertChange(env, "category", categoryId, "updated", null, session, { taxCode });
  await env.DB.batch([update, change]);
  return { saved: true, categoryId, taxCode };
}

// 추천 카테고리 정리: apply=false면 바뀔 내용만 돌려주고, true면 적용합니다.
async function mbD1HandleTaxPreset(body, session, env) {
  const [rows, automation] = await Promise.all([
    mbD1All(
      env,
      "SELECT category_id,name,type,is_active,default_tax_category_code,deleted_at FROM categories WHERE household_id=?",
      [MB_D1_HOUSEHOLD_ID]
    ),
    mbD1AutomationSettingsData(env)
  ]);
  const plan = planCategoryPreset(
    rows.map((row) => ({
      categoryId: mbD1Text(row.category_id),
      name: mbD1Text(row.name),
      type: mbD1Text(row.type),
      taxCode: mbD1Text(row.default_tax_category_code),
      deleted: Boolean(row.deleted_at),
      active: mbD1Bool(row.is_active)
    })),
    { referencedCategoryIds: collectReferencedCategoryIds(automation) }
  );

  if (body.apply !== true) return { applied: false, ...plan };

  const actor = session.name;
  const now = mbD1Now();
  const statements = [];
  for (const item of plan.renames) {
    statements.push(
      env.DB.prepare(
        `UPDATE categories SET name=?,
           default_tax_category_code=CASE WHEN ? IS NOT NULL AND (default_tax_category_code IS NULL OR default_tax_category_code='') THEN ? ELSE default_tax_category_code END,
           updated_at=?,updated_by=?
         WHERE household_id=? AND category_id=? AND name=? AND deleted_at IS NULL`
      ).bind(item.to, item.taxCode, item.taxCode, now, actor, MB_D1_HOUSEHOLD_ID, item.categoryId, item.from),
      await mbD1InsertChange(env, "category", item.categoryId, "updated", null, session, { from: item.from, name: item.to })
    );
  }
  for (const item of plan.links) {
    statements.push(
      env.DB.prepare(
        "UPDATE categories SET default_tax_category_code=?,updated_at=?,updated_by=? WHERE household_id=? AND category_id=? AND (default_tax_category_code IS NULL OR default_tax_category_code='')"
      ).bind(item.taxCode, now, actor, MB_D1_HOUSEHOLD_ID, item.categoryId),
      await mbD1InsertChange(env, "category", item.categoryId, "updated", null, session, { taxCode: item.taxCode })
    );
  }
  for (const item of plan.deactivations) {
    statements.push(
      env.DB.prepare(
        "UPDATE categories SET is_active=0,updated_at=?,updated_by=? WHERE household_id=? AND category_id=? AND deleted_at IS NULL"
      ).bind(now, actor, MB_D1_HOUSEHOLD_ID, item.categoryId),
      await mbD1InsertChange(env, "category", item.categoryId, "updated", null, session, { active: false })
    );
  }
  for (const item of plan.creates) {
    const id = mbD1Id("CAT");
    statements.push(
      env.DB.prepare(
        "INSERT INTO categories (category_id,household_id,type,name,is_active,default_tax_category_code,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,1,?,?,?,?,?,NULL,NULL,NULL)"
      ).bind(id, MB_D1_HOUSEHOLD_ID, item.type, item.name, item.taxCode || null, now, now, actor, actor),
      await mbD1InsertChange(env, "category", id, "created", 1, session, { type: item.type, name: item.name, taxCode: item.taxCode })
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return { applied: true, ...plan };
}

// 할부 개월 수 칸(installment_months)이 없던 기존 DB에 한 번만 추가합니다.
const mbD1InstallmentSchemaReadyFor = new WeakSet();

async function mbD1EnsureInstallmentSchema(env) {
  if (!env.DB || mbD1InstallmentSchemaReadyFor.has(env.DB)) return;
  const columns = await mbD1All(env, "PRAGMA table_info(transactions)", []);
  if (!columns.some((column) => column.name === "installment_months")) {
    try {
      await env.DB.prepare("ALTER TABLE transactions ADD COLUMN installment_months INTEGER").run();
    } catch (error) {
      // 다른 요청이 동시에 먼저 추가한 경우만 무시합니다.
      if (!/duplicate column/i.test(String(error?.message || error))) throw error;
    }
  }
  mbD1InstallmentSchemaReadyFor.add(env.DB);
}

async function mbD1ProductionRoute(request, url, session, env, ctx) {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const getPaths = new Set([
    "/api/bootstrap",
    "/api/dashboard",
    "/api/categories",
    "/api/accounts",
    "/api/settings/ledger-config",
    "/api/settings/automation",
    "/api/benefits/reward-balances",
    "/api/transactions",
    "/api/transactions/settlement-summary",
    "/api/asset-snapshots",
    "/api/investments/accounts",
    "/api/investments/holdings",
    "/api/investments/trades",
    "/api/investments/cash",
    "/api/real-estate",
    "/api/real-estate/regions",
    "/api/backup/export",
    "/api/push/config",
    "/api/tax/summary"
  ]);
  const postPaths = new Set([
    "/api/transactions",
    "/api/transactions/update",
    "/api/transactions/delete",
    "/api/transactions/restore",
    "/api/transactions/settle",
    "/api/categories",
    "/api/categories/update",
    "/api/categories/delete",
    "/api/categories/restore",
    "/api/accounts",
    "/api/accounts/update",
    "/api/accounts/delete",
    "/api/accounts/restore",
    "/api/settings/ledger-start-date",
    "/api/settings/ledger-start-date/clear",
    "/api/settings/input-preferences",
    "/api/settings/automation",
    "/api/automations/recurring/process",
    "/api/automations/recurring/create",
    "/api/benefits/preview",
    "/api/asset-snapshots",
    "/api/investments/cash-baseline",
    "/api/investments/holdings/update",
    "/api/investments/trades",
    "/api/investments/trades/update",
    "/api/investments/trades/delete",
    "/api/investments/trades/restore",
    "/api/import/transactions/analyze",
    "/api/real-estate/save",
    "/api/real-estate/delete",
    "/api/real-estate/refresh",
    "/api/backup/preview",
    "/api/backup/restore",
    "/api/push/subscribe",
    "/api/push/unsubscribe",
    "/api/push/test",
    "/api/tax/profile",
    "/api/tax/category",
    "/api/tax/preset"
  ]);
  if (request.method === "GET" && !getPaths.has(path)) return null;
  if (request.method === "POST" && !postPaths.has(path)) return null;
  if (!["GET", "POST"].includes(request.method)) return null;
  if (!env.DB) {
    return errorResponse(
      "D1_NOT_BOUND",
      "D1 바인딩 DB가 연결되어 있지 않습니다. Cloudflare Bindings에서 DB를 moneybook-prod에 연결해주세요.",
      500
    );
  }
  try {
    await mbD1EnsureInstallmentSchema(env);
    if (request.method === "GET") {
      if (path === "/api/bootstrap") return mbD1Envelope(await mbD1BuildBootstrap(env));
      if (path === "/api/dashboard") {
        const refreshQuotes = url.searchParams.get("refreshQuotes") === "1";

        if (refreshQuotes) {
          await mbD1RefreshQuotes(env, true);
        } else if (ctx?.waitUntil) {
          ctx.waitUntil(mbD1RefreshQuotes(env, false));
        }

        return mbD1Envelope(await mbD1BuildDashboard(env, mbD1Text(url.searchParams.get("month"))));
      }
      if (path === "/api/categories") return mbD1Envelope(await mbD1GetCategoriesData(env, url));
      if (path === "/api/accounts") return mbD1Envelope(await mbD1GetAccountsData(env, url));
      if (path === "/api/settings/ledger-config") return mbD1Envelope(await mbD1GetLedgerConfigData(env));
      if (path === "/api/settings/automation") return mbD1Envelope(await mbD1AutomationSettingsData(env));
      if (path === "/api/benefits/reward-balances") return mbD1Envelope(await mbD1BenefitRewardBalancesData(env));
      if (path === "/api/transactions/settlement-summary") {
        const transactionId = mbD1Text(url.searchParams.get("transactionId"));
        if (!transactionId) mbD1Fail("TRANSACTION_ID_REQUIRED", "transactionId가 필요합니다.");
        return mbD1Envelope(await mbD1SettlementSummaryData(env, transactionId));
      }
      if (path === "/api/transactions") return mbD1Envelope(await mbD1GetTransactionsData(env, url));
      if (path === "/api/asset-snapshots") return mbD1Envelope(await mbD1GetAssetSnapshotsData(env, url));
      if (path === "/api/investments/accounts") return mbD1Envelope(await mbD1GetInvestmentAccountsData(env));
      if (path === "/api/investments/holdings") {
        if (ctx?.waitUntil) ctx.waitUntil(mbD1RefreshQuotes(env, false));
        return mbD1Envelope(await mbD1GetHoldingsData(env, url));
      }
      if (path === "/api/investments/trades") return mbD1Envelope(await mbD1GetTradesData(env, url));
      if (path === "/api/investments/cash") return mbD1Envelope(await mbD1GetInvestmentCashData(env, url));
      if (path === "/api/real-estate") return mbD1Envelope(await mbD1GetRealEstateData(env));
      if (path === "/api/real-estate/regions") {
        let items;
        try {
          items = await resolveLegalRegion(env, mbD1Text(url.searchParams.get("q")));
        } catch (error) {
          mbD1Fail(error?.code || "REGION_LOOKUP_FAILED", error instanceof Error ? error.message : "주소의 지역코드를 찾지 못했습니다.", 400);
        }
        return mbD1Envelope({ items });
      }
      if (path === "/api/backup/export") return mbD1Envelope(await mbD1BuildBackupDocument(env));
      if (path === "/api/push/config") return mbD1Envelope(await getPushConfig(env, MB_D1_HOUSEHOLD_ID, session));
      if (path === "/api/tax/summary") return mbD1Envelope(await mbD1TaxSummaryData(env, url));
    }
    if (!isSameOrigin(request)) return errorResponse("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
    const allowEmpty = path === "/api/settings/ledger-start-date/clear";
    const body = await readJsonObject(request, { allowEmptyBody: allowEmpty });
    if (!body) return errorResponse("INVALID_JSON", "요청 형식이 올바르지 않습니다.", 400);

    // 알림 구독은 가계부 데이터를 바꾸지 않으므로 실시간 동기화 신호 없이 바로 응답합니다.
    if (path === "/api/push/subscribe") {
      return mbD1Envelope(await savePushSubscription(env, MB_D1_HOUSEHOLD_ID, session, body, request.headers.get("User-Agent")));
    }
    if (path === "/api/push/unsubscribe") {
      return mbD1Envelope(await deletePushSubscription(env, MB_D1_HOUSEHOLD_ID, session, body));
    }
    if (path === "/api/push/test") {
      return mbD1Envelope(await sendTestPush(env, MB_D1_HOUSEHOLD_ID, session, url.origin));
    }

    let data;
    if (path.startsWith("/api/transactions")) data = await mbD1HandleTransactionMutation(path, body, session, env);
    else if (path.startsWith("/api/categories")) data = await mbD1HandleCategoryMutation(path, body, session, env);
    else if (path.startsWith("/api/accounts")) data = await mbD1HandleAccountMutation(path, body, session, env);
    else if (path.startsWith("/api/settings/ledger-start-date")) data = await mbD1HandleLedgerConfig(path, body, session, env);
    else if (path === "/api/settings/input-preferences") data = await mbD1HandleInputPreferences(body, session, env);
    else if (path === "/api/settings/automation") data = await mbD1HandleAutomationSettings(body, session, env);
    else if (path === "/api/automations/recurring/process") data = await mbD1ProcessRecurring(env, session, {});
    else if (path === "/api/automations/recurring/create") data = await mbD1ProcessRecurring(env, session, { ruleId: body.ruleId, month: body.month });
    else if (path === "/api/benefits/preview") data = await mbD1PreviewBenefit(env, body);
    else if (path === "/api/asset-snapshots") data = await mbD1HandleAssetSnapshot(body, session, env);
    else if (path === "/api/investments/cash-baseline") data = await mbD1HandleCashBaseline(body, session, env);
    else if (path === "/api/investments/holdings/update") data = await mbD1HandleHoldingUpdate(body, session, env);
    else if (path.startsWith("/api/investments/trades")) data = await mbD1HandleTradeMutation(path, body, session, env, ctx);
    else if (path === "/api/import/transactions/analyze") data = await mbD1AnalyzeImportedTransactions(body, session, env);
    else if (path === "/api/real-estate/save") data = await mbD1SaveRealEstate(body, session, env);
    else if (path === "/api/real-estate/delete") data = await mbD1DeleteRealEstate(body, session, env);
    else if (path === "/api/real-estate/refresh") data = await mbD1RefreshRealEstate(body, session, env);
    else if (path === "/api/tax/profile") data = await mbD1HandleTaxProfile(body, session, env);
    else if (path === "/api/tax/category") data = await mbD1HandleTaxCategory(body, session, env);
    else if (path === "/api/tax/preset") data = await mbD1HandleTaxPreset(body, session, env);
    else if (path === "/api/backup/preview") data = await mbD1PreviewBackupRestore(body.backup, env);
    else if (path === "/api/backup/restore") {
      if (body.confirm !== "RESTORE_MERGE") mbD1Fail("BACKUP_RESTORE_CONFIRM_REQUIRED", "복원 확인 문구가 올바르지 않습니다.", 400);
      data = await mbD1RestoreBackupMerge(body.backup, session, env);
    }
    else return null;
    if (ctx?.waitUntil) {
      ctx.waitUntil(mbD1RealtimePoke(env, { path, changedBy: session?.name || null }));
      // 새 거래가 실제로 만들어졌을 때만(중복 재전송 제외) 배우자 기기에 알림을 보냅니다.
      if (path === "/api/transactions" && data?.created && !data?.duplicate && session?.name) {
        ctx.waitUntil(
          mbD1QueuePartnerPush(env, session.name, data.transaction, url.origin)
            .catch((error) => console.warn("[moneybook push] notify failed", error))
        );
      }
    }
    return mbD1Envelope(data);
  } catch (error) {
    if (error instanceof MbD1Error) {
      return errorResponse(error.code, error.message, error.status || 400);
    }
    if (error instanceof PushError) {
      return errorResponse(error.code, error.message, error.status || 400);
    }
    if (error instanceof BackupValidationError) {
      return errorResponse(error.code || "BACKUP_INVALID", error.message, 400);
    }
    throw error;
  }
}


/**
 * 배우자 알림을 바로 보내지 않고 실시간 Durable Object의 대기열에 넣습니다.
 * 잠깐(PUSH_BATCH_QUIET_MS) 더 입력이 없으면 그동안 모인 거래를 알림 하나로 보냅니다.
 * Durable Object를 쓸 수 없으면 예전처럼 바로 한 건씩 보냅니다.
 */
async function mbD1QueuePartnerPush(env, actorName, transaction, origin) {
  if (!transaction) return;
  const stub = await getHouseholdRealtimeStub(env);
  if (stub) {
    try {
      const response = await stub.fetch("https://moneybook-realtime.internal/push/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: actorName,
          origin,
          transaction: summarizeTransactionForPush(transaction)
        })
      });
      if (response.ok) return;
    } catch (error) {
      console.warn("[moneybook push] queue failed, sending directly", error);
    }
  }
  await notifyPartnersOfTransaction(env, MB_D1_HOUSEHOLD_ID, actorName, transaction, origin);
}

const MB_PUSH_PENDING_KEY = "push-pending:v1";
const MB_PUSH_MAX_RETRIES = 3;
const MB_PUSH_RETRY_DELAY_MS = 30_000;

export class HouseholdRealtime extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/auth/rate-limit/")
    ) {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid request" }, { status: 400 });
      }

      const key = String(body?.key || "").trim().slice(0, 200);
      if (!key) {
        return Response.json({ error: "missing key" }, { status: 400 });
      }

      const storageKey = `login-rate:${key}`;
      const current = await this.ctx.storage.get(storageKey);
      const now = Date.now();

      if (url.pathname.endsWith("/check")) {
        const status = getLoginRateLimitStatus(current, now);
        if (!status.blocked && current) {
          if (status.record.failures.length > 0) {
            await this.ctx.storage.put(storageKey, status.record);
          } else {
            await this.ctx.storage.delete(storageKey);
          }
        }
        return Response.json({
          blocked: status.blocked,
          retryAfterSeconds: Math.max(0, Math.ceil(status.retryAfterMs / 1000))
        });
      }

      if (url.pathname.endsWith("/failure")) {
        const next = recordLoginFailureState(current, now);
        await this.ctx.storage.put(storageKey, next);
        return Response.json({ ok: true });
      }

      if (url.pathname.endsWith("/success")) {
        await this.ctx.storage.delete(storageKey);
        return Response.json({ ok: true });
      }

      return Response.json({ error: "unknown action" }, { status: 404 });
    }

    if (request.method === "POST" && url.pathname === "/push/enqueue") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid request" }, { status: 400 });
      }
      if (!body?.actor || !body?.transaction) {
        return Response.json({ error: "missing fields" }, { status: 400 });
      }
      const current = (await this.ctx.storage.get(MB_PUSH_PENDING_KEY)) || [];
      const { pending, sendAt } = scheduleBatchedPush(current, {
        actor: String(body.actor),
        origin: String(body.origin || ""),
        transaction: body.transaction
      });
      await this.ctx.storage.put(MB_PUSH_PENDING_KEY, pending);
      await this.ctx.storage.setAlarm(sendAt);
      return Response.json({ queued: pending.length, sendAt });
    }

    if (request.method === "POST" && url.pathname === "/broadcast") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        payload = { type: "ledger.poke" };
      }
      const message = JSON.stringify(payload || { type: "ledger.poke" });
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(message); } catch { }
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    if (typeof message === "string" && message === "ping") {
      try { socket.send("pong"); } catch { }
    }
  }

  webSocketClose() {
  }

  async alarm() {
    const pending = (await this.ctx.storage.get(MB_PUSH_PENDING_KEY)) || [];
    // 보내기 전에 먼저 비워서, 발송 중 새로 들어온 입력은 다음 알림으로 넘어가게 합니다.
    await this.ctx.storage.delete(MB_PUSH_PENDING_KEY);
    if (!this.env?.DB) return;

    const retry = [];
    for (const group of groupBatchedPush(pending)) {
      try {
        await notifyPartnersOfTransactions(
          this.env,
          MB_D1_HOUSEHOLD_ID,
          group.actor,
          group.transactions,
          group.origin
        );
      } catch (error) {
        // 여기까지 올라온 오류는 기기로 보내기 전(구독 조회·키 준비)에 난 것이라
        // 다시 보내도 중복 알림이 생기지 않습니다. 몇 번만 다시 시도합니다.
        console.warn("[moneybook push] batched notify failed", error);
        for (const entry of pending) {
          if (String(entry?.actor || "") !== group.actor || String(entry?.origin || "") !== group.origin) continue;
          const attempt = Number(entry.attempt || 0) + 1;
          if (attempt <= MB_PUSH_MAX_RETRIES) retry.push({ ...entry, attempt });
        }
      }
    }

    if (retry.length) {
      const arrived = (await this.ctx.storage.get(MB_PUSH_PENDING_KEY)) || [];
      await this.ctx.storage.put(MB_PUSH_PENDING_KEY, [...retry, ...arrived].slice(0, 200));
      const current = await this.ctx.storage.getAlarm();
      const retryAt = Date.now() + MB_PUSH_RETRY_DELAY_MS;
      if (!current || current > retryAt) await this.ctx.storage.setAlarm(retryAt);
    }
  }

  webSocketError() {
  }
}

export default {
  async scheduled(
    _controller,
    env,
    ctx
  ) {
    if (!env.DB) {
      console.error("[moneybook cron] D1 binding is missing.");
      return;
    }

    const automationSession = {
      name: "자동화"
    };
    const cronErrors = [];

    try {
      const result = await mbD1ProcessRecurring(
        env,
        automationSession,
        {}
      );

      if (result.created.length > 0) {
        if (ctx?.waitUntil) {
          ctx.waitUntil(
            mbD1RealtimePoke(env, {
              path: "/cron/automations/recurring",
              changedBy: automationSession.name
            })
          );
        }

        console.log(
          `[moneybook cron] recurring transactions created: ${result.created.length}`
        );
      }
    } catch (error) {
      cronErrors.push(error);
      console.error(
        "[moneybook cron] recurring transaction processing failed",
        error
      );
    }

    try {
      const refreshedHomes = await refreshAllRealEstateAssets(
        env,
        MB_D1_HOUSEHOLD_ID,
        automationSession.name,
        mbD1Now(),
        mbD1CurrentDateSeoul()
      );
      if (refreshedHomes.length > 0) {
        if (ctx?.waitUntil) {
          ctx.waitUntil(mbD1RealtimePoke(env, {
            path: "/cron/real-estate/refresh",
            changedBy: automationSession.name
          }));
        }
        console.log(`[moneybook cron] real estate refreshed: ${refreshedHomes.length}`);
      }
    } catch (error) {
      cronErrors.push(error);
      console.error(
        "[moneybook cron] real estate refresh failed",
        error
      );
    }

    if (cronErrors.length > 0) {
      throw new AggregateError(cronErrors, "One or more Moneybook cron jobs failed.");
    }
  },

  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(
        request.url
      );

    const origin =
      url.origin;

    const normalizedPath =
      url.pathname.length > 1
        ? url.pathname.replace(/\/+$/, "")
        : url.pathname;

    try {
      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/ping"
      ) {
        return jsonResponse({
          success: true,
          message:
            "Cloudflare Worker is running."
        });
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/health"
      ) {
        return jsonResponse({
          success: true,
          backend: "d1",
          database: Boolean(env.DB)
        });
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/auth/login"
      ) {
        return handleLogin(
          request,
          env,
          ctx,
          origin
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/auth/session"
      ) {
        return handleSession(
          request,
          env,
          ctx,
          origin
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/auth/logout"
      ) {
        if (
          !isSameOrigin(
            request
          )
        ) {
          return errorResponse(
            "INVALID_ORIGIN",
            "허용되지 않은 요청입니다.",
            403
          );
        }

        return jsonResponse(
          {
            success: true,
            loggedIn: false
          },
          200,
          {
            "Set-Cookie":
              clearCookie()
          }
        );
      }

      if (
        !url.pathname.startsWith(
          "/api/"
        )
      ) {
        return errorResponse(
          "NOT_FOUND",
          "페이지를 찾을 수 없습니다.",
          404
        );
      }

      const session =
        await getSession(
          request,
          env
        );

      if (
        !session
      ) {
        return unauthorized();
      }

      if (
        request.method === "GET" &&
        normalizedPath === "/api/changes"
      ) {
        if (!env.DB) {
          return errorResponse("D1_NOT_BOUND", "D1 바인딩 DB를 찾을 수 없습니다.", 500);
        }
        return mbD1Envelope(await mbD1GetChangesData(env, url));
      }

      if (
        request.method === "GET" &&
        normalizedPath === "/api/realtime"
      ) {
        if (request.headers.get("Upgrade") !== "websocket") {
          return errorResponse("WEBSOCKET_REQUIRED", "WebSocket 연결이 필요합니다.", 426);
        }
        if (!env.HOUSEHOLD_REALTIME) {
          return errorResponse("REALTIME_BINDING_UNAVAILABLE", "실시간 WebSocket 바인딩이 아직 활성화되지 않았습니다.", 503);
        }
        const stub = await getHouseholdRealtimeStub(env);
        return stub.fetch(request);
      }

      const d1ProductionResponse =
        await mbD1ProductionRoute(
          request,
          url,
          session,
          env,
          ctx
        );

      if (d1ProductionResponse) {
        return d1ProductionResponse;
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/investments/symbol-search"
      ) {
        return handleInvestmentSymbolSearch(
          url
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/investments/symbol-lookup"
      ) {
        return handleInvestmentSymbolLookup(
          url
        );
      }

      return errorResponse(
        "API_NOT_FOUND",
        "지원하지 않는 API입니다.",
        404
      );
    } catch (
      error
    ) {
      console.error(
        "[moneybook worker] unhandled error",
        error
      );

      return errorResponse(
        "WORKER_ERROR",
        "서버 처리 중 오류가 발생했습니다.",
        500
      );
    }
  }
};
