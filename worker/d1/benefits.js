// 카드 혜택 계산, 혜택 적립금 사용 기록, 연결된 혜택 거래 갱신
import { dateOnly as mbD1DateOnly } from "../domain/date.js";
import { BENEFIT_INCOME_CATEGORY_NAME, CASHBACK_INCOME_CATEGORY_NAME, DEFAULT_CATEGORY_IDS, SETTLEMENT_INCOME_CATEGORY_NAME, SYSTEM_CATEGORY_IDS } from "../domain/settlement.js";
import { mbD1AutomationSettingsData } from "./automation.js";
import { MB_D1_HOUSEHOLD_ID, mbD1Bool, mbD1Fail, mbD1First, mbD1Id, mbD1InsertChange, mbD1MemberIdByName, mbD1Now, mbD1Number, mbD1Text } from "./core.js";
import { mbD1AccountById, mbD1CategoryById } from "./records.js";
import { mbD1BuildTransactionModel } from "./transactions.js";

export function mbD1BenefitRuleIsActive(rule, date) {
  if (!rule || !rule.enabled || rule.kind === "none" || rule.ratePercent <= 0) return false;
  if (rule.validFrom && date < rule.validFrom) return false;
  if (rule.validTo && date > rule.validTo) return false;
  return true;
}

export async function mbD1EnsureSystemCategory(env, { categoryId, type, name }) {
  let row = await mbD1First(
    env,
    `SELECT category_id,name,is_active,deleted_at,type
     FROM categories
     WHERE household_id=?
       AND (category_id=? OR (type=? AND name=?))
     ORDER BY
       CASE WHEN type=? AND name=? AND deleted_at IS NULL AND is_active=1 THEN 0
            WHEN type=? AND name=? THEN 1
            WHEN category_id=? THEN 2
            ELSE 3 END,
       updated_at DESC
     LIMIT 1`,
    [
      MB_D1_HOUSEHOLD_ID,
      categoryId,
      type,
      name,
      type,
      name,
      type,
      name,
      categoryId
    ]
  );

  const now = mbD1Now();
  if (row?.category_id) {
    const needsRepair = row.type !== type || row.name !== name || row.deleted_at || !mbD1Bool(row.is_active);
    if (needsRepair) {
      await env.DB.prepare(
        `UPDATE categories
         SET type=?,name=?,is_active=1,deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?
         WHERE household_id=? AND category_id=?`
      ).bind(type, name, now, "system", MB_D1_HOUSEHOLD_ID, row.category_id).run();
      return { ...row, type, name, is_active: 1, deleted_at: null };
    }
    return row;
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
  ).bind(
    categoryId,
    MB_D1_HOUSEHOLD_ID,
    type,
    name,
    1,
    now,
    now,
    "system",
    "system",
    null,
    null
  ).run();

  row = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND category_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, categoryId]
  );
  if (!row?.category_id) mbD1Fail("SYSTEM_CATEGORY_CREATE_FAILED", `${name} 카테고리를 준비하지 못했습니다.`, 500);
  return row;
}

export async function mbD1EnsureDefaultCashbackIncomeCategory(env) {
  const categoryId = DEFAULT_CATEGORY_IDS.cashbackIncome;

  // 고정 ID가 한 번이라도 만들어졌다면 이후 이름 변경/삭제는 사용자의 선택으로 존중한다.
  const byId = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND category_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, categoryId]
  );
  if (byId?.category_id) return byId;

  // 기존에 사용자가 만든 '캐시백' 카테고리가 있거나 삭제 이력이 있으면 중복 생성하지 않는다.
  const existing = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND type='수입' AND name=? ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, CASHBACK_INCOME_CATEGORY_NAME]
  );
  if (existing?.category_id) return existing;

  const now = mbD1Now();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
  ).bind(
    categoryId,
    MB_D1_HOUSEHOLD_ID,
    "수입",
    CASHBACK_INCOME_CATEGORY_NAME,
    1,
    now,
    now,
    "system-default",
    "system-default",
    null,
    null
  ).run();

  return mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND category_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, categoryId]
  );
}

export async function mbD1SettlementIncomeCategory(env) {
  return mbD1EnsureSystemCategory(env, {
    categoryId: SYSTEM_CATEGORY_IDS.settlementIncome,
    type: "수입",
    name: SETTLEMENT_INCOME_CATEGORY_NAME
  });
}

export async function mbD1BenefitCategory(env) {
  return mbD1EnsureSystemCategory(env, {
    categoryId: SYSTEM_CATEGORY_IDS.benefitIncome,
    type: "수입",
    name: BENEFIT_INCOME_CATEGORY_NAME
  });
}

export let mbD1BenefitUsageSchemaReady = false;
export let mbD1BenefitUsageSchemaPromise = null;

export async function mbD1EnsureBenefitUsageSchema(env) {
  if (mbD1BenefitUsageSchemaReady) return;
  if (!mbD1BenefitUsageSchemaPromise) {
    mbD1BenefitUsageSchemaPromise = env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS benefit_reward_usage (
          transaction_id TEXT PRIMARY KEY,
          household_id TEXT NOT NULL,
          rule_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          used_amount REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      ),
      env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_benefit_reward_usage_household_rule ON benefit_reward_usage(household_id, rule_id, account_id)"
      )
    ])
      .then(() => {
        mbD1BenefitUsageSchemaReady = true;
      })
      .catch((error) => {
        mbD1BenefitUsageSchemaPromise = null;
        throw error;
      });
  }
  await mbD1BenefitUsageSchemaPromise;
}

export async function mbD1BenefitRewardUsageRecord(env, transactionId) {
  await mbD1EnsureBenefitUsageSchema(env);
  return mbD1First(
    env,
    `SELECT transaction_id,rule_id,account_id,used_amount
     FROM benefit_reward_usage
     WHERE household_id=? AND transaction_id=? LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, transactionId]
  );
}

export async function mbD1BenefitRewardBalance(env, rule, excludeTransactionId = "", excludeBenefitRequestId = "") {
  await mbD1EnsureBenefitUsageSchema(env);
  const earnedSql = `SELECT COALESCE(SUM(amount),0) AS earned
                     FROM transactions
                     WHERE household_id=? AND type='수입' AND to_account_id=?
                       AND request_id LIKE ? AND deleted_at IS NULL
                       ${excludeBenefitRequestId ? "AND request_id<>?" : ""}`;
  const earnedBinds = [MB_D1_HOUSEHOLD_ID, rule.accountId, `BENEFIT_${rule.id}_%`];
  if (excludeBenefitRequestId) earnedBinds.push(excludeBenefitRequestId);
  const earnedRow = await mbD1First(env, earnedSql, earnedBinds);
  const usedSql = `SELECT COALESCE(SUM(u.used_amount),0) AS used
                   FROM benefit_reward_usage u
                   JOIN transactions t
                     ON t.transaction_id=u.transaction_id
                    AND t.household_id=u.household_id
                   WHERE u.household_id=? AND u.rule_id=? AND u.account_id=?
                     AND t.deleted_at IS NULL
                     ${excludeTransactionId ? "AND u.transaction_id<>?" : ""}`;
  const usedBinds = [MB_D1_HOUSEHOLD_ID, rule.id, rule.accountId];
  if (excludeTransactionId) usedBinds.push(excludeTransactionId);
  const usedRow = await mbD1First(env, usedSql, usedBinds);
  const opening = Math.max(0, mbD1Number(rule.rewardOpeningBalance, 0));
  const earned = Math.max(0, mbD1Number(earnedRow?.earned, 0));
  const used = Math.max(0, mbD1Number(usedRow?.used, 0));
  return Math.max(0, Math.floor(opening + earned - used + 1e-9));
}

export async function mbD1BenefitRewardBalancesData(env) {
  const settings = await mbD1AutomationSettingsData(env);
  const rules = settings.benefitRules.filter((rule) => rule.accountId && (rule.kind === "post_reward" || rule.rewardOpeningBalance > 0));
  return Promise.all(
    rules.map(async (rule) => ({
      ruleId: rule.id,
      accountId: rule.accountId,
      rewardBalance: await mbD1BenefitRewardBalance(env, rule)
    }))
  );
}

export async function mbD1BenefitUsedThisMonth(env, rule, date, excludeRequestId = "") {
  if (rule.monthlyCap === null) return 0;
  const month = date.slice(0, 7);
  const sql = `SELECT COALESCE(SUM(amount),0) AS used
               FROM transactions
               WHERE household_id=? AND type='수입' AND date>=? AND date<?
                 AND request_id LIKE ? AND deleted_at IS NULL
                 ${excludeRequestId ? "AND request_id<>?" : ""}`;
  const binds = [MB_D1_HOUSEHOLD_ID, `${month}-01`, `${month}-32`, `BENEFIT_${rule.id}_%`];
  if (excludeRequestId) binds.push(excludeRequestId);
  const row = await mbD1First(env, sql, binds);
  return Math.max(0, mbD1Number(row?.used, 0));
}

export async function mbD1CalculateBenefit(env, rule, baseAmount, date, excludeRequestId = "") {
  if (!mbD1BenefitRuleIsActive(rule, date)) return 0;
  const gross = Math.max(0, Math.floor((mbD1Number(baseAmount) * rule.ratePercent) / 100 + 1e-9));
  if (gross <= 0) return 0;
  if (rule.monthlyCap === null) return gross;
  const used = await mbD1BenefitUsedThisMonth(env, rule, date, excludeRequestId);
  return Math.max(0, Math.min(gross, Math.floor(rule.monthlyCap - used)));
}

export async function mbD1PrepareBenefit(env, body, options = {}) {
  const ruleId = mbD1Text(body.benefitRuleId);
  if (!ruleId) return null;
  const settings = await mbD1AutomationSettingsData(env);
  const rule = settings.benefitRules.find((item) => item.id === ruleId);
  if (!rule) mbD1Fail("BENEFIT_RULE_NOT_FOUND", "선택한 혜택 규칙을 찾을 수 없습니다.");
  const date = mbD1DateOnly(body.date);
  if (!date || !mbD1BenefitRuleIsActive(rule, date)) return null;
  const type = mbD1Text(body.type);

  if (type === "지출") {
    if (rule.kind !== "post_reward" || mbD1Text(body.paymentMethodId) !== rule.accountId) return null;
    const faceAmount = Math.max(0, mbD1Number(body.amount));
    const rewardBalanceBefore = await mbD1BenefitRewardBalance(env, rule);
    const maxRewardUsable = Math.max(0, Math.min(faceAmount, rewardBalanceBefore));
    const requestedRewardUse = Math.max(0, Math.floor(mbD1Number(body.benefitRewardUsedAmount, 0)));
    if (options.strictRewardUsage && requestedRewardUse > maxRewardUsable) {
      mbD1Fail(
        "BENEFIT_REWARD_USAGE_EXCEEDS_BALANCE",
        `사용 가능한 캐시백은 ${Math.round(maxRewardUsable).toLocaleString("ko-KR")}원입니다.`
      );
    }
    const rewardUsedAmount = Math.min(requestedRewardUse, maxRewardUsable);
    const eligibleAmount = Math.max(0, faceAmount - rewardUsedAmount);
    const accrualEnabled = body.benefitAccrualEnabled !== false;
    const benefitAmount = accrualEnabled
      ? await mbD1CalculateBenefit(env, rule, eligibleAmount, date)
      : 0;
    return {
      rule,
      kind: rule.kind,
      faceAmount,
      actualAmount: faceAmount,
      eligibleAmount,
      benefitAmount,
      accountId: rule.accountId,
      creditAccountId: rule.accountId,
      rewardBalanceBefore,
      rewardUsedAmount,
      rewardBalanceAfter: Math.max(0, rewardBalanceBefore - rewardUsedAmount + benefitAmount),
      maxRewardUsable
    };
  }

  if (type === "이체") {
    if (rule.kind !== "pre_discount" || mbD1Text(body.toAccountId) !== rule.accountId) return null;
    const category = await mbD1CategoryById(env, mbD1Text(body.categoryId), false);
    if (!category || category.name !== "지역화폐충전") return null;
    const faceAmount = Math.max(0, mbD1Number(body.benefitFaceAmount || body.amount));
    const benefitAmount = await mbD1CalculateBenefit(env, rule, faceAmount, date);
    return {
      rule,
      kind: rule.kind,
      faceAmount,
      actualAmount: Math.max(0, faceAmount - benefitAmount),
      eligibleAmount: faceAmount,
      benefitAmount,
      accountId: rule.accountId,
      creditAccountId: mbD1Text(body.fromAccountId),
      rewardBalanceBefore: 0,
      rewardUsedAmount: 0,
      rewardBalanceAfter: 0,
      maxRewardUsable: 0
    };
  }

  return null;
}

export async function mbD1PreviewBenefit(env, body) {
  const benefit = await mbD1PrepareBenefit(env, body);
  if (!benefit) return null;
  return {
    kind: benefit.kind,
    ratePercent: benefit.rule.ratePercent,
    benefitAmount: benefit.benefitAmount,
    faceAmount: benefit.faceAmount,
    actualAmount: benefit.actualAmount,
    eligibleAmount: benefit.eligibleAmount,
    rewardBalanceBefore: benefit.rewardBalanceBefore,
    rewardUsedAmount: benefit.rewardUsedAmount,
    rewardBalanceAfter: benefit.rewardBalanceAfter,
    maxRewardUsable: benefit.maxRewardUsable
  };
}

export function mbD1BenefitRuleIdFromRequestId(requestId, originalRequestId) {
  const request = mbD1Text(requestId);
  const original = mbD1Text(originalRequestId);
  const prefix = "BENEFIT_";
  const suffix = `_${original}`;
  if (!original || !request.startsWith(prefix) || !request.endsWith(suffix)) return "";
  return request.slice(prefix.length, request.length - suffix.length);
}

export async function mbD1LinkedBenefit(env, current) {
  if (!current?.groupId || mbD1Text(current.requestId).startsWith("BENEFIT_")) return null;
  const row = await mbD1First(
    env,
    `SELECT transaction_id,request_id,version,deleted_at
     FROM transactions
     WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%'
     ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, current.groupId]
  );
  if (!row) return null;
  const ruleId = mbD1BenefitRuleIdFromRequestId(row.request_id, current.requestId);
  return ruleId ? { ...row, ruleId } : null;
}

export async function mbD1MatchingBenefitRule(env, model) {
  const settings = await mbD1AutomationSettingsData(env);
  const activeRules = settings.benefitRules.filter((rule) => mbD1BenefitRuleIsActive(rule, model.date));

  if (model.type === "지출" && model.paymentMethodId) {
    return activeRules.find(
      (rule) => rule.kind === "post_reward" && rule.accountId === model.paymentMethodId
    ) || null;
  }

  if (model.type === "이체" && model.toAccountId) {
    const category = await mbD1CategoryById(env, model.categoryId, false);
    if (category?.name !== "지역화폐충전") return null;
    return activeRules.find(
      (rule) => rule.kind === "pre_discount" && rule.accountId === model.toAccountId
    ) || null;
  }

  return null;
}

export async function mbD1LinkedBenefitUpdateStatements(env, current, model, actor, session, now, matchingRule = undefined) {
  const [linked, usage] = await Promise.all([
    mbD1LinkedBenefit(env, current),
    mbD1BenefitRewardUsageRecord(env, current.transactionId)
  ]);
  const rule = matchingRule === undefined
    ? await mbD1MatchingBenefitRule(env, model)
    : matchingRule;
  const statements = [];

  if (!rule) {
    if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
    if (linked && !linked.deleted_at) {
      const nextVersion = mbD1Number(linked.version, 1) + 1;
      statements.push(
        env.DB.prepare(
          "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
        ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
        await mbD1InsertChange(env, "transaction", linked.transaction_id, "deleted", nextVersion, session, { automaticBenefit: true })
      );
    }
    return statements;
  }

  let creditAccountId = null;
  let benefitBaseAmount = model.amount;

  if (rule.kind === "post_reward") {
    creditAccountId = rule.accountId;
    const sameRuleUsage = usage && mbD1Text(usage.rule_id) === rule.id;
    const excludeRequestId = linked?.ruleId === rule.id ? linked.request_id : "";
    const rewardBalanceBefore = await mbD1BenefitRewardBalance(
      env,
      rule,
      current.transactionId,
      excludeRequestId
    );
    const oldRewardUsed = sameRuleUsage
      ? Math.max(0, Math.floor(mbD1Number(usage.used_amount, 0)))
      : 0;
    const rewardUsedAmount = Math.min(
      oldRewardUsed,
      Math.max(0, model.amount),
      rewardBalanceBefore
    );
    benefitBaseAmount = Math.max(0, model.amount - rewardUsedAmount);

    if (rewardUsedAmount > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
        ).bind(
          current.transactionId,
          MB_D1_HOUSEHOLD_ID,
          rule.id,
          rule.accountId,
          rewardUsedAmount,
          now,
          now
        )
      );
    } else if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
  } else if (rule.kind === "pre_discount") {
    creditAccountId = model.fromAccountId;
    if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
  }

  if (!creditAccountId) return statements;

  const linkedRequestIdForCap = linked?.ruleId === rule.id ? linked.request_id : "";
  const benefitAmount = await mbD1CalculateBenefit(
    env,
    rule,
    benefitBaseAmount,
    model.date,
    linkedRequestIdForCap
  );

  if (benefitAmount <= 0) {
    if (linked && !linked.deleted_at) {
      const nextVersion = mbD1Number(linked.version, 1) + 1;
      statements.push(
        env.DB.prepare(
          "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
        ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
        await mbD1InsertChange(env, "transaction", linked.transaction_id, "deleted", nextVersion, session, { automaticBenefit: true })
      );
    }
    return statements;
  }

  const benefitCategory = await mbD1BenefitCategory(env);
  if (!benefitCategory?.category_id) {
    mbD1Fail("BENEFIT_CATEGORY_MISSING", "수입 카테고리 '캐시백/할인혜택'이 필요합니다.");
  }
  const account = await mbD1AccountById(env, creditAccountId, false);
  if (!account) mbD1Fail("BENEFIT_ACCOUNT_NOT_FOUND", "혜택 반영 계좌를 찾을 수 없습니다.");
  const description = rule.kind === "pre_discount"
    ? `${account.displayName} 선할인`
    : `${account.displayName} 혜택 적립`;
  const benefitRequestId = `BENEFIT_${rule.id}_${current.requestId}`;

  if (linked) {
    const nextVersion = mbD1Number(linked.version, 1) + 1;
    statements.push(
      env.DB.prepare(
        `UPDATE transactions
         SET request_id=?,date=?,category_id=?,amount=?,from_account_id=NULL,to_account_id=?,payment_method_id=NULL,
             spending_target=NULL,spender_member_id=NULL,description=?,memo=NULL,billing_month_override=NULL,billing_month=NULL,
             group_id=?,version=?,updated_at=?,updated_by=?,deleted_at=NULL,deleted_by=NULL
         WHERE household_id=? AND transaction_id=?`
      ).bind(
        benefitRequestId,
        model.date,
        benefitCategory.category_id,
        benefitAmount,
        creditAccountId,
        description,
        model.groupId,
        nextVersion,
        now,
        actor,
        MB_D1_HOUSEHOLD_ID,
        linked.transaction_id
      ),
      await mbD1InsertChange(env, "transaction", linked.transaction_id, "updated", nextVersion, session, {
        automaticBenefit: true,
        benefitRuleId: rule.id,
        amount: benefitAmount
      })
    );
    return statements;
  }

  if (!model.groupId || !current.requestId) return statements;
  const enteredBy = await mbD1MemberIdByName(env, actor);
  const benefitModel = await mbD1BuildTransactionModel(
    env,
    {
      date: model.date,
      type: "수입",
      categoryId: benefitCategory.category_id,
      amount: benefitAmount,
      toAccountId: creditAccountId,
      description,
      memo: "",
      groupId: model.groupId
    },
    null,
    true
  );
  const benefitTransactionId = mbD1Id("TX");
  statements.push(
    env.DB.prepare(
      `INSERT INTO transactions (
        transaction_id,household_id,request_id,date,type,category_id,amount,
        from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
        entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
        version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      benefitTransactionId, MB_D1_HOUSEHOLD_ID, benefitRequestId, benefitModel.date, benefitModel.type, benefitModel.categoryId, benefitModel.amount,
      benefitModel.fromAccountId, benefitModel.toAccountId, benefitModel.paymentMethodId, benefitModel.spendingTarget, benefitModel.spenderMemberId,
      enteredBy, benefitModel.description || null, benefitModel.memo || null, benefitModel.billingOverride, benefitModel.billingMonth,
      benefitModel.groupId, benefitModel.reversalOf, 1, now, now, actor, actor, null, null, null
    ),
    await mbD1InsertChange(env, "transaction", benefitTransactionId, "created", 1, session, {
      date: benefitModel.date,
      type: benefitModel.type,
      amount: benefitModel.amount,
      automaticBenefit: true,
      benefitRuleId: rule.id
    })
  );
  return statements;
}
