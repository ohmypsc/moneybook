import test from "node:test";
import assert from "node:assert/strict";

import {
  INPUT_MODE_OPTIONS,
  getAccountOwner,
  getBackendType,
  getCategoryLabel,
  isBenefitRuleActive,
  ownerMatchesUser,
  prioritizeAccountsForUser,
  uniqueAccounts,
  type Account
} from "../src/pages/InputPage/inputDomain.ts";

test("owner matching tolerates display-name suffixes used by household accounts", () => {
  assert.equal(ownerMatchesUser("승철", "김승철"), true);
  assert.equal(ownerMatchesUser("미영", "김승철"), false);
  assert.equal(ownerMatchesUser("", "승철"), false);
});

test("account owner falls back to the owner suffix in the display name", () => {
  const account: Account = {
    accountId: "A1",
    displayName: "생활비 통장 (공동)",
    accountType: "자산",
    subType: "입출금"
  };

  assert.equal(getAccountOwner(account), "공동");
});

test("account priority is current user, shared, then other household member", () => {
  const accounts: Account[] = [
    { accountId: "other", displayName: "다른 통장", accountType: "자산", subType: "입출금", owner: "미영" },
    { accountId: "shared", displayName: "공동 통장", accountType: "자산", subType: "입출금", owner: "공동" },
    { accountId: "mine", displayName: "내 통장", accountType: "자산", subType: "입출금", owner: "승철" }
  ];

  assert.deepEqual(
    prioritizeAccountsForUser(accounts, "승철").map(account => account.accountId),
    ["mine", "shared", "other"]
  );
});

test("uniqueAccounts keeps the first account for a duplicated account id", () => {
  const accounts: Account[] = [
    { accountId: "A", displayName: "첫 번째", accountType: "자산", subType: "입출금" },
    { accountId: "A", displayName: "두 번째", accountType: "자산", subType: "입출금" },
    { accountId: "B", displayName: "세 번째", accountType: "자산", subType: "입출금" }
  ];

  assert.deepEqual(uniqueAccounts(accounts).map(account => account.displayName), ["첫 번째", "세 번째"]);
});

test("input mode and special category labels map to backend terms", () => {
  assert.equal(getBackendType("expense"), "지출");
  assert.equal(getBackendType("income"), "수입");
  assert.equal(getBackendType("transfer"), "이체");
  assert.equal(getCategoryLabel({ categoryId: "C", type: "이체", name: "카드정기결제" }), "카드값 결제");
});

test("benefit rule activity respects enabled/rate/date boundaries", () => {
  const base = {
    ruleId: "R1",
    paymentMethodId: "CARD",
    name: "혜택",
    kind: "discount" as const,
    ratePercent: 5,
    enabled: true,
    validFrom: "2026-01-01",
    validTo: "2026-12-31"
  };

  assert.equal(isBenefitRuleActive(base as any, "2026-06-01"), true);
  assert.equal(isBenefitRuleActive({ ...base, enabled: false } as any, "2026-06-01"), false);
  assert.equal(isBenefitRuleActive(base as any, "2027-01-01"), false);
});

test("input mode options keep one canonical order and label set", () => {
  assert.deepEqual(INPUT_MODE_OPTIONS, [
    { value: "expense", label: "지출" },
    { value: "income", label: "수입" },
    { value: "transfer", label: "이체" },
    { value: "investment", label: "투자" }
  ]);
});

