/*
 * 가져오기 검토 화면의 "확인 필요" 판단과 추천 칩 순서를 정하는 순수 로직입니다.
 */
import { merchantMatchStrength, normalizeMerchantKey } from "../../../shared/merchantUsage.js";
import type { EditableCandidate } from "./importReview";

/** 사용자가 확인만 하면 넘어갈 수 있는 경고입니다. 나머지는 값을 채워야 저장할 수 있습니다. */
const SOFT_REASONS = new Set(["인식 결과 확인 필요", "중복 거래 의심"]);

export function getBlockingReasons(item: EditableCandidate) {
  return item.reviewReasons.filter(reason => !SOFT_REASONS.has(reason));
}

/** 목록에서 "확인 필요"로 묶을 거래인지 봅니다. */
export function needsReview(item: EditableCandidate) {
  if (item.queued) return false;
  if (getBlockingReasons(item).length > 0) return true;
  return !item.reviewed && item.reviewReasons.length > 0;
}

export type ConfirmResult =
  { ok: true; item: EditableCandidate; duplicate: boolean } | { ok: false; error: string };

/**
 * "확인하고 다음"을 눌렀을 때의 처리입니다.
 * 채워야 할 칸이 남아 있으면 막고, 인식·중복 경고만 남았다면 사용자가 본 것으로 보고 저장 대상으로 올립니다.
 */
export function confirmReviewedItem(item: EditableCandidate): ConfirmResult {
  if (item.kind === "refund") {
    return { ok: false, error: "취소/환불은 아직 여기서 저장할 수 없습니다. 건너뛰어 주세요." };
  }
  const blocking = getBlockingReasons(item);
  if (blocking.length > 0) return { ok: false, error: blocking.join(" · ") };
  return {
    ok: true,
    duplicate: Boolean(item.duplicate),
    item: {
      ...item,
      confidence: "high",
      reviewed: true,
      selected: true,
      reviewReasons: item.reviewReasons.filter(reason => reason !== "인식 결과 확인 필요")
    }
  };
}

/** 같은 가맹점(이름이 완전히 같은)이면서 다른 카테고리로 되어 있는 다른 거래들 */
export function findSameMerchantItems(items: EditableCandidate[], source: EditableCandidate) {
  const key = normalizeMerchantKey(source.merchant);
  if (!key) return [];
  return items.filter(
    item =>
      item.candidateId !== source.candidateId &&
      !item.queued &&
      item.kind === source.kind &&
      item.categoryId !== source.categoryId &&
      merchantMatchStrength(key, normalizeMerchantKey(item.merchant)) === 2
  );
}

/**
 * 계좌·결제수단 추천 칩: 지금 고른 것 → 최근에 많이 쓴 것 → 원래 목록 순서(내 명의 먼저)로 limit개.
 * candidates는 이미 사용자 기준으로 정렬된 목록이어야 합니다.
 */
export function suggestAccountIds(
  candidates: string[],
  selectedId: string | null | undefined,
  recentIds: Array<string | null | undefined> = [],
  limit = 3
) {
  const available = new Set(candidates);
  const counts = new Map<string, number>();
  recentIds.forEach(id => {
    if (id && available.has(id)) counts.set(id, (counts.get(id) || 0) + 1);
  });
  const byRecent = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const ordered = [selectedId || "", ...byRecent, ...candidates].filter(
    id => id && available.has(id)
  );
  return [...new Set(ordered)].slice(0, limit);
}
