import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateYearSpending,
  buildRecommendations,
  computeCardDeduction,
  getTaxRules,
  paymentKindOf
} from "../worker/domain/yearEndTax.js";

const rules = getTaxRules(2026);
const M = 1_000_000;

test("only the spending above 25% of salary is deducted, filling the threshold with credit card first", () => {
  // 총급여 5천만 원 → 문턱 1,250만 원. 신용카드 1,000만 + 체크카드 1,000만
  // 문턱은 신용카드 1,000만 + 체크카드 250만으로 채우고, 남은 체크카드 750만 × 30% = 225만 원
  const result = computeCardDeduction({ salary: 50 * M, usage: { credit: 10 * M, debit: 10 * M } }, rules);
  assert.equal(result.threshold, 12.5 * M);
  assert.equal(result.deductible, 2.25 * M);
  assert.equal(result.total, 2.25 * M);
  assert.equal(result.stage, "deducting");
  assert.equal(result.remainingBasic, 0.75 * M);
  assert.equal(result.debitSpendToFillBasic, 2.5 * M);
});

test("below the threshold nothing is deducted and the remaining gap is reported", () => {
  const result = computeCardDeduction({ salary: 60 * M, usage: { credit: 5 * M, debit: 2 * M } }, rules);
  assert.equal(result.total, 0);
  assert.equal(result.remainingToThreshold, 8 * M);
  assert.equal(result.stage, "below-threshold");
});

test("2026 basic limit grows with children and market/transit get an extra limit", () => {
  // 총급여 4천만 원(문턱 1,000만), 체크카드 3,000만 → 기본 공제 가능액 600만
  const noKids = computeCardDeduction({ salary: 40 * M, usage: { debit: 30 * M } }, rules);
  assert.equal(noKids.basicLimit, 3 * M);
  assert.equal(noKids.total, 3 * M);
  assert.equal(noKids.stage, "basic-limit-reached");

  const twoKids = computeCardDeduction({ salary: 40 * M, children: 3, usage: { debit: 30 * M } }, rules);
  assert.equal(twoKids.basicLimit, 4 * M, "자녀 가산은 최대 100만 원");
  assert.equal(twoKids.total, 4 * M);

  // 대중교통 200만 × 40% = 80만 원은 기본 한도를 넘어도 추가 공제
  const withTransit = computeCardDeduction(
    { salary: 40 * M, usage: { debit: 30 * M, transitDebit: 2 * M } },
    rules
  );
  assert.equal(withTransit.basicDeduction, 3 * M);
  assert.equal(withTransit.additionalDeduction, 0.8 * M);
  assert.equal(withTransit.total, 3.8 * M);

  const highEarner = computeCardDeduction({ salary: 80 * M, children: 2, usage: { debit: 60 * M } }, rules);
  assert.equal(highEarner.basicLimit, 3 * M, "7천만 원 초과는 250만 + 자녀 최대 50만");
  assert.equal(highEarner.additionalLimit, 2 * M);
});

test("culture spending is 30% only up to 70M salary; above that it follows the payment type", () => {
  const low = computeCardDeduction({ salary: 40 * M, usage: { credit: 10 * M, cultureCredit: 2 * M } }, rules);
  assert.equal(low.usage.culture, 2 * M);
  assert.equal(low.deductible, 0.6 * M); // 문턱 1,000만은 신용카드로 채우고 문화 200만 × 30%

  const high = computeCardDeduction({ salary: 80 * M, usage: { credit: 20 * M, cultureCredit: 2 * M } }, rules);
  assert.equal(high.usage.culture, 0);
  assert.equal(high.usage.credit, 22 * M);
  assert.equal(high.deductible, Math.round(2 * M * 0.15));
});

test("unknown future years reuse the latest rules and say so", () => {
  const future = getTaxRules(2028);
  assert.equal(future.estimated, true);
  assert.equal(future.basedOnYear, 2026);
  assert.equal(getTaxRules(2026).estimated, false);
});

test("spending is grouped by the card owner and refunds are taken out", () => {
  const accounts = [
    { accountId: "SC_CREDIT", subType: "신용카드", owner: "승철" },
    { accountId: "MY_CHECK", subType: "체크카드", owner: "미영" },
    { accountId: "CASH", subType: "현금", owner: "공동" },
    { accountId: "FAMILY", subType: "신용카드", owner: "공동" }
  ];
  const codes = new Map([["HOSPITAL", "medical"], ["PHONE", "excluded"], ["BUS", "transit"], ["DONATE", "donation"]]);
  const tx = (id, extra) => ({ transactionId: id, type: "지출", date: "2026-03-01", amount: 10_000, categoryId: "FOOD", spendingTarget: "공동", ...extra });
  const people = aggregateYearSpending({
    year: 2026,
    members: ["승철", "미영"],
    accounts,
    categoryTaxCodes: codes,
    transactions: [
      tx("1", { paymentMethodId: "SC_CREDIT", amount: 50_000, refundAmount: 20_000 }),
      tx("2", { paymentMethodId: "MY_CHECK", categoryId: "HOSPITAL", amount: 30_000, spendingTarget: "승철" }),
      tx("3", { paymentMethodId: "MY_CHECK", categoryId: "PHONE" }),
      tx("4", { paymentMethodId: "SC_CREDIT", categoryId: "BUS" }),
      tx("5", { paymentMethodId: "CASH", categoryId: "DONATE" }),
      tx("6", { paymentMethodId: "FAMILY" }),
      tx("7", { paymentMethodId: "SC_CREDIT", date: "2025-12-31" }),
      tx("8", { paymentMethodId: "SC_CREDIT", reversalOf: "1" }),
      { transactionId: "9", type: "수입", date: "2026-03-01", amount: 99_999 }
    ]
  });

  const sc = people.get("승철");
  assert.equal(sc.usage.credit, 30_000);
  assert.equal(sc.usage.transitCredit, 10_000);

  const my = people.get("미영");
  assert.equal(my.usage.debit, 30_000, "의료비도 카드공제에 포함");
  assert.equal(my.usage.excluded, 10_000);
  assert.deepEqual(my.items.medical, { total: 30_000, byTarget: { 승철: 30_000 } });

  // 현금 결제 기부금은 카드공제에는 안 잡히지만 기부금 항목에는 잡힘
  const shared = people.get("명의 미지정");
  assert.equal(shared.usage.notCounted, 10_000);
  assert.equal(shared.items.donation.total, 10_000);
  assert.equal(shared.usage.credit, 10_000, "공동 명의 카드는 '명의 미지정'으로 모음");

  assert.equal(paymentKindOf({ subType: "선불/지역화폐" }), "debit");
});

test("recommendations tell the couple whose card to use", () => {
  const person = (name, salary, usage, items = {}) => ({
    name,
    items,
    card: computeCardDeduction({ salary, usage }, rules)
  });

  const tips = buildRecommendations([
    person("승철", 60 * M, { credit: 20 * M }),
    person("미영", 40 * M, { credit: 3 * M }, { medical: { total: 2 * M } })
  ], rules);

  const texts = tips.map(tip => tip.text).join("\n");
  assert.match(texts, /승철님은 문턱을 넘었어요/);
  assert.match(texts, /미영님은 카드 사용액이 총급여의 25%\(1,000만 원\)까지 700만 원 남았어요/);
  assert.match(texts, /공동 지출은 이미 문턱을 넘은 승철님 카드로/);
  assert.match(texts, /의료비 200만 원은 미영님 카드로/);
});

import {
  estimateGrossFromNet,
  isSalaryCategory,
  netPayRatio,
  summarizeSalaryIncome
} from "../worker/domain/yearEndTax.js";

test("gross salary is estimated back from take-home pay", () => {
  // 총급여 5천만 원의 실수령은 약 85% → 4,250만 원
  assert.equal(estimateGrossFromNet(50 * M * netPayRatio(50 * M)), 50 * M);
  assert.equal(estimateGrossFromNet(36 * M), Math.round(36 * M / netPayRatio(estimateGrossFromNet(36 * M)) / 10_000) * 10_000);
  assert.equal(estimateGrossFromNet(0), 0);
  // 실수령이 많을수록 총급여도 큼
  assert.ok(estimateGrossFromNet(60 * M) > estimateGrossFromNet(50 * M));
});

test("salary categories are found by name unless the couple says otherwise", () => {
  assert.equal(isSalaryCategory("급여", ""), true);
  assert.equal(isSalaryCategory("상여금", ""), true);
  assert.equal(isSalaryCategory("이자", ""), false);
  assert.equal(isSalaryCategory("부업", "salary"), true);
  assert.equal(isSalaryCategory("급여(알바 정산)", "not-salary"), false);
});

test("take-home salary is summed per receiving account owner and annualized mid-year", () => {
  const accounts = [
    { accountId: "SC_BANK", owner: "승철" },
    { accountId: "MY_BANK", owner: "미영" },
    { accountId: "JOINT", owner: "공동" }
  ];
  const pay = (id, date, amount, toAccountId, extra = {}) => ({ transactionId: id, type: "수입", categoryId: "PAY", date, amount, toAccountId, ...extra });
  const summaries = summarizeSalaryIncome({
    year: 2026,
    currentMonth: "2026-04",
    members: ["승철", "미영"],
    accounts,
    salaryCategoryIds: new Set(["PAY"]),
    transactions: [
      pay("1", "2026-01-25", 3_500_000, "SC_BANK"),
      pay("2", "2026-02-25", 3_500_000, "SC_BANK"),
      pay("3", "2026-03-25", 3_500_000, "SC_BANK"),
      pay("4", "2026-03-31", 1_000_000, "SC_BANK"),
      pay("5", "2026-02-25", 2_800_000, "MY_BANK"),
      pay("6", "2026-02-25", 9_999_999, "JOINT"),
      pay("7", "2025-12-25", 9_999_999, "SC_BANK"),
      { transactionId: "8", type: "수입", categoryId: "OTHER", date: "2026-02-01", amount: 9_999_999, toAccountId: "MY_BANK" },
      pay("9", "2026-02-26", 50_000, "MY_BANK", { requestId: "BENEFIT_x" })
    ]
  });

  const sc = summaries.get("승철");
  assert.equal(sc.netTotal, 11_500_000);
  assert.equal(sc.months, 3);
  assert.equal(sc.annualized, true);
  assert.equal(sc.annualizedNet, 46_000_000);
  assert.ok(sc.estimatedGross > 46_000_000);

  const my = summaries.get("미영");
  assert.equal(my.netTotal, 2_800_000);
  assert.equal(my.annualizedNet, 33_600_000);

  // 지난해는 환산하지 않음
  const past = summarizeSalaryIncome({
    year: 2026, currentMonth: "2027-02", members: ["승철"], accounts, salaryCategoryIds: new Set(["PAY"]),
    transactions: [pay("1", "2026-01-25", 3_000_000, "SC_BANK")]
  });
  assert.equal(past.get("승철").annualized, false);
  assert.equal(past.get("승철").annualizedNet, 3_000_000);
});
