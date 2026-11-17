// 가맹점(거래 내용)별로 어떤 카테고리를 썼는지 세는 공용 로직입니다.
// 서버는 대시보드 응답에 집계를 실어 보내고, 화면은 그 집계로 "이 가맹점에 예전에 쓴 카테고리"를
// 추천 칩 맨 앞에 둡니다. 서버와 화면이 같은 기준으로 가맹점 이름을 맞추도록 여기 한곳에 둡니다.

export const MERCHANT_USAGE_DAYS = 180;
export const MERCHANT_USAGE_LIMIT = 400;
const PARTIAL_MATCH_MIN_LENGTH = 4;

/** "스타벅스 역삼점(카드)" → "스타벅스역삼점" 처럼 비교용 키로 바꿉니다. */
export function normalizeMerchantKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^0-9a-z가-힣]/g, "")
    .slice(0, 120);
}

/**
 * 같은 가맹점인지 봅니다. 0 = 다름, 2 = 완전히 같음, 1 = 한쪽이 다른 쪽을 포함(4글자 이상일 때만).
 * 짧은 이름끼리 부분 일치로 묶으면 "gs"와 "gs25" 같은 엉뚱한 연결이 생겨 4글자 기준을 둡니다.
 */
export function merchantMatchStrength(firstKey, secondKey) {
  if (!firstKey || !secondKey) return 0;
  if (firstKey === secondKey) return 2;
  const shorter = firstKey.length <= secondKey.length ? firstKey : secondKey;
  const longer = shorter === firstKey ? secondKey : firstKey;
  return shorter.length >= PARTIAL_MATCH_MIN_LENGTH && longer.includes(shorter) ? 1 : 0;
}

function shiftDate(dateValue, days) {
  const [year, month, day] = String(dateValue).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * 최근 기간 실제 거래를 (가맹점, 유형, 카테고리)별로 셉니다.
 * 취소 기록·카테고리 없는 거래·내용 없는 거래는 빼고, 많이·최근에 쓴 순서로 limit개만 남깁니다.
 */
export function merchantUsageCounts(
  transactions,
  today,
  days = MERCHANT_USAGE_DAYS,
  limit = MERCHANT_USAGE_LIMIT
) {
  const since = shiftDate(today, -days);
  const usage = new Map();

  for (const tx of transactions || []) {
    if (!tx || !tx.categoryId || tx.reversalOf || tx.isDeleted) continue;
    const date = String(tx.date || "");
    if (date < since || date > today) continue;
    const merchant = normalizeMerchantKey(tx.description);
    if (!merchant) continue;
    const type = String(tx.type || "");
    const key = `${merchant}\u0000${type}\u0000${tx.categoryId}`;
    const current = usage.get(key) || {
      merchant,
      type,
      categoryId: tx.categoryId,
      count: 0,
      lastDate: ""
    };
    current.count += 1;
    if (date > current.lastDate) current.lastDate = date;
    usage.set(key, current);
  }

  return [...usage.values()]
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))
    .slice(0, Math.max(0, limit));
}

/**
 * 이 가맹점에 예전에 쓴 카테고리 ID를 추천 순서대로 돌려줍니다.
 * 완전히 같은 이름에서 나온 기록을 부분 일치보다 앞에 두고, 그 안에서는 많이·최근 쓴 순서입니다.
 */
export function merchantCategoryIds(merchant, type, usage, availableIds, limit = 3) {
  const target = normalizeMerchantKey(merchant);
  if (!target || !Array.isArray(usage)) return [];
  const available = availableIds ? new Set(availableIds) : null;
  const scores = new Map();

  for (const entry of usage) {
    if (!entry || (type && entry.type !== type)) continue;
    if (available && !available.has(entry.categoryId)) continue;
    const strength = merchantMatchStrength(target, entry.merchant);
    if (!strength) continue;
    const current = scores.get(entry.categoryId) || { strength: 0, count: 0, lastDate: "" };
    current.strength = Math.max(current.strength, strength);
    current.count += Number(entry.count) || 0;
    if (String(entry.lastDate || "") > current.lastDate) current.lastDate = entry.lastDate;
    scores.set(entry.categoryId, current);
  }

  return [...scores.entries()]
    .sort(
      ([, a], [, b]) =>
        b.strength - a.strength || b.count - a.count || b.lastDate.localeCompare(a.lastDate)
    )
    .slice(0, Math.max(0, limit))
    .map(([categoryId]) => categoryId);
}
