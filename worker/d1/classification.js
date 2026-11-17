// 할부 스키마 보장과 분류 태그 규칙 저장·미리보기·적용
import { classificationSettingsStatement, getClassificationSettings } from "../classification.js";
import { classifyTransaction, normalizeRules } from "../domain/classification.js";
import { dateOnly as mbD1DateOnly } from "../domain/date.js";
import {
  MB_D1_HOUSEHOLD_ID,
  mbD1All,
  mbD1Fail,
  mbD1InsertChange,
  mbD1Now,
  mbD1Text
} from "./core.js";
import { mbD1GetCategoriesData, mbD1GetTransactionsData } from "./queries.js";
import { mbD1RawAccounts, mbD1TransactionById } from "./records.js";
import {
  MB_D1_CONCURRENCY_GUARD_TOKEN,
  mbD1HandleTransactionMutation,
  mbD1LooksLikeConcurrencyGuardFailure
} from "./transactions.js";

// 할부 개월 수 칸(installment_months)이 없던 기존 DB에 한 번만 추가합니다.
export const mbD1InstallmentSchemaReadyFor = new WeakSet();

export async function mbD1EnsureInstallmentSchema(env) {
  if (!env.DB || mbD1InstallmentSchemaReadyFor.has(env.DB)) return;
  const columns = await mbD1All(env, "PRAGMA table_info(transactions)", []);
  if (!columns.some(column => column.name === "installment_months")) {
    try {
      await env.DB.prepare("ALTER TABLE transactions ADD COLUMN installment_months INTEGER").run();
    } catch (error) {
      // 다른 요청이 동시에 먼저 추가한 경우만 무시합니다.
      if (!/duplicate column/i.test(String(error?.message || error))) throw error;
    }
  }
  mbD1InstallmentSchemaReadyFor.add(env.DB);
}

export async function mbSaveClassification(body, session, env) {
  let rules;
  try {
    rules = normalizeRules(body.rules);
  } catch (error) {
    mbD1Fail("INVALID_CLASSIFICATION", error.message);
  }
  const categories = (await mbD1GetCategoriesData(env, new URL("https://local/api/categories")))
    .items;
  const accounts = await mbD1RawAccounts(env);
  for (const rule of rules) {
    if (
      rule.categoryId &&
      !categories.some(
        c => c.categoryId === rule.categoryId && c.type === rule.type && c.active && !c.isDeleted
      )
    )
      mbD1Fail("INVALID_RULE_CATEGORY", `${rule.name}: 사용 가능한 카테고리를 선택해주세요.`);
    if (
      rule.accountId &&
      !accounts.some(a => a.account_id === rule.accountId && !a.deleted_at && a.is_active)
    )
      mbD1Fail("INVALID_RULE_ACCOUNT", `${rule.name}: 사용 가능한 계좌를 선택해주세요.`);
  }
  const current = await getClassificationSettings(env, MB_D1_HOUSEHOLD_ID);
  if (body.version !== current.version)
    mbD1Fail(
      "CONCURRENT_MODIFICATION",
      "다른 기기에서 규칙이 변경되었습니다. 다시 불러와주세요.",
      409
    );
  const guard = env.DB.prepare(
    `SELECT CASE WHEN COALESCE((SELECT version FROM user_preferences WHERE household_id=? AND preference_key='classification_rules'),0)=? THEN 1 ELSE json('${MB_D1_CONCURRENCY_GUARD_TOKEN}') END`
  ).bind(MB_D1_HOUSEHOLD_ID, body.version);
  try {
    await env.DB.batch([
      guard,
      classificationSettingsStatement(env, MB_D1_HOUSEHOLD_ID, rules, mbD1Now()),
      await mbD1InsertChange(env, "classification_rules", "shared", "updated", null, session)
    ]);
  } catch (error) {
    if (mbD1LooksLikeConcurrencyGuardFailure(error))
      mbD1Fail("CONCURRENT_MODIFICATION", "규칙이 변경되었습니다. 다시 불러와주세요.", 409);
    throw error;
  }
  return getClassificationSettings(env, MB_D1_HOUSEHOLD_ID);
}
export async function mbClassificationToken(transaction, result, version) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ transaction, result, version }))
  );
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function mbClassificationResult(transaction, settings, categories) {
  // Transfers and financial companion rows have category-dependent semantics.
  // Historical reclassification only changes categories for plain income/expenses.
  const protectedCategory =
    transaction.categorySource !== "auto" ||
    transaction.type === "이체" ||
    transaction.reversalOf ||
    transaction.groupId ||
    transaction.reversalAmount > 0;
  return classifyTransaction(
    { ...transaction, categorySource: protectedCategory ? "manual" : "auto" },
    settings.rules,
    categories
  );
}
export async function mbClassificationPreview(body, env) {
  const dateFrom = mbD1DateOnly(body.dateFrom),
    dateTo = mbD1DateOnly(body.dateTo);
  if (!dateFrom || !dateTo || dateFrom > dateTo)
    mbD1Fail("INVALID_DATE_RANGE", "조회 기간을 올바르게 선택해주세요.");
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  const settings = await getClassificationSettings(env, MB_D1_HOUSEHOLD_ID);
  const categories = (await mbD1GetCategoriesData(env, new URL("https://local/api/categories")))
    .items;
  const url = new URL("https://local/api/transactions");
  for (const [key, value] of Object.entries({
    dateFrom,
    dateTo,
    limit: "10",
    offset: String(offset)
  }))
    url.searchParams.set(key, value);
  const page = await mbD1GetTransactionsData(env, url);
  const items = [];
  for (const transaction of page.items) {
    const result = mbClassificationResult(transaction, settings, categories);
    if (
      result.categoryId === (transaction.categoryId || "") &&
      JSON.stringify(result.tags) === JSON.stringify(transaction.tags)
    )
      continue;
    items.push({
      transactionId: transaction.transactionId,
      date: transaction.date,
      description: transaction.description,
      amount: transaction.amount,
      beforeCategory: transaction.category,
      afterCategory:
        categories.find(c => c.categoryId === result.categoryId)?.name || transaction.category,
      beforeTags: transaction.tags,
      afterTags: result.tags,
      matchedNames: result.matchedNames,
      token: await mbClassificationToken(transaction, result, settings.version)
    });
  }
  return {
    items,
    version: settings.version,
    total: page.total,
    offset,
    nextOffset: offset + page.items.length < page.total ? offset + page.items.length : null
  };
}
export async function mbApplyClassification(body, session, env) {
  if (!Array.isArray(body.items) || body.items.length > 2 || body.confirm !== "APPLY_RULES")
    mbD1Fail("INVALID_APPLY", "한 번의 요청에는 미리보기 항목을 최대 2건씩 전달해주세요.");
  const settings = await getClassificationSettings(env, MB_D1_HOUSEHOLD_ID);
  if (body.version !== settings.version)
    mbD1Fail(
      "CONCURRENT_MODIFICATION",
      "규칙이 변경되었습니다. 미리보기를 다시 실행해주세요.",
      409
    );
  const categories = (await mbD1GetCategoriesData(env, new URL("https://local/api/categories")))
    .items;
  const results = [];
  for (const selected of body.items) {
    try {
      const tx = await mbD1TransactionById(env, mbD1Text(selected.transactionId), false);
      if (!tx || tx.isDeleted) throw new Error("거래가 삭제되었습니다.");
      const next = mbClassificationResult(tx, settings, categories);
      if (selected.token !== (await mbClassificationToken(tx, next, settings.version)))
        throw new Error("거래가 변경되었습니다. 미리보기를 다시 확인해주세요.");
      await mbD1HandleTransactionMutation(
        "/api/transactions/update",
        {
          transactionId: tx.transactionId,
          expectedUpdatedAtMs: tx.updatedAtMs,
          tags: next.tags,
          ...(next.categoryId !== (tx.categoryId || "")
            ? { categoryId: next.categoryId, categorySource: "auto" }
            : {}),
          classificationVersion: settings.version
        },
        session,
        env
      );
      results.push({ transactionId: tx.transactionId, applied: true });
    } catch (error) {
      results.push({
        transactionId: selected.transactionId,
        applied: false,
        error: error.message || "적용 실패"
      });
    }
  }
  return { results };
}
