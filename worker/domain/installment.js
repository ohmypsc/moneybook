// 신용카드 무이자 할부 계산.
// 가계부 지출은 산 날 전액으로 잡고, 카드 청구만 첫 청구월부터 개월 수만큼 나눕니다.

export const INSTALLMENT_MIN_MONTHS = 2;
export const INSTALLMENT_MAX_MONTHS = 36;

/**
 * 입력값을 할부 개월 수로 바꿉니다. 일시불(없음·0·1)은 null입니다.
 * 잘못된 값이면 { error }를 돌려줍니다.
 */
export function normalizeInstallmentMonths(value) {
  if (value === undefined || value === null || value === "") return { months: null };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    return { error: "할부 개월 수가 올바르지 않습니다." };
  }
  if (number <= 1) return { months: null };
  if (number < INSTALLMENT_MIN_MONTHS || number > INSTALLMENT_MAX_MONTHS) {
    return { error: `할부는 ${INSTALLMENT_MIN_MONTHS}~${INSTALLMENT_MAX_MONTHS}개월까지 입력할 수 있습니다.` };
  }
  return { months: number };
}

function monthIndex(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match) return null;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

export function addMonths(month, offset) {
  const index = monthIndex(month);
  if (index === null) return null;
  const next = index + offset;
  return `${Math.floor(next / 12)}-${String((next % 12) + 1).padStart(2, "0")}`;
}

/**
 * 할부 회차별 청구액. 원 단위로 나누고, 나누어떨어지지 않는 나머지는 첫 회차에 더합니다
 * (국내 카드사 대부분의 방식).
 */
export function installmentSchedule(amount, months) {
  const total = Math.round(Number(amount) || 0);
  const count = Number(months) >= 2 ? Math.trunc(Number(months)) : 1;
  const sign = total < 0 ? -1 : 1;
  const absolute = Math.abs(total);
  const base = Math.floor(absolute / count);
  const remainder = absolute - base * count;
  return Array.from({ length: count }, (_, index) => sign * (index === 0 ? base + remainder : base));
}

/**
 * 특정 청구월에 이 거래로 청구되는 금액.
 * firstBillingMonth: 첫 청구월(일시불이면 그 달 전액).
 */
export function installmentAmountForMonth(amount, months, firstBillingMonth, month) {
  const first = monthIndex(firstBillingMonth);
  const target = monthIndex(month);
  if (first === null || target === null) return 0;
  const schedule = installmentSchedule(amount, months);
  const offset = target - first;
  return offset >= 0 && offset < schedule.length ? schedule[offset] : 0;
}

/**
 * 첫 청구월 기준으로 아직 청구되지 않은 할부 잔액(해당 청구월 청구분 포함 이후).
 */
export function installmentRemainingAfter(amount, months, firstBillingMonth, month) {
  const first = monthIndex(firstBillingMonth);
  const target = monthIndex(month);
  if (first === null || target === null) return 0;
  const schedule = installmentSchedule(amount, months);
  const offset = Math.max(0, target - first + 1);
  return schedule.slice(offset).reduce((sum, value) => sum + value, 0);
}
