import test from "node:test";
import assert from "node:assert/strict";

import {
  addCategoryUsage,
  getChoseong,
  getFrequentCategoryIds,
  matchesCategorySearch,
  parseCategoryUsage,
  readCategoryUsage,
  recordCategoryUsage
} from "../src/utils/categoryUsage.ts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  };
}

test("사용 기록은 사람별로 쌓이고 깨진 값은 무시한다", () => {
  const storage = memoryStorage();
  recordCategoryUsage("민지", "C1", storage, 1);
  recordCategoryUsage("민지", "C1", storage, 2);
  recordCategoryUsage("준호", "C2", storage, 3);

  assert.deepEqual(readCategoryUsage("민지", storage), { C1: { count: 2, lastUsedAt: 2 } });
  assert.deepEqual(readCategoryUsage("준호", storage), { C2: { count: 1, lastUsedAt: 3 } });
  assert.deepEqual(parseCategoryUsage("{broken"), {});
  assert.deepEqual(parseCategoryUsage('{"C1":{"count":-1},"C2":{"count":3}}'), {
    C2: { count: 3, lastUsedAt: 0 }
  });
});

test("저장소가 없거나 막혀 있어도 오류 없이 넘어간다", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    }
  };
  assert.doesNotThrow(() => recordCategoryUsage("민지", "C1", blocked));
  assert.deepEqual(readCategoryUsage("민지", blocked), {});
  assert.deepEqual(readCategoryUsage("민지", null), {});
});

test("기록이 너무 많으면 오래 안 쓴 것부터 정리한다", () => {
  let usage = {};
  for (let index = 0; index < 205; index += 1) usage = addCategoryUsage(usage, `C${index}`, index);
  assert.equal(Object.keys(usage).length, 200);
  assert.equal("C0" in usage, false);
  assert.equal("C204" in usage, true);
});

test("자주 쓰는 순서: 기기 기록과 최근 거래를 합치고 없는 카테고리는 뺀다", () => {
  const ids = getFrequentCategoryIds(
    ["식비", "카페", "교통", "문화"],
    { 카페: { count: 3, lastUsedAt: 10 }, 삭제됨: { count: 9, lastUsedAt: 1 } },
    ["식비", "식비", "교통", "식비", "카페", null]
  );
  assert.deepEqual(ids, ["카페", "식비", "교통"]);
  assert.deepEqual(getFrequentCategoryIds(["식비"], {}, []), []);
});

test("검색은 부분 일치와 초성을 모두 받는다", () => {
  assert.equal(getChoseong("식비"), "ㅅㅂ");
  assert.equal(matchesCategorySearch("식비", "ㅅㅂ"), true);
  assert.equal(matchesCategorySearch("주거·관리비", "관리"), true);
  assert.equal(matchesCategorySearch("주거·관리비", "ㄱㄹ"), true);
  assert.equal(matchesCategorySearch("카페", "ㅅㅂ"), false);
  assert.equal(matchesCategorySearch("카페", "  "), true);
});
