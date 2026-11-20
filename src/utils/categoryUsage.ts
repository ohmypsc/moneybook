/*
 * 카테고리 선택 시트의 "자주 쓰는" 칩과 검색에 쓰는 순수 로직입니다.
 *
 * "자주 쓰는" 순서는 서버가 실제 거래 기록(최근 180일)으로 센 사용 횟수를 그대로 따릅니다.
 * 예전 형식의 대시보드 캐시처럼 사용 횟수가 없을 때만 최근 거래 목록으로 대신 셉니다.
 */

import { merchantCategoryIds, type MerchantUsage } from "../../shared/merchantUsage.js";

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

/* ---------- 가맹점 기반 추천 ---------- */

export interface CategorySuggestionInput {
  merchant: string;
  /** "지출" | "수입" | "이체" */
  type: string;
  availableIds: string[];
  merchantUsage?: MerchantUsage[] | null;
  usage?: CategoryUsageLike[] | null;
  recentCategoryIds?: Array<string | null | undefined>;
  limit?: number;
}

/**
 * 추천 칩에 보여 줄 카테고리 순서입니다.
 * 이 가맹점에 예전에 쓴 카테고리를 먼저, 남는 자리는 전체에서 자주 쓰는 카테고리로 채웁니다.
 * fromMerchant에는 가맹점 기록에서 나온 ID만 들어 있어 화면에서 "지난번에 쓴" 표시에 씁니다.
 */
export function getCategorySuggestions({
  merchant,
  type,
  availableIds,
  merchantUsage,
  usage,
  recentCategoryIds = [],
  limit = 4
}: CategorySuggestionInput) {
  const fromMerchant = merchantCategoryIds(merchant, type, merchantUsage, availableIds, limit);
  const frequent = getFrequentCategoryIds(availableIds, usage, recentCategoryIds, limit + 4);
  const ids = [...fromMerchant];
  for (const id of frequent) {
    if (ids.length >= limit) break;
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, fromMerchant };
}
