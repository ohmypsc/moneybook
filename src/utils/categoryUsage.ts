/*
 * 카테고리 선택 시트의 "자주 쓰는" 칩과 검색에 쓰는 순수 로직입니다.
 *
 * - 사용 횟수는 이 기기의 브라우저 저장소에 사람별로 남깁니다.
 *   (저장소를 못 쓰는 환경에서는 조용히 건너뜁니다.)
 * - 서버가 주는 최근 거래 기록도 함께 점수에 더해, 새 기기에서도 처음부터 순서가 잡히게 합니다.
 */

const STORAGE_PREFIX = "moneybook.categoryUsage.v1:";
const MAX_TRACKED = 200;

export interface CategoryUsageEntry {
  count: number;
  lastUsedAt: number;
}

export type CategoryUsageMap = Record<string, CategoryUsageEntry>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function getStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function parseCategoryUsage(raw: string | null): CategoryUsageMap {
  if (!raw) return {};

  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};

    const result: CategoryUsageMap = {};
    for (const [categoryId, entry] of Object.entries(value)) {
      if (!categoryId || !entry || typeof entry !== "object") continue;
      const { count, lastUsedAt } = entry as Partial<CategoryUsageEntry>;
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      result[categoryId] = {
        count: Math.floor(count),
        lastUsedAt: typeof lastUsedAt === "number" && Number.isFinite(lastUsedAt) ? lastUsedAt : 0
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function readCategoryUsage(
  owner: string,
  storage: StorageLike | null = getStorage()
): CategoryUsageMap {
  if (!storage || !owner) return {};
  try {
    return parseCategoryUsage(storage.getItem(STORAGE_PREFIX + owner));
  } catch {
    return {};
  }
}

export function addCategoryUsage(
  usage: CategoryUsageMap,
  categoryId: string,
  now: number
): CategoryUsageMap {
  const current = usage[categoryId];
  const next: CategoryUsageMap = {
    ...usage,
    [categoryId]: { count: (current?.count || 0) + 1, lastUsedAt: now }
  };

  const ids = Object.keys(next);
  if (ids.length <= MAX_TRACKED) return next;

  // 오래 안 쓴 것부터 정리합니다.
  ids
    .sort((first, second) => next[first].lastUsedAt - next[second].lastUsedAt)
    .slice(0, ids.length - MAX_TRACKED)
    .forEach(id => delete next[id]);
  return next;
}

export function recordCategoryUsage(
  owner: string,
  categoryId: string,
  storage: StorageLike | null = getStorage(),
  now = Date.now()
) {
  if (!storage || !owner || !categoryId) return;
  try {
    const next = addCategoryUsage(readCategoryUsage(owner, storage), categoryId, now);
    storage.setItem(STORAGE_PREFIX + owner, JSON.stringify(next));
  } catch {
    // 저장소가 꽉 찼거나 막혀 있으면 순서 학습만 건너뜁니다.
  }
}

/**
 * 자주 쓰는 카테고리 id를 점수 순으로 돌려줍니다.
 * 점수 = 이 기기 사용 횟수 + 최근 거래 등장 횟수. 같으면 최근에 쓴 것이 먼저입니다.
 */
export function getFrequentCategoryIds(
  availableIds: string[],
  usage: CategoryUsageMap,
  recentCategoryIds: Array<string | null | undefined>,
  limit = 6
): string[] {
  const available = new Set(availableIds);
  const scores = new Map<string, { score: number; lastUsedAt: number }>();

  for (const [id, entry] of Object.entries(usage)) {
    if (!available.has(id)) continue;
    scores.set(id, { score: entry.count, lastUsedAt: entry.lastUsedAt });
  }

  recentCategoryIds.forEach((id, index) => {
    if (!id || !available.has(id)) return;
    const current = scores.get(id) || { score: 0, lastUsedAt: 0 };
    // 최근 거래 순서(앞이 최신)를 동점 처리용 시각으로 씁니다.
    scores.set(id, {
      score: current.score + 1,
      lastUsedAt: Math.max(current.lastUsedAt, -index)
    });
  });

  return [...scores.entries()]
    .sort(
      ([, first], [, second]) => second.score - first.score || second.lastUsedAt - first.lastUsedAt
    )
    .slice(0, limit)
    .map(([id]) => id);
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
