import test from "node:test";
import assert from "node:assert/strict";

import {
  getAccountPickerGroups,
  getPickerItems,
  getPickerSelectedValue,
  getPickerTitle
} from "../src/pages/InputPage/inputPicker.ts";
import type { Account, Category } from "../src/pages/InputPage/inputDomain.ts";

const accounts: Account[] = [
  { accountId: "mine", displayName: "내 통장", accountType: "자산", subType: "입출금", owner: "승철" },
  { accountId: "shared", displayName: "공동 통장", accountType: "자산", subType: "입출금", owner: "공동" },
  { accountId: "other", displayName: "다른 카드", accountType: "자산", subType: "신용카드", owner: "미영" }
];

const accountContext = {
  userName: "승철",
  orderedAllAccounts: accounts,
  visibleAccounts: accounts.slice(0, 2),
  creditCards: [],
  cardSourceAccounts: accounts.slice(0, 2),
  visibleAccountIds: new Set(["mine", "shared"]),
  investmentAccountIds: new Set<string>(),
  selectedCardAccountId: ""
};

test("picker title reflects transfer category mode", () => {
  assert.equal(getPickerTitle("category", "expense"), "카테고리 선택");
  assert.equal(getPickerTitle("category", "transfer"), "이체 분류 선택");
  assert.equal(getPickerTitle("loanAccount", "transfer"), "대출계좌 선택");
});

test("account picker groups current/shared accounts before other owner accounts", () => {
  const groups = getAccountPickerGroups("paymentMethod", accountContext);

  assert.deepEqual(groups.primary.map(account => account.accountId), ["mine", "shared"]);
  assert.deepEqual(groups.other.map(account => account.accountId), ["other"]);
});

test("transfer category picker puts loan repayment and card settlement first", () => {
  const categories: Category[] = [
    { categoryId: "food", type: "지출", name: "식비" },
    { categoryId: "prepay", type: "이체", name: "카드선결제" },
    { categoryId: "billing", type: "이체", name: "카드정기결제" },
    { categoryId: "principal", type: "이체", name: "대출원금상환" }
  ];

  const items = getPickerItems("category", {
    ...accountContext,
    mode: "transfer",
    categories,
    spendingTargets: []
  });

  assert.deepEqual(
    items.map(item => item.label),
    ["대출 상환", "카드값 결제", "카드 선결제", "식비"]
  );
});

test("spending targets always put shared first", () => {
  const items = getPickerItems("spendingTarget", {
    ...accountContext,
    mode: "expense",
    categories: [],
    spendingTargets: ["승철", "미영", "공동"]
  });

  assert.deepEqual(items.map(item => item.value), ["공동", "미영", "승철"]);
});

test("picker selection maps account roles to the right state value", () => {
  const selection = {
    categoryId: "C",
    paymentMethodId: "PM",
    spendingTarget: "공동",
    fromAccountId: "FROM",
    toAccountId: "TO",
    investmentAccountId: "INV"
  };

  assert.equal(getPickerSelectedValue("paymentMethod", selection), "PM");
  assert.equal(getPickerSelectedValue("loanSource", selection), "FROM");
  assert.equal(getPickerSelectedValue("loanAccount", selection), "TO");
  assert.equal(getPickerSelectedValue("investmentAccount", selection), "INV");
});
