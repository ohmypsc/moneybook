import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_KIND_OPTIONS,
  applyAccountKind,
  buildAccountPayload,
  createEmptyAccountForm,
  parseBenefitSettings,
  parseOptionalInteger,
  parseRewardOpeningBalance
} from "../src/pages/SettingsPage/accountDomain.ts";

test("account kind switching clears fields that no longer apply", () => {
  const form = {
    ...createEmptyAccountForm("공동"),
    paymentAccountId: "BANK_1",
    billingCutoffDay: "15",
    paymentDay: "25",
    benefitKind: "cashback" as const,
    benefitRatePercent: "10"
  };

  const credit = ACCOUNT_KIND_OPTIONS.find(item => item.value === "creditCard")!;
  const checking = ACCOUNT_KIND_OPTIONS.find(item => item.value === "checking")!;

  const creditForm = applyAccountKind(form, credit);
  assert.equal(creditForm.paymentAccountId, "BANK_1");
  assert.equal(creditForm.billingCutoffDay, "15");

  const checkingForm = applyAccountKind(creditForm, checking);
  assert.equal(checkingForm.paymentAccountId, "");
  assert.equal(checkingForm.billingCutoffDay, "");
  assert.equal(checkingForm.paymentDay, "");
});

test("account payload validates card payment account and year boundaries", () => {
  const credit = ACCOUNT_KIND_OPTIONS.find(item => item.value === "creditCard")!;
  const form = applyAccountKind(createEmptyAccountForm("공동"), credit);
  form.accountName = "생활카드";
  assert.throws(() => buildAccountPayload(form), /결제계좌/);

  form.paymentAccountId = "BANK_1";
  form.startYear = "2027";
  form.endYear = "2026";
  assert.throws(() => buildAccountPayload(form), /사용 시작 연도/);

  form.startYear = "2025";
  const payload = buildAccountPayload(form);
  assert.equal(payload.paymentAccountId, "BANK_1");
  assert.equal(payload.subType, "신용카드");
});

test("prepaid benefit validation keeps reward opening balance within total balance", () => {
  const prepaid = ACCOUNT_KIND_OPTIONS.find(item => item.value === "prepaid")!;
  const form = applyAccountKind(createEmptyAccountForm("공동"), prepaid);
  form.openingBalance = "10000";
  form.rewardOpeningBalance = "3000";
  form.benefitKind = "cashback";
  form.benefitRatePercent = "10";

  const reward = parseRewardOpeningBalance(form, 10000);
  assert.equal(reward, 3000);
  assert.equal(parseBenefitSettings(form, reward)?.ratePercent, 10);

  form.rewardOpeningBalance = "12000";
  assert.throws(() => parseRewardOpeningBalance(form, 10000), /시작 잔액보다 클 수 없습니다/);
});

test("optional integer parser accepts blank and rejects out-of-range values", () => {
  assert.equal(parseOptionalInteger("", "결제일", 1, 31), null);
  assert.equal(parseOptionalInteger("25", "결제일", 1, 31), 25);
  assert.throws(() => parseOptionalInteger("32", "결제일", 1, 31), /1~31/);
});
