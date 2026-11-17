// 설정 변경: 카테고리·계좌·입력 설정·가계부 시작일·가구 개요·자산 스냅샷
import { dateOnly as mbD1DateOnly, monthOnly as mbD1MonthOnly } from "../domain/date.js";
import { isObject } from "../http.js";
import { MB_D1_HOUSEHOLD_ID, mbD1Bool, mbD1CurrentMonthSeoul, mbD1CurrentYearSeoul, mbD1DisplayName, mbD1Fail, mbD1First, mbD1Has, mbD1Id, mbD1InsertChange, mbD1MemberIdByName, mbD1Now, mbD1Number, mbD1Text } from "./core.js";
import { mbD1BuildDashboard } from "./dashboard.js";
import { mbD1AccountById, mbD1CategoryById, mbD1MapAccountRow, mbD1RawAccounts } from "./records.js";

export async function mbD1HouseholdOverviewData(env) {
  const row = await mbD1First(env, "SELECT preference_json FROM user_preferences WHERE household_id=? AND preference_key='household_overview' LIMIT 1", [MB_D1_HOUSEHOLD_ID]);
  if (!row) return { livingAccountIds: null };
  try {
    const value = JSON.parse(row.preference_json);
    return { livingAccountIds: Array.isArray(value.livingAccountIds) ? value.livingAccountIds.filter(id => typeof id === "string") : null };
  } catch { return { livingAccountIds: null }; }
}

export async function mbD1SaveHouseholdOverview(body, session, env) {
  if (!Array.isArray(body.livingAccountIds)) mbD1Fail("INVALID_ACCOUNTS", "생활비 계좌를 선택해주세요.");
  const ids = [...new Set(body.livingAccountIds)];
  const accounts = (await mbD1RawAccounts(env)).map(mbD1MapAccountRow);
  if (ids.some(id => !accounts.some(account => account.accountId === id && account.active && !account.isDeleted && account.accountType === "자산" && !["신용카드", "체크카드", "주식"].includes(account.subType)))) {
    mbD1Fail("INVALID_ACCOUNTS", "사용 중인 현금·자산 계좌만 생활비 계좌로 선택할 수 있습니다.");
  }
  const now = mbD1Now();
  const update = env.DB.prepare(`INSERT INTO user_preferences(preference_id,household_id,preference_key,preference_json,version,created_at,updated_at)
    VALUES (?,?,?,?,1,?,?) ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,updated_at=excluded.updated_at`)
    .bind("PREF_HOUSEHOLD_OVERVIEW", MB_D1_HOUSEHOLD_ID, "household_overview", JSON.stringify({livingAccountIds: ids}), now, now);
  await env.DB.batch([update, await mbD1InsertChange(env, "household_overview", "shared", "updated", 1, session)]);
  return { livingAccountIds: ids };
}

export async function mbD1InputPreferencesData(env, userName = "") {
  const row = await mbD1First(
    env,
    `SELECT preference_json,version,updated_at FROM user_preferences
     WHERE household_id=? AND preference_key IN (?, 'input_preferences')
     ORDER BY CASE WHEN preference_key=? THEN 0 ELSE 1 END,updated_at DESC LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, `input_preferences:${userName}`, `input_preferences:${userName}`]
  );
  if (!row) {
    return { ownerName: userName, configured: false, version: 1, preferences: null, updatedAt: null, updatedBy: null };
  }
  let preferences = null;
  try {
    preferences = JSON.parse(row.preference_json || "null");
  } catch {
    mbD1Fail("INPUT_PREFERENCES_CORRUPT", "저장된 입력 설정 형식을 읽을 수 없습니다.", 500);
  }
  return {
    ownerName: userName,
    configured: true,
    version: mbD1Number(row.version, 1),
    preferences,
    updatedAt: row.updated_at || null,
    updatedBy: null
  };
}

export async function mbD1HandleCategoryMutation(path, body, session, env) {
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

export async function mbD1AccountModel(env, body, current = null, selfId = null) {
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

export async function mbD1HandleAccountMutation(path, body, session, env) {
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

export async function mbD1HandleInputPreferences(body, session, env) {
  if (!isObject(body.preferences)) mbD1Fail("INVALID_INPUT_PREFERENCES", "입력 설정 형식이 올바르지 않습니다.");
  const preferences = body.preferences;
  if (Number(preferences.version) !== 1) mbD1Fail("INVALID_INPUT_PREFERENCES_VERSION", "지원하지 않는 입력 설정 버전입니다.");
  if (!isObject(preferences.categoryOrder)) mbD1Fail("INVALID_INPUT_PREFERENCES", "카테고리 순서 형식이 올바르지 않습니다.");
  for (const type of ["지출", "수입", "이체"]) {
    if (!Array.isArray(preferences.categoryOrder[type])) mbD1Fail("INVALID_INPUT_PREFERENCES", `${type} 카테고리 순서는 배열이어야 합니다.`);
  }
  if (!Array.isArray(preferences.accountOrder) || !Array.isArray(preferences.hiddenAccountIds)) mbD1Fail("INVALID_INPUT_PREFERENCES", "계좌 설정 형식을 확인해주세요.");
  if (preferences.quickEntries !== undefined && (!Array.isArray(preferences.quickEntries) || preferences.quickEntries.length > 5)) mbD1Fail("INVALID_INPUT_PREFERENCES", "빠른 입력은 최대 5개까지 등록할 수 있습니다.");
  const now = mbD1Now();
  const update = env.DB.prepare(
    `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
  ).bind(
    `PREF_INPUT_${encodeURIComponent(session.name)}`, MB_D1_HOUSEHOLD_ID, null, `input_preferences:${session.name}`, JSON.stringify(preferences), 1, now, now
  );
  const change = await mbD1InsertChange(env, "input_preferences", session.name, "updated", 1, session);
  await env.DB.batch([update, change]);
  return { ownerName: session.name, configured: true, version: 1, preferences, updatedAt: now, updatedBy: session.name };
}

export async function mbD1HandleLedgerConfig(path, body, session, env) {
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

export async function mbD1HandleAssetSnapshot(body, session, env) {
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
