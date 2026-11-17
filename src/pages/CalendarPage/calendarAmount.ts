/*
 * 달력 칸에 쓰는 금액 표기입니다. 칸 폭이 좁아 모든 금액을 같은 규칙으로 줄여 씁니다.
 *
 * - 1만 원 미만: 그대로 (8,900)
 * - 1만 원 이상: 만 원 단위. 10만 원 미만은 소수 첫째 자리까지 (9.9만), 그 이상은 정수 (36만, 420만)
 * - 1억 원 이상: 억 원 단위, 소수 첫째 자리까지 (1.2억)
 *
 * 어떤 금액이든 부호를 포함해 7글자를 넘지 않아 칸 밖으로 잘리지 않습니다.
 * 정확한 금액은 날짜를 눌렀을 때 아래 상세에서 보여 줍니다.
 */
function trimDecimal(value: number, digits: number) {
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

export function formatCalendarAmount(value: number) {
  const amount = Math.round(Math.abs(value));

  if (amount >= 100_000_000) {
    const eok = amount / 100_000_000;
    return `${eok >= 100 ? Math.round(eok).toLocaleString("ko-KR") : trimDecimal(eok, 1)}억`;
  }

  if (amount >= 100_000) {
    const man = Math.round(amount / 10_000);
    // 반올림으로 1억이 되는 경우 억 단위로 넘깁니다.
    if (man >= 10_000) return "1억";
    return `${man.toLocaleString("ko-KR")}만`;
  }

  if (amount >= 10_000) {
    return `${trimDecimal(amount / 10_000, 1)}만`;
  }

  return amount.toLocaleString("ko-KR");
}
