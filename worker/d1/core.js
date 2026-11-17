// D1 공통: 가구 상수, 에러, 값 정규화, 쿼리 헬퍼, 변경 로그, 실시간 알림
import { dateOnly as mbD1DateOnly } from "../domain/date.js";
import { jsonResponse } from "../http.js";

export async function getHouseholdRealtimeStub(env) {
  if (!env.HOUSEHOLD_REALTIME) {
    return null;
  }

  const namespace = env.HOUSEHOLD_REALTIME;
  return typeof namespace.getByName === "function"
    ? namespace.getByName(MB_D1_HOUSEHOLD_ID)
    : namespace.get(namespace.idFromName(MB_D1_HOUSEHOLD_ID));
}

export const MB_D1_HOUSEHOLD_ID = "HH_MAIN";
export const MB_D1_API_VERSION = "D1-2.0";

export class MbD1Error extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MbD1Error";
    this.code = code;
    this.status = status;
  }
}

export function mbD1Fail(code, message, status = 400) {
  throw new MbD1Error(code, message, status);
}

export function mbD1Text(value) {
  return String(value ?? "").trim();
}

export function mbD1Number(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function mbD1NullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function mbD1Bool(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

export function mbD1Round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((mbD1Number(value) + Number.EPSILON) * factor) / factor;
}

export function mbD1Has(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export function mbD1Id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function mbD1Now() {
  return new Date().toISOString();
}

export function mbD1TimestampMs(value) {
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

export function mbD1CurrentYearSeoul() {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Seoul",
      year: "numeric"
    }).format(new Date())
  );
}

export function mbD1CurrentDateSeoul() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function mbD1CurrentMonthSeoul() {
  return mbD1CurrentDateSeoul().slice(0, 7);
}

export function mbD1DisplayName(name, owner) {
  const cleanName = mbD1Text(name);
  const cleanOwner = mbD1Text(owner);
  return cleanOwner && cleanOwner !== "공동" ? `${cleanName}(${cleanOwner})` : cleanName;
}

export function mbD1IsInvestmentAccount(account) {
  return (
    Boolean(account) &&
    (account.balanceMethod === "평가입력" ||
      account.subType === "주식" ||
      account.accountType === "투자")
  );
}

export function mbD1AccountActive(row) {
  if (!row || row.deleted_at) return false;
  const year = mbD1CurrentYearSeoul();
  const start = mbD1NullableNumber(row.start_year);
  const end = mbD1NullableNumber(row.end_year);
  if (start !== null || end !== null) {
    return (start === null || year >= start) && (end === null || year <= end);
  }
  return mbD1Bool(row.is_active);
}

export function mbD1Envelope(data) {
  return jsonResponse({
    success: true,
    apiVersion: MB_D1_API_VERSION,
    data
  });
}

export async function mbD1All(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  const result = binds.length ? await statement.bind(...binds).all() : await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

export async function mbD1First(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  return binds.length ? statement.bind(...binds).first() : statement.first();
}

export async function mbD1MemberByName(env, name) {
  const clean = mbD1Text(name);
  if (!clean || clean === "공동") return null;
  return mbD1First(
    env,
    "SELECT member_id,display_name FROM members WHERE household_id=? AND display_name=? AND deleted_at IS NULL AND is_active=1 LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, clean]
  );
}

export async function mbD1MemberIdByName(env, name) {
  const member = await mbD1MemberByName(env, name);
  return member?.member_id || null;
}

export async function mbD1Members(env) {
  const rows = await mbD1All(
    env,
    "SELECT member_id,display_name FROM members WHERE household_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY display_name",
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows;
}

export async function mbD1GetLedgerConfigData(env) {
  const row = await mbD1First(
    env,
    "SELECT ledger_start_date FROM households WHERE household_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID]
  );
  return { ledgerStartDate: row?.ledger_start_date || null };
}

export async function mbD1ValidateLedgerDate(env, dateValue) {
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

export async function mbD1InsertChange(
  env,
  entityType,
  entityId,
  action,
  version,
  session,
  payload = null
) {
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

export async function mbD1RealtimePoke(env, detail = {}) {
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
  } catch {}
}
