import test from "node:test";
import assert from "node:assert/strict";

import {
  merchantCategoryIds,
  merchantMatchStrength,
  merchantUsageCounts,
  normalizeMerchantKey
} from "../shared/merchantUsage.js";
import { getCategorySuggestions } from "../src/utils/categoryUsage.ts";
import {
  confirmReviewedItem,
  findSameMerchantItems,
  needsReview,
  suggestAccountIds
} from "../src/features/importTransactions/importSuggestions.ts";
import type { EditableCandidate } from "../src/features/importTransactions/importReview.ts";

test("가맹점 키: 괄호·공백·기호를 지우고 소문자로 맞춘다", () => {
  assert.equal(normalizeMerchantKey("스타벅스 역삼점(카드)"), "스타벅스역삼점");
  assert.equal(normalizeMerchantKey("GS25 선릉"), "gs25선릉");
});

test("가맹점 일치: 완전 일치는 2, 4글자 이상 포함은 1, 짧은 이름 포함은 0", () => {
  assert.equal(merchantMatchStrength("쿠팡", "쿠팡"), 2);
  assert.equal(merchantMatchStrength("스타벅스", "스타벅스역삼점"), 1);
  assert.equal(merchantMatchStrength("gs", "gs25선릉"), 0);
  assert.equal(merchantMatchStrength("", "쿠팡"), 0);
});

test("서버 집계: 가맹점·유형·카테고리별로 세고 취소·기간 밖·내용 없음은 뺀다", () => {
  const usage = merchantUsageCounts(
    [
      { description: "쿠팡", type: "지출", categoryId: "생활", date: "2026-11-10" },
      { description: "쿠팡(로켓)", type: "지출", categoryId: "생활", date: "2026-11-12" },
      { description: "쿠팡", type: "지출", categoryId: "쇼핑", date: "2026-11-01" },
      {
        description: "쿠팡",
        type: "지출",
        categoryId: "생활",
        date: "2026-11-11",
        reversalOf: "T"
      },
      { description: "쿠팡", type: "지출", categoryId: "생활", date: "2026-01-01" },
      { description: "", type: "지출", categoryId: "생활", date: "2026-11-10" },
      { description: "쿠팡", type: "지출", categoryId: "", date: "2026-11-10" }
    ],
    "2026-11-17"
  );
  assert.deepEqual(usage, [
    { merchant: "쿠팡", type: "지출", categoryId: "생활", count: 2, lastDate: "2026-11-12" },
    { merchant: "쿠팡", type: "지출", categoryId: "쇼핑", count: 1, lastDate: "2026-11-01" }
  ]);
});

test("가맹점 추천: 완전 일치 기록을 부분 일치보다 앞에, 유형·사용 가능 목록으로 거른다", () => {
  const usage = [
    {
      merchant: "스타벅스역삼점",
      type: "지출",
      categoryId: "외식",
      count: 9,
      lastDate: "2026-11-01"
    },
    { merchant: "스타벅스", type: "지출", categoryId: "카페", count: 2, lastDate: "2026-11-02" },
    { merchant: "스타벅스", type: "수입", categoryId: "환급", count: 5, lastDate: "2026-11-03" },
    { merchant: "스타벅스", type: "지출", categoryId: "삭제됨", count: 7, lastDate: "2026-11-03" }
  ];
  assert.deepEqual(merchantCategoryIds("스타벅스", "지출", usage, ["외식", "카페"]), [
    "카페",
    "외식"
  ]);
  assert.deepEqual(merchantCategoryIds("", "지출", usage, null), []);
});

test("추천 칩: 가맹점 기록 먼저, 남은 자리는 자주 쓰는 카테고리로 채운다", () => {
  const result = getCategorySuggestions({
    merchant: "쿠팡",
    type: "지출",
    availableIds: ["식비", "생활", "교통", "카페", "쇼핑"],
    merchantUsage: [
      { merchant: "쿠팡", type: "지출", categoryId: "생활", count: 3, lastDate: "2026-11-10" }
    ],
    usage: [
      { categoryId: "식비", count: 30 },
      { categoryId: "생활", count: 20 },
      { categoryId: "카페", count: 10 },
      { categoryId: "교통", count: 5 }
    ],
    limit: 4
  });
  assert.deepEqual(result.ids, ["생활", "식비", "카페", "교통"]);
  assert.deepEqual(result.fromMerchant, ["생활"]);
});

const base: EditableCandidate = {
  candidateId: "C1",
  requestId: "R1",
  kind: "expense",
  selected: false,
  date: "2026-11-15",
  time: "",
  amount: 32900,
  merchant: "쿠팡",
  memo: "",
  sourceText: "",
  cardName: "",
  suggestedCategoryName: "",
  confidence: "low",
  categoryId: "생활",
  categoryName: "생활용품",
  categorySuggestionSource: null,
  paymentMethodId: "A1",
  paymentMethodName: "카드",
  spendingTarget: "공동",
  duplicate: null,
  reviewReasons: ["인식 결과 확인 필요"]
};

test("확인 필요: 채울 칸이 남았거나, 경고가 있는데 아직 확인하지 않은 거래", () => {
  assert.equal(needsReview(base), true);
  assert.equal(needsReview({ ...base, reviewed: true }), false);
  assert.equal(
    needsReview({ ...base, reviewed: true, reviewReasons: ["카테고리 선택 필요"] }),
    true
  );
  assert.equal(needsReview({ ...base, queued: true }), false);
  assert.equal(needsReview({ ...base, reviewReasons: [] }), false);
});

test("확인하고 다음: 빈 칸이 있으면 막고, 인식 경고만 있으면 저장 대상으로 올린다", () => {
  const blocked = confirmReviewedItem({ ...base, reviewReasons: ["결제수단 선택 필요"] });
  assert.deepEqual(blocked, { ok: false, error: "결제수단 선택 필요" });

  const passed = confirmReviewedItem(base);
  assert.equal(passed.ok, true);
  if (passed.ok) {
    assert.equal(passed.item.selected, true);
    assert.equal(passed.item.reviewed, true);
    assert.equal(passed.item.confidence, "high");
    assert.deepEqual(passed.item.reviewReasons, []);
    assert.equal(passed.duplicate, false);
  }

  assert.equal(confirmReviewedItem({ ...base, kind: "refund" }).ok, false);
});

test("같은 가맹점: 이름이 완전히 같고 유형이 같으며 카테고리가 다른 미저장 거래만 고른다", () => {
  const items = [
    base,
    { ...base, candidateId: "C2", categoryId: null },
    { ...base, candidateId: "C3", merchant: "쿠팡 ", categoryId: "쇼핑" },
    { ...base, candidateId: "C4", categoryId: "생활" },
    { ...base, candidateId: "C5", categoryId: null, queued: true },
    { ...base, candidateId: "C6", categoryId: null, kind: "income" as const },
    { ...base, candidateId: "C7", categoryId: null, merchant: "쿠팡이츠" }
  ];
  assert.deepEqual(
    findSameMerchantItems(items, base).map(item => item.candidateId),
    ["C2", "C3"]
  );
});

test("계좌 추천: 고른 것 → 최근 많이 쓴 것 → 원래 순서, 목록에 없는 ID는 뺀다", () => {
  assert.deepEqual(suggestAccountIds(["A", "B", "C", "D"], "C", ["D", "D", "B", "X"], 3), [
    "C",
    "D",
    "B"
  ]);
  assert.deepEqual(suggestAccountIds(["A", "B"], null, [], 3), ["A", "B"]);
});
