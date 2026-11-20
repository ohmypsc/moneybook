// 거래 모델 검증과 거래 생성·수정·삭제·복원·정산
import { ensureClassificationSchema, getClassificationSettings } from "../classification.js";
import { classifyTransaction, normalizeTags } from "../domain/classification.js";
import {
  dateOnly as mbD1DateOnly,
  monthOnly as mbD1MonthOnly,
  resolveBillingState as mbD1ResolveBillingState
} from "../domain/date.js";
import { normalizeInstallmentMonths } from "../domain/installment.js";
import {
  isSettlementEligibleCategory as mbD1IsSettlementEligibleCategory,
  isSettlementRequestId as mbD1IsSettlementRequestId,
  SETTLEMENT_REQUEST_PREFIX
} from "../domain/settlement.js";
import {
  mbD1BenefitCategory,
  mbD1LinkedBenefitUpdateStatements,
  mbD1MatchingBenefitRule,
  mbD1PrepareBenefit,
  mbD1SettlementIncomeCategory
} from "./benefits.js";
import {
  MB_D1_HOUSEHOLD_ID,
  mbD1All,
  mbD1CurrentDateSeoul,
  mbD1Fail,
  mbD1First,
  mbD1Has,
  mbD1Id,
  mbD1InsertChange,
  mbD1MemberByName,
  mbD1MemberIdByName,
  mbD1Now,
  mbD1Number,
  mbD1Text,
  mbD1ValidateLedgerDate
} from "./core.js";
import { mbD1GetCategoriesData, mbD1SettlementSummaryData } from "./queries.js";
import {
  mbD1AccountById,
  mbD1CategoryById,
  mbD1MapAccountRow,
  mbD1RawAccounts,
  mbD1TransactionById
} from "./records.js";

export async function mbD1BuildTransactionModel(env, payload, current = null, forCreate = false) {
  const source = current || {};
  const dateInput = mbD1Has(payload, "date") ? payload.date : source.date;
  const date = forCreate ? await mbD1ValidateLedgerDate(env, dateInput) : mbD1DateOnly(dateInput);
  if (!date) mbD1Fail("INVALID_DATE", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  if (!forCreate && mbD1Has(payload, "date")) await mbD1ValidateLedgerDate(env, date);
  const type = mbD1Text(mbD1Has(payload, "type") ? payload.type : source.type);
  if (!["수입", "지출", "이체"].includes(type))
    mbD1Fail("INVALID_TYPE", "유형은 수입, 지출, 이체 중 하나여야 합니다.");
  const amount = Number(mbD1Has(payload, "amount") ? payload.amount : source.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    mbD1Fail("INVALID_NUMBER", "금액은 0보다 큰 숫자여야 합니다.");
  const categoryId = mbD1Text(
    mbD1Has(payload, "categoryId") ? payload.categoryId : source.categoryId
  );
  const keepsExistingCategory = !forCreate && categoryId === mbD1Text(source.categoryId);
  const category = await mbD1CategoryById(env, categoryId, keepsExistingCategory);
  if (!category || ((!category.active || category.isDeleted) && !keepsExistingCategory)) {
    mbD1Fail("CATEGORY_NOT_FOUND", "사용 가능한 카테고리를 찾을 수 없습니다.");
  }
  if (category.type !== type)
    mbD1Fail("CATEGORY_TYPE_MISMATCH", `선택한 카테고리는 \"${category.type}\" 유형입니다.`);

  const rawAccounts = await mbD1RawAccounts(env);
  const accounts = rawAccounts.map(mbD1MapAccountRow);
  const accountMap = new Map(accounts.map(account => [account.accountId, account]));
  const keepsExistingType = !forCreate && type === mbD1Text(source.type);

  function resolveTransactionAccount(id, existingIds, code, message) {
    const account = accountMap.get(id);
    const keepsExistingAccount =
      !forCreate && existingIds.some(existingId => mbD1Text(existingId) === id);
    if (!account || ((!account.active || account.isDeleted) && !keepsExistingAccount)) {
      mbD1Fail(code, message);
    }
    return account;
  }
  let fromAccount = null;
  let toAccount = null;
  let paymentMethod = null;
  let spendingTarget = "";
  if (type === "수입") {
    const toId = mbD1Text(
      mbD1Has(payload, "toAccountId") ? payload.toAccountId : source.toAccountId
    );
    if (!toId) mbD1Fail("INCOME_TO_REQUIRED", "수입 거래에는 입금수단이 필요합니다.");
    toAccount = resolveTransactionAccount(
      toId,
      keepsExistingType ? [source.toAccountId] : [],
      "TO_ACCOUNT_NOT_FOUND",
      "입금수단을 찾을 수 없습니다."
    );
    if (mbD1Has(payload, "fromAccountId") && mbD1Text(payload.fromAccountId))
      mbD1Fail("INCOME_FROM_NOT_ALLOWED", "수입 거래에는 출금수단을 사용할 수 없습니다.");
    if (mbD1Has(payload, "paymentMethodId") && mbD1Text(payload.paymentMethodId))
      mbD1Fail("INCOME_PAYMENT_NOT_ALLOWED", "수입 거래에는 결제수단을 사용할 수 없습니다.");
  }
  if (type === "지출") {
    const paymentId = mbD1Text(
      mbD1Has(payload, "paymentMethodId")
        ? payload.paymentMethodId
        : source.paymentMethodId || source.fromAccountId
    );
    if (!paymentId) mbD1Fail("PAYMENT_METHOD_REQUIRED", "지출 거래에는 결제수단이 필요합니다.");
    paymentMethod = resolveTransactionAccount(
      paymentId,
      keepsExistingType ? [source.paymentMethodId, source.fromAccountId] : [],
      "PAYMENT_METHOD_NOT_FOUND",
      "결제수단을 찾을 수 없습니다."
    );
    spendingTarget = mbD1Text(
      mbD1Has(payload, "spendingTarget") ? payload.spendingTarget : source.spendingTarget
    );
    if (!spendingTarget)
      mbD1Fail("SPENDING_TARGET_REQUIRED", "지출 거래에는 지출대상이 필요합니다.");
    if (spendingTarget !== "공동") {
      const member = await mbD1MemberByName(env, spendingTarget);
      if (!member) mbD1Fail("INVALID_SPENDING_TARGET", "사용할 수 없는 지출대상입니다.");
    }
    if (paymentMethod.subType === "체크카드") {
      const keepsExistingPaymentMethod =
        keepsExistingType && paymentId === mbD1Text(source.paymentMethodId || source.fromAccountId);
      const paymentAccountId =
        keepsExistingPaymentMethod && source.fromAccountId
          ? mbD1Text(source.fromAccountId)
          : mbD1Text(paymentMethod.paymentAccountId);
      if (!paymentAccountId)
        mbD1Fail(
          "CHECK_CARD_ACCOUNT_MISSING",
          `${paymentMethod.displayName}의 결제계좌가 설정되어 있지 않습니다.`
        );
      fromAccount = resolveTransactionAccount(
        paymentAccountId,
        keepsExistingPaymentMethod ? [source.fromAccountId] : [],
        "CHECK_CARD_ACCOUNT_NOT_FOUND",
        `${paymentMethod.displayName}의 연결 통장을 찾을 수 없습니다.`
      );
    } else {
      fromAccount = paymentMethod;
    }
    if (mbD1Has(payload, "toAccountId") && mbD1Text(payload.toAccountId))
      mbD1Fail("EXPENSE_TO_NOT_ALLOWED", "지출 거래에는 입금수단을 사용할 수 없습니다.");
  }
  if (type === "이체") {
    const fromId = mbD1Text(
      mbD1Has(payload, "fromAccountId") ? payload.fromAccountId : source.fromAccountId
    );
    const toId = mbD1Text(
      mbD1Has(payload, "toAccountId") ? payload.toAccountId : source.toAccountId
    );
    if (!fromId || !toId)
      mbD1Fail("TRANSFER_ACCOUNT_REQUIRED", "이체에는 보내는 수단과 받는 수단이 모두 필요합니다.");
    if (fromId === toId)
      mbD1Fail("SAME_TRANSFER_ACCOUNT", "이체의 보내는 수단과 받는 수단은 같을 수 없습니다.");
    fromAccount = resolveTransactionAccount(
      fromId,
      keepsExistingType ? [source.fromAccountId] : [],
      "FROM_ACCOUNT_NOT_FOUND",
      "보내는 수단을 찾을 수 없습니다."
    );
    toAccount = resolveTransactionAccount(
      toId,
      keepsExistingType ? [source.toAccountId] : [],
      "TO_ACCOUNT_NOT_FOUND",
      "받는 수단을 찾을 수 없습니다."
    );
    if (mbD1Has(payload, "paymentMethodId") && mbD1Text(payload.paymentMethodId))
      mbD1Fail("TRANSFER_PAYMENT_NOT_ALLOWED", "이체에는 결제수단을 사용할 수 없습니다.");
  }
  const hasBillingMonthInput = mbD1Has(payload, "billingMonth");
  const requestedBillingMonth = hasBillingMonthInput ? mbD1Text(payload.billingMonth) : "";
  if (requestedBillingMonth && !mbD1MonthOnly(requestedBillingMonth)) {
    mbD1Fail("INVALID_BILLING_MONTH", "청구월은 YYYY-MM 형식이어야 합니다.");
  }

  const { billingOverride, billingMonth } = mbD1ResolveBillingState({
    type,
    isCreditCard: paymentMethod?.subType === "신용카드",
    date,
    cutoffDay: paymentMethod?.billingCutoffDay,
    paymentDay: paymentMethod?.paymentDay,
    hasBillingMonthInput,
    requestedBillingMonth,
    sourceBillingOverride: mbD1Text(source.billingOverride),
    sourceBillingMonth: mbD1Text(source.billingMonth),
    forCreate
  });

  if (billingOverride && !mbD1MonthOnly(billingOverride)) {
    mbD1Fail("INVALID_BILLING_MONTH", "청구월은 YYYY-MM 형식이어야 합니다.");
  }

  // 할부는 신용카드 지출에만 둡니다. 결제수단이 바뀌어 신용카드가 아니게 되면 일시불로 돌립니다.
  let installmentMonths = null;
  if (type === "지출" && paymentMethod?.subType === "신용카드") {
    const installmentInput = mbD1Has(payload, "installmentMonths")
      ? payload.installmentMonths
      : source.installmentMonths;
    const normalizedInstallment = normalizeInstallmentMonths(installmentInput);
    if (normalizedInstallment.error)
      mbD1Fail("INVALID_INSTALLMENT_MONTHS", normalizedInstallment.error);
    installmentMonths = normalizedInstallment.months;
  } else if (mbD1Has(payload, "installmentMonths")) {
    const normalizedInstallment = normalizeInstallmentMonths(payload.installmentMonths);
    if (normalizedInstallment.months) {
      mbD1Fail("INSTALLMENT_CREDIT_CARD_ONLY", "할부는 신용카드 지출에서만 선택할 수 있습니다.");
    }
  }

  return {
    installmentMonths,
    date,
    type,
    categoryId,
    amount,
    fromAccountId: fromAccount?.accountId || null,
    toAccountId: toAccount?.accountId || null,
    paymentMethodId: paymentMethod?.accountId || null,
    spendingTarget: type === "지출" ? spendingTarget : null,
    spenderMemberId: type === "지출" ? await mbD1MemberIdByName(env, spendingTarget) : null,
    description: mbD1Has(payload, "description")
      ? mbD1Text(payload.description)
      : mbD1Text(source.description),
    memo: mbD1Has(payload, "memo") ? mbD1Text(payload.memo) : mbD1Text(source.memo),
    billingOverride,
    billingMonth,
    groupId: mbD1Has(payload, "groupId")
      ? mbD1Text(payload.groupId) || null
      : source.groupId || null,
    reversalOf: mbD1Has(payload, "reversalOf")
      ? mbD1Text(payload.reversalOf) || null
      : source.reversalOf || null
  };
}

export function mbD1LooksLikeRequestIdUniqueConflict(error, tableName) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    message.includes("UNIQUE constraint failed") &&
    message.includes(`${tableName}.household_id`) &&
    message.includes(`${tableName}.request_id`)
  );
}

export const MB_D1_CONCURRENCY_GUARD_TOKEN = "mb_concurrent_modification";

// SQLite의 json()은 올바르지 않은 JSON을 받으면 오류를 내므로, batch 안에서 조건부로 트랜잭션을 중단하는 데 씁니다.
export function mbD1LooksLikeConcurrencyGuardFailure(error) {
  const message = String(error?.message || error?.cause?.message || "");
  return /malformed JSON/i.test(message);
}

export async function mbD1HandleTransactionMutation(path, body, session, env) {
  await ensureClassificationSchema(env);
  if (mbD1Has(body, "settlementExpected") && typeof body.settlementExpected !== "boolean")
    mbD1Fail("INVALID_SETTLEMENT_EXPECTED", "정산 예정 표시는 true 또는 false여야 합니다.");
  if (mbD1Has(body, "categorySource") && !["auto", "manual"].includes(body.categorySource))
    mbD1Fail("INVALID_CATEGORY_SOURCE", "분류 출처가 올바르지 않습니다.");
  if (mbD1Has(body, "tags")) {
    try {
      body = { ...body, tags: normalizeTags(body.tags) };
    } catch (error) {
      mbD1Fail("INVALID_TAGS", error.message);
    }
  }
  const actor = session.name;
  if (path === "/api/transactions") {
    const started = Date.now();
    const requestId = mbD1Text(body.requestId) || mbD1Id("REQ");
    const duplicateRow = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (duplicateRow?.transaction_id) {
      const transaction = await mbD1TransactionById(env, duplicateRow.transaction_id, true);
      return {
        created: false,
        duplicate: true,
        transactionId: duplicateRow.transaction_id,
        requestId,
        row: transaction?.row || 0,
        transaction,
        serverElapsedMs: Date.now() - started
      };
    }

    const rules = (await getClassificationSettings(env, MB_D1_HOUSEHOLD_ID)).rules;
    const classification = classifyTransaction(
      body,
      rules,
      (await mbD1GetCategoriesData(env, new URL("https://local/api/categories"))).items
    );
    body = {
      ...body,
      categoryId: classification.categoryId,
      categorySource: classification.categorySource,
      tags: classification.tags
    };
    const benefit = await mbD1PrepareBenefit(env, body, { strictRewardUsage: true });
    const needsBenefitGroup = Boolean(
      benefit && (benefit.benefitAmount > 0 || benefit.rewardUsedAmount > 0)
    );
    const benefitGroupId = needsBenefitGroup
      ? mbD1Text(body.groupId) || `BENEFIT_GROUP_${requestId}`
      : mbD1Text(body.groupId) || null;
    const modelInput = benefitGroupId ? { ...body, groupId: benefitGroupId } : body;
    const model = await mbD1BuildTransactionModel(env, modelInput, null, true);
    const transactionId = mbD1Id("TX");
    const now = mbD1Now();
    const enteredBy = await mbD1MemberIdByName(env, actor);
    const insert = env.DB.prepare(
      `INSERT INTO transactions (
        transaction_id,household_id,request_id,date,type,category_id,amount,
        from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
        entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
        version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row,installment_months
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      transactionId,
      MB_D1_HOUSEHOLD_ID,
      requestId,
      model.date,
      model.type,
      model.categoryId,
      model.amount,
      model.fromAccountId,
      model.toAccountId,
      model.paymentMethodId,
      model.spendingTarget,
      model.spenderMemberId,
      enteredBy,
      model.description || null,
      model.memo || null,
      model.billingOverride,
      model.billingMonth,
      model.groupId,
      model.reversalOf,
      1,
      now,
      now,
      actor,
      actor,
      null,
      null,
      null,
      model.installmentMonths
    );
    const change = await mbD1InsertChange(
      env,
      "transaction",
      transactionId,
      "created",
      1,
      session,
      {
        date: model.date,
        type: model.type,
        amount: model.amount,
        description: model.description || "",
        categoryId: model.categoryId
      }
    );

    const statements = [
      insert,
      change,
      env.DB.prepare(
        "UPDATE transactions SET tags_json=?,category_source=?,settlement_expected=? WHERE household_id=? AND transaction_id=?"
      ).bind(
        JSON.stringify(body.tags),
        body.categorySource,
        model.type === "지출" && body.settlementExpected === true ? 1 : 0,
        MB_D1_HOUSEHOLD_ID,
        transactionId
      )
    ];
    let benefitTransactionId = null;
    if (benefit && benefit.benefitAmount > 0) {
      const benefitCategory = await mbD1BenefitCategory(env);
      if (!benefitCategory?.category_id) {
        mbD1Fail("BENEFIT_CATEGORY_MISSING", "수입 카테고리 '캐시백/할인혜택'이 필요합니다.");
      }
      const account = await mbD1AccountById(env, benefit.creditAccountId, false);
      if (!account) mbD1Fail("BENEFIT_ACCOUNT_NOT_FOUND", "혜택 반영 계좌를 찾을 수 없습니다.");
      const benefitRequestId = `BENEFIT_${benefit.rule.id}_${requestId}`;
      const benefitDescription =
        benefit.kind === "pre_discount"
          ? `${account.displayName} 선할인`
          : `${account.displayName} 혜택 적립`;
      const benefitModel = await mbD1BuildTransactionModel(
        env,
        {
          date: model.date,
          type: "수입",
          categoryId: benefitCategory.category_id,
          amount: benefit.benefitAmount,
          toAccountId: benefit.creditAccountId,
          description: benefitDescription,
          memo: "",
          groupId: benefitGroupId
        },
        null,
        true
      );
      benefitTransactionId = mbD1Id("TX");
      const benefitInsert = env.DB.prepare(
        `INSERT INTO transactions (
          transaction_id,household_id,request_id,date,type,category_id,amount,
          from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
          entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
          version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        benefitTransactionId,
        MB_D1_HOUSEHOLD_ID,
        benefitRequestId,
        benefitModel.date,
        benefitModel.type,
        benefitModel.categoryId,
        benefitModel.amount,
        benefitModel.fromAccountId,
        benefitModel.toAccountId,
        benefitModel.paymentMethodId,
        benefitModel.spendingTarget,
        benefitModel.spenderMemberId,
        enteredBy,
        benefitModel.description || null,
        benefitModel.memo || null,
        benefitModel.billingOverride,
        benefitModel.billingMonth,
        benefitModel.groupId,
        benefitModel.reversalOf,
        1,
        now,
        now,
        actor,
        actor,
        null,
        null,
        null
      );
      const benefitChange = await mbD1InsertChange(
        env,
        "transaction",
        benefitTransactionId,
        "created",
        1,
        session,
        {
          date: benefitModel.date,
          type: benefitModel.type,
          amount: benefitModel.amount,
          automaticBenefit: true
        }
      );
      statements.push(benefitInsert, benefitChange);
    }

    if (benefit?.kind === "post_reward" && benefit.rewardUsedAmount > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
        ).bind(
          transactionId,
          MB_D1_HOUSEHOLD_ID,
          benefit.rule.id,
          benefit.rule.accountId,
          benefit.rewardUsedAmount,
          now,
          now
        )
      );
    }

    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (mbD1LooksLikeRequestIdUniqueConflict(error, "transactions")) {
        const duplicate = await mbD1First(
          env,
          "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
          [MB_D1_HOUSEHOLD_ID, requestId]
        );
        if (duplicate?.transaction_id) {
          const transaction = await mbD1TransactionById(env, duplicate.transaction_id, true);
          return {
            created: false,
            duplicate: true,
            transactionId: duplicate.transaction_id,
            requestId,
            row: transaction?.row || 0,
            transaction,
            serverElapsedMs: Date.now() - started
          };
        }
      }
      throw error;
    }
    const transaction = await mbD1TransactionById(env, transactionId, true);
    return {
      created: true,
      duplicate: false,
      transactionId,
      requestId,
      row: 0,
      transaction,
      benefit: benefit
        ? {
            kind: benefit.kind,
            ratePercent: benefit.rule.ratePercent,
            faceAmount: benefit.faceAmount,
            actualAmount: benefit.actualAmount,
            benefitAmount: benefit.benefitAmount,
            eligibleAmount: benefit.eligibleAmount,
            rewardBalanceBefore: benefit.rewardBalanceBefore,
            rewardUsedAmount: benefit.rewardUsedAmount,
            rewardBalanceAfter: benefit.rewardBalanceAfter,
            benefitTransactionId
          }
        : null,
      serverElapsedMs: Date.now() - started
    };
  }

  if (path === "/api/transactions/settle-batch") {
    return mbD1CreateSettlements(env, session, {
      items: Array.isArray(body.items) ? body.items : [],
      toAccountId: body.toAccountId,
      date: body.date,
      memo: body.memo,
      requestId: body.requestId
    });
  }

  const transactionId = mbD1Text(body.transactionId);
  if (!transactionId) mbD1Fail("TRANSACTION_ID_REQUIRED", "transactionId가 필요합니다.");
  const current = await mbD1TransactionById(env, transactionId, true);
  if (!current) mbD1Fail("TRANSACTION_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);

  if (path === "/api/transactions/settle") {
    if (current.isDeleted)
      mbD1Fail("TRANSACTION_NOT_FOUND", "정산할 거래를 찾을 수 없습니다.", 404);
    const result = await mbD1CreateSettlements(env, session, {
      items: [{ transactionId, amount: body.amount }],
      toAccountId: body.toAccountId,
      date: body.date,
      memo: body.memo,
      requestId: body.requestId
    });
    return {
      created: result.created,
      duplicate: result.duplicate,
      transaction: result.transactions[0] || null,
      summary: result.summaries[0]
    };
  }

  if (path === "/api/transactions/update") {
    if (current.isDeleted)
      mbD1Fail("TRANSACTION_NOT_FOUND", "수정할 거래를 찾을 수 없습니다.", 404);
    if (!mbD1Has(body, "expectedUpdatedAtMs"))
      mbD1Fail(
        "UPDATE_VERSION_REQUIRED",
        "거래의 최신 버전 정보가 필요합니다. 화면을 새로고침한 뒤 다시 시도하세요.",
        409
      );
    const expected =
      body.expectedUpdatedAtMs === null || body.expectedUpdatedAtMs === ""
        ? null
        : Number(body.expectedUpdatedAtMs);
    if (expected !== null && !Number.isFinite(expected))
      mbD1Fail("INVALID_UPDATE_VERSION", "업데이트 버전 정보가 올바르지 않습니다.");
    if (current.updatedAtMs !== expected)
      mbD1Fail(
        "CONCURRENT_MODIFICATION",
        "거래가 다른 기기에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 수정하세요.",
        409
      );
    const financialKeys = [
      "date",
      "type",
      "categoryId",
      "amount",
      "fromAccountId",
      "toAccountId",
      "paymentMethodId",
      "spendingTarget",
      "billingMonth",
      "groupId",
      "reversalOf",
      "installmentMonths"
    ];
    const financialChange = financialKeys.some(key => mbD1Has(body, key));
    if (financialChange && current.reversalOf)
      mbD1Fail(
        "REVERSAL_FINANCIAL_EDIT_NOT_ALLOWED",
        "환불/정산 거래의 금액·계좌·유형은 직접 수정할 수 없습니다."
      );
    if (financialChange && !current.reversalOf) {
      const reversal = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND reversal_of=? AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, transactionId]
      );
      if (reversal)
        mbD1Fail(
          "ORIGINAL_WITH_REVERSAL_EDIT_NOT_ALLOWED",
          "이미 환불/정산이 연결된 원거래의 금액·계좌·유형은 직접 수정할 수 없습니다."
        );
    }
    let model = await mbD1BuildTransactionModel(env, body, current, false);
    const matchingBenefitRule = financialChange ? await mbD1MatchingBenefitRule(env, model) : null;
    if (financialChange && matchingBenefitRule && !model.groupId) {
      model = {
        ...model,
        groupId: `BENEFIT_GROUP_${current.requestId || transactionId}`
      };
    }
    const now = new Date(Math.max(Date.now(), (current.updatedAtMs || 0) + 1)).toISOString();
    const nextVersion =
      mbD1Number(
        (
          await mbD1First(env, "SELECT version FROM transactions WHERE transaction_id=?", [
            transactionId
          ])
        )?.version,
        1
      ) + 1;
    const update = env.DB.prepare(
      `UPDATE transactions SET date=?,type=?,category_id=?,amount=?,from_account_id=?,to_account_id=?,payment_method_id=?,
       spending_target=?,spender_member_id=?,description=?,memo=?,billing_month_override=?,billing_month=?,group_id=?,reversal_of=?,
       installment_months=?,version=?,updated_at=?,updated_by=? WHERE household_id=? AND transaction_id=? AND deleted_at IS NULL`
    ).bind(
      model.date,
      model.type,
      model.categoryId,
      model.amount,
      model.fromAccountId,
      model.toAccountId,
      model.paymentMethodId,
      model.spendingTarget,
      model.spenderMemberId,
      model.description || null,
      model.memo || null,
      model.billingOverride,
      model.billingMonth,
      model.groupId,
      model.reversalOf,
      model.installmentMonths,
      nextVersion,
      now,
      actor,
      MB_D1_HOUSEHOLD_ID,
      transactionId
    );
    const change = await mbD1InsertChange(
      env,
      "transaction",
      transactionId,
      "updated",
      nextVersion,
      session,
      {
        date: model.date,
        type: model.type,
        amount: model.amount,
        description: model.description || "",
        before: {
          amount: current.amount,
          description: current.description,
          date: current.date,
          category: current.category,
          paymentMethodId: current.paymentMethodId,
          fromAccountId: current.fromAccountId,
          toAccountId: current.toAccountId
        },
        after: {
          amount: model.amount,
          description: model.description,
          date: model.date,
          categoryId: model.categoryId,
          paymentMethodId: model.paymentMethodId,
          fromAccountId: model.fromAccountId,
          toAccountId: model.toAccountId
        }
      }
    );
    const linkedBenefitStatements = financialChange
      ? await mbD1LinkedBenefitUpdateStatements(
          env,
          current,
          model,
          actor,
          session,
          now,
          matchingBenefitRule
        )
      : [];
    // 위의 버전 확인과 실제 저장 사이에 다른 기기가 먼저 저장했다면 batch 전체를 취소합니다.
    const concurrencyGuard = env.DB.prepare(
      `SELECT CASE
         WHEN (SELECT updated_at FROM transactions WHERE household_id=? AND transaction_id=? AND deleted_at IS NULL) IS ?
         THEN 1
         ELSE json('${MB_D1_CONCURRENCY_GUARD_TOKEN}')
       END AS ok`
    ).bind(MB_D1_HOUSEHOLD_ID, transactionId, current.updatedAt ?? null);
    try {
      await env.DB.batch([
        concurrencyGuard,
        ...(body.classificationVersion !== undefined
          ? [
              env.DB.prepare(
                `SELECT CASE WHEN COALESCE((SELECT version FROM user_preferences WHERE household_id=? AND preference_key='classification_rules'),0)=? THEN 1 ELSE json('${MB_D1_CONCURRENCY_GUARD_TOKEN}') END`
              ).bind(MB_D1_HOUSEHOLD_ID, body.classificationVersion)
            ]
          : []),
        update,
        change,
        ...linkedBenefitStatements,
        env.DB.prepare(
          "UPDATE transactions SET tags_json=?,category_source=?,settlement_expected=? WHERE household_id=? AND transaction_id=?"
        ).bind(
          JSON.stringify(mbD1Has(body, "tags") ? body.tags : current.tags),
          mbD1Has(body, "categoryId")
            ? body.categorySource === "auto"
              ? "auto"
              : "manual"
            : current.categorySource,
          model.type === "지출" &&
            (mbD1Has(body, "settlementExpected")
              ? body.settlementExpected === true
              : current.settlementExpected)
            ? 1
            : 0,
          MB_D1_HOUSEHOLD_ID,
          transactionId
        )
      ]);
    } catch (error) {
      if (mbD1LooksLikeConcurrencyGuardFailure(error)) {
        mbD1Fail(
          "CONCURRENT_MODIFICATION",
          "거래가 다른 기기에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 수정하세요.",
          409
        );
      }
      throw error;
    }
    return { updated: true, transaction: await mbD1TransactionById(env, transactionId, true) };
  }

  if (path === "/api/transactions/delete") {
    if (current.isDeleted) return { deleted: true, alreadyDeleted: true, transactionId };
    if (!mbD1Has(body, "expectedUpdatedAtMs"))
      mbD1Fail(
        "UPDATE_VERSION_REQUIRED",
        "거래의 최신 버전 정보가 필요합니다. 화면을 새로고침한 뒤 다시 시도하세요.",
        409
      );
    const expected = body.expectedUpdatedAtMs;
    if (expected !== null && (typeof expected !== "number" || !Number.isFinite(expected)))
      mbD1Fail("INVALID_UPDATE_VERSION", "거래 버전 정보가 올바르지 않습니다.");
    if (current.updatedAtMs !== expected)
      mbD1Fail(
        "CONCURRENT_MODIFICATION",
        "거래가 다른 기기에서 수정되었습니다. 최신 내용을 확인한 뒤 다시 삭제하세요.",
        409
      );
    if (!current.reversalOf) {
      const reversal = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND reversal_of=? AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, transactionId]
      );
      if (reversal)
        mbD1Fail(
          "ORIGINAL_WITH_REVERSAL_DELETE_NOT_ALLOWED",
          "활성 환불/정산이 연결된 원거래는 삭제할 수 없습니다. 연결된 거래를 먼저 삭제하세요."
        );
    }
    const now = mbD1Now();
    const versionRow = await mbD1First(
      env,
      "SELECT version FROM transactions WHERE transaction_id=?",
      [transactionId]
    );
    const nextVersion = mbD1Number(versionRow?.version, 1) + 1;
    const update = env.DB.prepare(
      "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
    ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, transactionId);
    const change = await mbD1InsertChange(
      env,
      "transaction",
      transactionId,
      "deleted",
      nextVersion,
      session,
      {
        amount: current.amount,
        description: current.description,
        date: current.date,
        type: current.type
      }
    );
    const statements = [update, change];
    if (current.groupId && !mbD1Text(current.requestId).startsWith("BENEFIT_")) {
      const linkedBenefits = await mbD1All(
        env,
        "SELECT transaction_id,version FROM transactions WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%' AND deleted_at IS NULL",
        [MB_D1_HOUSEHOLD_ID, current.groupId]
      );
      for (const linked of linkedBenefits) {
        const linkedVersion = mbD1Number(linked.version, 1) + 1;
        statements.push(
          env.DB.prepare(
            "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
          ).bind(now, actor, now, actor, linkedVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
          await mbD1InsertChange(
            env,
            "transaction",
            linked.transaction_id,
            "deleted",
            linkedVersion,
            session,
            { automaticBenefit: true }
          )
        );
      }
    }
    // Recheck the version and linked settlements inside the same atomic batch as deletion.
    const guard = env.DB.prepare(
      `SELECT CASE WHEN
         EXISTS (SELECT 1 FROM transactions WHERE household_id=? AND transaction_id=? AND deleted_at IS NULL AND updated_at IS ?)
         AND (? IS NOT NULL OR NOT EXISTS (SELECT 1 FROM transactions WHERE household_id=? AND reversal_of=? AND deleted_at IS NULL))
       THEN 1 ELSE json('${MB_D1_CONCURRENCY_GUARD_TOKEN}') END AS ok`
    ).bind(
      MB_D1_HOUSEHOLD_ID,
      transactionId,
      current.updatedAt ?? null,
      current.reversalOf || null,
      MB_D1_HOUSEHOLD_ID,
      transactionId
    );
    try {
      await env.DB.batch([guard, ...statements]);
    } catch (error) {
      if (mbD1LooksLikeConcurrencyGuardFailure(error)) {
        mbD1Fail(
          "CONCURRENT_MODIFICATION",
          "거래 또는 연결된 정산 내역이 변경되었습니다. 최신 내용을 확인한 뒤 다시 삭제하세요.",
          409
        );
      }
      throw error;
    }
    return { deleted: true, transactionId };
  }

  if (path === "/api/transactions/restore") {
    if (!current.isDeleted) return { restored: true, alreadyActive: true, transactionId };
    if (mbD1Text(current.requestId).startsWith("BENEFIT_") && current.groupId) {
      const activeMain = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND group_id=? AND request_id NOT LIKE 'BENEFIT_%' AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, current.groupId]
      );
      if (!activeMain)
        mbD1Fail("BENEFIT_ORIGINAL_NOT_ACTIVE", "혜택 적립의 원거래를 먼저 복원해주세요.");
    }
    if (current.reversalOf) {
      const original = await mbD1TransactionById(env, current.reversalOf, true);
      if (!original || original.isDeleted)
        mbD1Fail(
          "REVERSAL_ORIGINAL_NOT_ACTIVE",
          "원거래가 활성 상태가 아니어서 환불/정산 거래를 복원할 수 없습니다."
        );
      if (mbD1IsSettlementRequestId(current.requestId)) {
        const summary = await mbD1SettlementSummaryData(env, current.reversalOf);
        if (mbD1Number(current.amount) > summary.remainingAmount + 0.0001) {
          mbD1Fail(
            "SETTLEMENT_RESTORE_EXCEEDS_REMAINING",
            `현재 남은 정산 가능 금액 ${Math.round(summary.remainingAmount).toLocaleString("ko-KR")}원을 초과해 이 정산 내역을 복원할 수 없습니다.`
          );
        }
      }
    }
    await mbD1BuildTransactionModel(env, {}, current, false);
    const now = mbD1Now();
    const versionRow = await mbD1First(
      env,
      "SELECT version FROM transactions WHERE transaction_id=?",
      [transactionId]
    );
    const nextVersion = mbD1Number(versionRow?.version, 1) + 1;
    const update = env.DB.prepare(
      "UPDATE transactions SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
    ).bind(now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, transactionId);
    const change = await mbD1InsertChange(
      env,
      "transaction",
      transactionId,
      "restored",
      nextVersion,
      session
    );
    const statements = [update, change];
    if (current.groupId && !mbD1Text(current.requestId).startsWith("BENEFIT_")) {
      const linkedBenefits = await mbD1All(
        env,
        "SELECT transaction_id,version FROM transactions WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%' AND deleted_at=?",
        [MB_D1_HOUSEHOLD_ID, current.groupId, current.deletedAt]
      );
      for (const linked of linkedBenefits) {
        const linkedVersion = mbD1Number(linked.version, 1) + 1;
        statements.push(
          env.DB.prepare(
            "UPDATE transactions SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
          ).bind(now, actor, linkedVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
          await mbD1InsertChange(
            env,
            "transaction",
            linked.transaction_id,
            "restored",
            linkedVersion,
            session,
            { automaticBenefit: true }
          )
        );
      }
    }
    await env.DB.batch(statements);
    return { restored: true, transaction: await mbD1TransactionById(env, transactionId, true) };
  }

  mbD1Fail("UNSUPPORTED_TRANSACTION_ACTION", "지원하지 않는 거래 작업입니다.");
}

export const MB_D1_SETTLEMENT_BATCH_LIMIT = 30;

/**
 * 정산받은 돈을 하나 이상의 지출에 나눠 반영합니다.
 * 지출마다 정산 수입 거래를 하나씩 만들어 reversal_of로 연결하므로 지출별 "내 부담"과 월 통계가 그대로 맞습니다.
 * 여러 건이면 같은 group_id로 묶고, 전부 저장되거나 전부 취소되도록 한 batch로 씁니다.
 */
export async function mbD1CreateSettlements(env, session, input) {
  const actor = session.name;
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) mbD1Fail("SETTLEMENT_ITEMS_REQUIRED", "정산할 지출을 선택해주세요.");
  if (rawItems.length > MB_D1_SETTLEMENT_BATCH_LIMIT)
    mbD1Fail(
      "SETTLEMENT_TOO_MANY_ITEMS",
      `한 번에 최대 ${MB_D1_SETTLEMENT_BATCH_LIMIT}건까지 정산할 수 있습니다.`
    );
  const items = rawItems.map(item => ({
    transactionId: mbD1Text(item?.transactionId),
    amount: Number(item?.amount)
  }));
  const seen = new Set();
  for (const item of items) {
    if (!item.transactionId) mbD1Fail("TRANSACTION_ID_REQUIRED", "정산할 지출을 선택해주세요.");
    if (seen.has(item.transactionId))
      mbD1Fail("SETTLEMENT_DUPLICATE_ITEM", "같은 지출을 두 번 선택할 수 없습니다.");
    seen.add(item.transactionId);
    if (!Number.isFinite(item.amount) || item.amount <= 0)
      mbD1Fail("INVALID_SETTLEMENT_AMOUNT", "정산받은 금액을 입력해주세요.");
  }

  const rawRequestId = mbD1Text(input.requestId);
  const baseRequestId = rawRequestId
    ? rawRequestId.startsWith(SETTLEMENT_REQUEST_PREFIX)
      ? rawRequestId
      : `${SETTLEMENT_REQUEST_PREFIX}${rawRequestId}`
    : `${SETTLEMENT_REQUEST_PREFIX}${items[0].transactionId}_${mbD1Id("REQ")}`;
  // 한 건이면 예전과 같은 request id를 써서 기존 재전송 처리와 호환됩니다.
  const requestIds = items.map((_, index) =>
    items.length === 1 ? baseRequestId : `${baseRequestId}_${index + 1}`
  );
  const summariesFor = () =>
    Promise.all(items.map(item => mbD1SettlementSummaryData(env, item.transactionId)));
  const existing = async () => {
    const rows = await mbD1All(
      env,
      `SELECT transaction_id,request_id FROM transactions WHERE household_id=? AND request_id IN (${requestIds
        .map(() => "?")
        .join(",")})`,
      [MB_D1_HOUSEHOLD_ID, ...requestIds]
    );
    if (!rows.length) return null;
    const byRequest = new Map(rows.map(row => [row.request_id, row.transaction_id]));
    const transactions = [];
    for (const requestId of requestIds) {
      const id = byRequest.get(requestId);
      if (id) transactions.push(await mbD1TransactionById(env, id, true));
    }
    return {
      created: false,
      duplicate: true,
      groupId: transactions[0]?.groupId || null,
      transactions,
      summaries: await summariesFor()
    };
  };
  const duplicate = await existing();
  if (duplicate) return duplicate;

  const receiveAccountId = mbD1Text(input.toAccountId);
  if (!receiveAccountId)
    mbD1Fail("SETTLEMENT_ACCOUNT_REQUIRED", "정산금을 받은 현금 또는 계좌를 선택해주세요.");
  const receiveAccount = await mbD1AccountById(env, receiveAccountId, false);
  if (!receiveAccount || !receiveAccount.active || receiveAccount.isDeleted) {
    mbD1Fail("SETTLEMENT_ACCOUNT_NOT_FOUND", "정산금을 받은 계좌를 찾을 수 없습니다.");
  }
  if (
    receiveAccount.accountType !== "자산" ||
    ["신용카드", "체크카드"].includes(receiveAccount.subType)
  ) {
    mbD1Fail("SETTLEMENT_ACCOUNT_INVALID", "정산금은 현금이나 입금 가능한 자산 계좌로 받아주세요.");
  }
  const date = await mbD1ValidateLedgerDate(env, input.date || mbD1CurrentDateSeoul());
  const memo = mbD1Text(input.memo);
  const category = await mbD1SettlementIncomeCategory(env);
  const groupId = items.length > 1 ? `SETTLEMENT_GROUP_${baseRequestId}` : null;
  const enteredBy = await mbD1MemberIdByName(env, actor);
  const now = mbD1Now();

  const statements = [];
  const createdIds = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const original = await mbD1TransactionById(env, item.transactionId, true);
    if (!original || original.isDeleted)
      mbD1Fail("TRANSACTION_NOT_FOUND", "정산할 거래를 찾을 수 없습니다.", 404);
    const label = original.description || original.category || "지출";
    if (!mbD1IsSettlementEligibleCategory(original.type, original.category, original.categoryId)) {
      mbD1Fail("SETTLEMENT_NOT_ELIGIBLE", "정산받기는 정산 가능한 지출에서만 사용할 수 있습니다.");
    }
    if (date < original.date)
      mbD1Fail(
        "SETTLEMENT_BEFORE_ORIGINAL",
        `정산받은 날짜는 원래 지출일(${original.date} · ${label})보다 앞설 수 없습니다.`
      );
    const before = await mbD1SettlementSummaryData(env, item.transactionId);
    if (item.amount > before.remainingAmount + 0.0001) {
      mbD1Fail(
        "SETTLEMENT_AMOUNT_EXCEEDS_REMAINING",
        `${label}: 남은 정산 가능 금액 ${Math.round(before.remainingAmount).toLocaleString("ko-KR")}원을 초과할 수 없습니다.`
      );
    }
    const model = await mbD1BuildTransactionModel(
      env,
      {
        date,
        type: "수입",
        categoryId: category.category_id,
        amount: item.amount,
        toAccountId: receiveAccountId,
        description: `${label} 정산받음`,
        memo,
        groupId,
        reversalOf: item.transactionId
      },
      null,
      true
    );
    const settlementTransactionId = mbD1Id("TX");
    createdIds.push(settlementTransactionId);
    // 앞선 확인과 저장 사이에 원거래가 바뀌었거나 다른 정산이 먼저 들어왔다면 batch 전체를 취소합니다.
    statements.push(
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS (
          SELECT 1 FROM transactions original
          WHERE original.household_id=? AND original.transaction_id=?
            AND original.deleted_at IS NULL AND original.updated_at IS ?
            AND ? <= original.amount - COALESCE((
              SELECT SUM(offset.amount) FROM transactions offset
              WHERE offset.household_id=original.household_id
                AND offset.reversal_of=original.transaction_id AND offset.deleted_at IS NULL
            ),0) + 0.0001
        ) THEN 1 ELSE json('${MB_D1_CONCURRENCY_GUARD_TOKEN}') END AS ok`
      ).bind(MB_D1_HOUSEHOLD_ID, item.transactionId, original.updatedAt ?? null, item.amount),
      env.DB.prepare(
        `INSERT INTO transactions (
          transaction_id,household_id,request_id,date,type,category_id,amount,
          from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
          entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
          version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        settlementTransactionId,
        MB_D1_HOUSEHOLD_ID,
        requestIds[index],
        model.date,
        model.type,
        model.categoryId,
        model.amount,
        model.fromAccountId,
        model.toAccountId,
        model.paymentMethodId,
        model.spendingTarget,
        model.spenderMemberId,
        enteredBy,
        model.description || null,
        model.memo || null,
        model.billingOverride,
        model.billingMonth,
        model.groupId,
        model.reversalOf,
        1,
        now,
        now,
        actor,
        actor,
        null,
        null,
        null
      ),
      await mbD1InsertChange(env, "transaction", settlementTransactionId, "created", 1, session, {
        date: model.date,
        type: model.type,
        amount: model.amount,
        settlementOf: item.transactionId,
        ...(groupId ? { settlementGroupId: groupId } : {})
      })
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (
      mbD1LooksLikeRequestIdUniqueConflict(error, "transactions") ||
      mbD1LooksLikeConcurrencyGuardFailure(error)
    ) {
      const retried = await existing();
      if (retried) return retried;
    }
    if (mbD1LooksLikeConcurrencyGuardFailure(error)) {
      mbD1Fail(
        "CONCURRENT_MODIFICATION",
        "정산 잔액 또는 원거래가 변경되었습니다. 최신 정산 내역을 확인한 뒤 다시 시도하세요.",
        409
      );
    }
    throw error;
  }
  const transactions = [];
  for (const id of createdIds) transactions.push(await mbD1TransactionById(env, id, true));
  return {
    created: true,
    duplicate: false,
    groupId,
    transactions,
    summaries: await summariesFor()
  };
}
