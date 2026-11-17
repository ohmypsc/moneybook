/*
 * 카테고리 선택 시트의 "자주 쓰는" 칩과 검색에 쓰는 순수 로직입니다.
 *
 * "자주 쓰는" 순서는 서버가 실제 거래 기록(최근 180일)으로 센 사용 횟수를 그대로 따릅니다.
 * 예전 형식의 대시보드 캐시처럼 사용 횟수가 없을 때만 최근 거래 목록으로 대신 셉니다.
 */

export interface CategoryUsageLike {
  categoryId: string;
  count: number;
  lastDate?: string;
}

export function getFrequentCategoryIds(
  availableIds: string[],
  usage: CategoryUsageLike[] | null | undefined,
  recentCategoryIds: Array<string | null | undefined> = [],
  limit = 6
): string[] {
  const available = new Set(availableIds);

  if (usage && usage.length > 0) {
    return usage
      .filter(item => available.has(item.categoryId) && item.count > 0)
      .slice()
      .sort(
        (first, second) =>
          second.count - first.count || (second.lastDate || "").localeCompare(first.lastDate || "")
      )
      .slice(0, limit)
      .map(item => item.categoryId);
  }

  // 대체: 최근 거래 목록(앞이 최신)에서 센 횟수
  const counts = new Map<string, { count: number; order: number }>();
  recentCategoryIds.forEach((id, index) => {
    if (!id || !available.has(id)) return;
    const current = counts.get(id);
    counts.set(id, { count: (current?.count || 0) + 1, order: current?.order ?? index });
  });

  return [...counts.entries()]
    .sort(([, first], [, second]) => second.count - first.count || first.order - second.order)
    .slice(0, limit)
    .map(([id]) => id);
}

/** 전체 목록은 가나다순으로 보여 줍니다. */
export function sortByKoreanLabel<T extends { label: string }>(items: T[]) {
  return items.slice().sort((first, second) => first.label.localeCompare(second.label, "ko"));
}

/* ---------- 검색 (초성 포함) ---------- */

const CHOSEONG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ"
];
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

export function getChoseong(text: string) {
  let result = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= HANGUL_START && code <= HANGUL_END) {
      result += CHOSEONG[Math.floor((code - HANGUL_START) / 588)];
    } else {
      result += char;
    }
  }
  return result;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s·.\-_/]/g, "");
}

export function matchesCategorySearch(label: string, query: string) {
  const needle = normalize(query.trim());
  if (!needle) return true;

  const haystack = normalize(label);
  if (haystack.includes(needle)) return true;

  // 초성만 입력한 경우 (예: "ㅅㅂ" → 식비)
  return getChoseong(haystack).includes(needle);
}
