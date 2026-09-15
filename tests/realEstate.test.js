import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateApartmentValue,
  getRealEstateCurrentValue,
  parseApartmentTradeXml,
  parseKrwTenThousands
} from "../worker/domain/realEstate.js";

test("만원 단위 실거래 금액을 원으로 변환", () => {
  assert.equal(parseKrwTenThousands("68,500"), 685000000);
});

test("국토부 XML 거래를 파싱하고 취소 여부를 보존", () => {
  const xml = `<response><body><items>
    <item><aptNm>두루마을 1단지</aptNm><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>3</dealDay><dealAmount>68,500</dealAmount><excluUseAr>84.95</excluUseAr><floor>10</floor></item>
    <item><aptNm>두루마을 1단지</aptNm><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>1</dealDay><dealAmount>67,000</dealAmount><excluUseAr>84.95</excluUseAr><floor>8</floor><cdealDay>20260815</cdealDay></item>
  </items></body></response>`;
  const rows = parseApartmentTradeXml(xml);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amountKrw, 685000000);
  assert.equal(rows[1].canceled, true);
});

test("동일 단지/면적 최근 거래 중앙값으로 시세 추정", () => {
  const trades = [670, 685, 700].map((million, index) => ({
    apartmentName: "두루마을 1단지",
    normalizedName: "두루마을1단지",
    date: `2026-0${9-index}-01`,
    amountKrw: million * 1000000,
    exclusiveAreaSqm: 84.95,
    floor: 10 + index,
    canceled: false
  }));
  const result = estimateApartmentValue(trades, { apartmentName: "두루마을1단지아파트", exclusiveAreaSqm: 84.9, floor: 11 });
  assert.equal(result.tradeCount, 3);
  assert.equal(result.estimatedValueKrw, 685000000);
  assert.equal(result.lowKrw, 670000000);
  assert.equal(result.highKrw, 700000000);
});

test("수동 평가액은 자동 추정가보다 우선", () => {
  assert.equal(getRealEstateCurrentValue({ valuationMode: "manual", manualValueKrw: 700000000, estimatedValueKrw: 680000000 }), 700000000);
});
