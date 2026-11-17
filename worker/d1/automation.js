// 자동화 설정(혜택·정기거래 규칙)과 정기 거래 생성
import { recurringOccurrenceDate as mbD1RecurringOccurrenceDate, recurringPayload as mbD1RecurringPayload, recurringRuleActiveForMonth as mbD1RecurringRuleActiveForMonth } from "../domain/automation.js";
import { dateOnly as mbD1DateOnly, monthOnly as mbD1MonthOnly } from "../domain/date.js";
import { isObject } from "../http.js";
import { MB_D1_HOUSEHOLD_ID, mbD1Bool, mbD1CurrentDateSeoul, mbD1CurrentMonthSeoul, mbD1Fail, mbD1First, mbD1Id, mbD1InsertChange, mbD1Now, mbD1NullableNumber, mbD1Number, mbD1Text } from "./core.js";
import { mbD1HandleTransactionMutation } from "./transactions.js";

export const MB_D1_AUTOMATION_PREF_ID = "PREF_AUTOMATION_SHARED";
export const MB_D1_AUTOMATION_PREF_KEY = "automation_settings";

export function mbD1DefaultAutomationSettings() {
  return {
    version: 1,
    recurringRules: [],
    benefitRules: []
  };
}

export function mbD1AutomationId(value, prefix) {
  const clean = mbD1Text(value);
  return clean || mbD1Id(prefix);
}

export function mbD1NormalizeBenefitRule(value, index = 0) {
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

export function mbD1NormalizeRecurringRule(value, index = 0) {
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

export function mbD1NormalizeAutomationSettings(value) {
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

export async function mbD1AutomationSettingsData(env) {
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

export function mbD1ValidateAutomationSettings(settings) {
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

export async function mbD1HandleAutomationSettings(body, session, env) {
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

export async function mbD1RecurringAlreadyCreated(env, ruleId, month) {
  const requestId = `RECUR_${ruleId}_${month}`;
  const row = await mbD1First(
    env,
    "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, requestId]
  );
  return Boolean(row?.transaction_id);
}

export async function mbD1CreateRecurringOccurrence(env, session, rule, month) {
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

export async function mbD1ProcessRecurring(env, session, options = {}) {
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
