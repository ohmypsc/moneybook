import test from "node:test";
import assert from "node:assert/strict";

import {
  getChoseong,
  getFrequentCategoryIds,
  matchesCategorySearch,
  sortByKoreanLabel
} from "../src/utils/categoryUsage.ts";
import { categoryUsageCounts } from "../worker/domain/categoryUsage.js";

test("서버 집계: 최근 기간의 실제 거래만 세고 취소·카테고리 없음은 뺀다", () => {
  const usage = categoryUsageCounts(
    [
      { categoryId: "식비", date: "2026-11-10" },
      { categoryId: "식비", date: "2026-11-01" },
      { categoryId: "카페", date: "2026-11-16" },
      { categoryId: "카페", date: "2026-11-15", reversalOf: "T1" },
      { categoryId: "교통", date: "2026-03-01" },
      { categoryId: "", date: "2026-11-10" },
      { categoryId: "미래", date: "2026-12-01" }
    ],
    "2026-11-17",
    180
  );
  assert.deepEqual(usage, [
    { categoryId: "식비", count: 2, lastDate: "2026-11-10" },
    { categoryId: "카페", count: 1, lastDate: "2026-11-16" }
  ]);
});

test("자주 쓰는 순서는 서버 사용 횟수를 따르고, 없는 카테고리는 뺀다", () => {
  const ids = getFrequentCategoryIds(
    ["식비", "카페", "교통"],
    [
      { categoryId: "삭제됨", count: 99 },
      { categoryId: "카페", count: 3, lastDate: "2026-11-01" },
      { categoryId: "식비", count: 3, lastDate: "2026-11-10" },
      { categoryId: "교통", count: 1 }
    ],
    ["교통", "교통", "교통"]
  );
  assert.deepEqual(ids, ["식비", "카페", "교통"]);
});

test("사용 횟수가 없으면 최근 거래 목록으로 대신 센다", () => {
  assert.deepEqual(
    getFrequentCategoryIds(["식비", "카페", "교통"], undefined, ["카페", "식비", "식비", null]),
    ["식비", "카페"]
  );
  assert.deepEqual(getFrequentCategoryIds(["식비"], [], []), []);
});

test("전체 목록은 가나다순", () => {
  assert.deepEqual(
    sortByKoreanLabel([{ label: "카페" }, { label: "교통" }, { label: "식비" }]).map(i => i.label),
    ["교통", "식비", "카페"]
  );
});

test("검색은 부분 일치와 초성을 모두 받는다", () => {
  assert.equal(getChoseong("식비"), "ㅅㅂ");
  assert.equal(matchesCategorySearch("식비", "ㅅㅂ"), true);
  assert.equal(matchesCategorySearch("주거·관리비", "관리"), true);
  assert.equal(matchesCategorySearch("주거·관리비", "ㄱㄹ"), true);
  assert.equal(matchesCategorySearch("카페", "ㅅㅂ"), false);
  assert.equal(matchesCategorySearch("카페", "  "), true);
});
