// 입력 화면 카테고리 선택의 "자주 쓰는" 순서를 위한 집계입니다.
// 최근 기간의 실제 거래에서 카테고리별 사용 횟수와 마지막 사용일을 셉니다.
// 취소(역거래) 기록과 카테고리 없는 거래는 세지 않습니다.

export const CATEGORY_USAGE_DAYS = 180;

function shiftDate(dateValue, days) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function categoryUsageCounts(transactions, today, days = CATEGORY_USAGE_DAYS) {
  const since = shiftDate(today, -days);
  const usage = new Map();

  for (const tx of transactions || []) {
    if (!tx || !tx.categoryId || tx.reversalOf || tx.isDeleted) continue;
    const date = String(tx.date || "");
    if (date < since || date > today) continue;

    const current = usage.get(tx.categoryId) || {
      categoryId: tx.categoryId,
      count: 0,
      lastDate: ""
    };
    current.count += 1;
    if (date > current.lastDate) current.lastDate = date;
    usage.set(tx.categoryId, current);
  }

  return [...usage.values()].sort(
    (a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate)
  );
}
