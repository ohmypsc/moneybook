// 연말정산 요약·프로필·세금 분류
import { aggregateYearSpending, buildRecommendations, collectReferencedCategoryIds, computeCardDeduction, getTaxRules, INCOME_TAX_CODES, isSalaryCategory, isValidTaxCode, planCategoryPreset, summarizeSalaryIncome, TAX_CODES } from "../domain/yearEndTax.js";
import { mbD1AutomationSettingsData } from "./automation.js";
import { MB_D1_HOUSEHOLD_ID, mbD1All, mbD1Bool, mbD1CurrentMonthSeoul, mbD1CurrentYearSeoul, mbD1Fail, mbD1First, mbD1Id, mbD1InsertChange, mbD1MemberByName, mbD1Members, mbD1Now, mbD1Number, mbD1Text } from "./core.js";
import { MB_D1_TRANSACTION_SELECT, mbD1MapAccountRow, mbD1MapTransactionRow, mbD1RawAccounts } from "./records.js";

// ── 연말정산 도우미 ───────────────────────────────────────────

export function mbD1TaxYear(value) {
  const text = mbD1Text(value);
  if (!text) return Number(mbD1CurrentYearSeoul());
  const year = Number(text);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    mbD1Fail("INVALID_TAX_YEAR", "연도가 올바르지 않습니다.");
  }
  return year;
}

export async function mbD1TaxSummaryData(env, url) {
  const year = mbD1TaxYear(url.searchParams.get("year"));
  const rules = getTaxRules(year);

  const [memberRows, rawAccounts, categoryRows, profileRows, transactionRows] = await Promise.all([
    mbD1Members(env),
    mbD1RawAccounts(env),
    mbD1All(
      env,
      "SELECT category_id,name,type,default_tax_category_code FROM categories WHERE household_id=? AND deleted_at IS NULL AND type IN ('지출','수입') ORDER BY name",
      [MB_D1_HOUSEHOLD_ID]
    ),
    mbD1All(
      env,
      "SELECT member_id,gross_salary_krw,profile_json FROM tax_year_profiles WHERE household_id=? AND tax_year=?",
      [MB_D1_HOUSEHOLD_ID, year]
    ),
    mbD1All(
      env,
      `${MB_D1_TRANSACTION_SELECT}
       WHERE t.household_id=? AND t.deleted_at IS NULL AND t.type IN ('지출','수입') AND t.date BETWEEN ? AND ?`,
      [MB_D1_HOUSEHOLD_ID, `${year}-01-01`, `${year}-12-31`]
    )
  ]);

  const members = memberRows
    .map((row) => ({ memberId: mbD1Text(row.member_id), name: mbD1Text(row.display_name) }))
    .filter((member) => member.name);
  const profiles = new Map(profileRows.map((row) => {
    let extra = {};
    try { extra = JSON.parse(row.profile_json || "{}") || {}; } catch { extra = {}; }
    return [mbD1Text(row.member_id), { grossSalary: mbD1Number(row.gross_salary_krw, 0), children: mbD1Number(extra.children, 0) }];
  }));

  const expenseCategoryRows = categoryRows.filter((row) => row.type === "지출");
  const incomeCategoryRows = categoryRows.filter((row) => row.type === "수입");
  const categoryTaxCodes = new Map(
    expenseCategoryRows.map((row) => [mbD1Text(row.category_id), isValidTaxCode(row.default_tax_category_code) ? mbD1Text(row.default_tax_category_code) : ""])
  );
  const incomeCodeOf = (row) => {
    const code = mbD1Text(row.default_tax_category_code);
    return Object.prototype.hasOwnProperty.call(INCOME_TAX_CODES, code) ? code : "";
  };
  const salaryCategoryIds = new Set(
    incomeCategoryRows
      .filter((row) => isSalaryCategory(row.name, incomeCodeOf(row)))
      .map((row) => mbD1Text(row.category_id))
  );
  const accounts = rawAccounts.map(mbD1MapAccountRow);
  const transactions = transactionRows.map(mbD1MapTransactionRow);
  const memberNames = members.map((member) => member.name);
  const people = aggregateYearSpending({ year, members: memberNames, accounts, categoryTaxCodes, transactions });
  const salaries = summarizeSalaryIncome({
    year,
    members: memberNames,
    accounts,
    salaryCategoryIds,
    transactions,
    currentMonth: mbD1CurrentMonthSeoul()
  });

  const memberResults = members.map((member) => {
    const profile = profiles.get(member.memberId) || { grossSalary: 0, children: 0 };
    const aggregated = people.get(member.name);
    const salaryIncome = salaries.get(member.name) || null;
    // 직접 입력한 총급여가 우선이고, 없으면 가계부 급여 수입으로 추정한 값으로 계산합니다.
    const salarySource = profile.grossSalary > 0
      ? "profile"
      : salaryIncome?.estimatedGross > 0 ? "estimate" : "none";
    const salary = salarySource === "profile"
      ? profile.grossSalary
      : salarySource === "estimate" ? salaryIncome.estimatedGross : 0;
    return {
      name: member.name,
      grossSalary: profile.grossSalary,
      children: profile.children,
      salarySource,
      salaryUsed: salary,
      salaryIncome,
      card: computeCardDeduction({ salary, children: profile.children, usage: aggregated.usage }, rules),
      medicalThreshold: Math.round(salary * rules.medicalThresholdRate),
      items: aggregated.items
    };
  });

  const unassigned = people.get("명의 미지정") || null;

  return {
    year,
    rules: {
      estimated: rules.estimated,
      basedOnYear: rules.basedOnYear || year,
      thresholdRate: rules.thresholdRate,
      rates: rules.rates,
      medicalThresholdRate: rules.medicalThresholdRate
    },
    members: memberResults,
    unassigned: unassigned ? { usage: unassigned.usage, items: unassigned.items } : null,
    categories: expenseCategoryRows.map((row) => ({
      categoryId: mbD1Text(row.category_id),
      name: mbD1Text(row.name),
      taxCode: categoryTaxCodes.get(mbD1Text(row.category_id)) || ""
    })),
    incomeCategories: incomeCategoryRows.map((row) => ({
      categoryId: mbD1Text(row.category_id),
      name: mbD1Text(row.name),
      taxCode: incomeCodeOf(row),
      countedAsSalary: salaryCategoryIds.has(mbD1Text(row.category_id))
    })),
    taxCodes: Object.entries(TAX_CODES).map(([code, meta]) => ({ code, label: meta.label })),
    incomeTaxCodes: Object.entries(INCOME_TAX_CODES).map(([code, label]) => ({ code, label })),
    recommendations: buildRecommendations(memberResults, rules)
  };
}

export async function mbD1HandleTaxProfile(body, session, env) {
  const year = mbD1TaxYear(body.year);
  const memberName = mbD1Text(body.memberName);
  const member = await mbD1MemberByName(env, memberName);
  if (!member) mbD1Fail("MEMBER_NOT_FOUND", "구성원을 찾을 수 없습니다.", 404);
  const grossSalary = Math.round(Number(body.grossSalary));
  if (!Number.isFinite(grossSalary) || grossSalary < 0 || grossSalary > 10_000_000_000) {
    mbD1Fail("INVALID_GROSS_SALARY", "총급여를 올바르게 입력해주세요.");
  }
  const children = Math.trunc(Number(body.children ?? 0));
  if (!Number.isFinite(children) || children < 0 || children > 20) {
    mbD1Fail("INVALID_CHILDREN", "자녀 수를 올바르게 입력해주세요.");
  }
  const memberId = mbD1Text(member.member_id);
  const now = mbD1Now();
  const upsert = env.DB.prepare(
    `INSERT INTO tax_year_profiles (household_id,member_id,tax_year,gross_salary_krw,profile_json,updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(household_id,member_id,tax_year) DO UPDATE SET
       gross_salary_krw=excluded.gross_salary_krw,profile_json=excluded.profile_json,updated_at=excluded.updated_at`
  ).bind(MB_D1_HOUSEHOLD_ID, memberId, year, grossSalary, JSON.stringify({ children }), now);
  const change = await mbD1InsertChange(env, "tax_profile", `${memberId}:${year}`, "updated", null, session, { year });
  await env.DB.batch([upsert, change]);
  return { saved: true, year, memberName, grossSalary, children };
}

export async function mbD1HandleTaxCategory(body, session, env) {
  const categoryId = mbD1Text(body.categoryId);
  const taxCode = mbD1Text(body.taxCode);
  const category = await mbD1First(
    env,
    "SELECT category_id,type FROM categories WHERE household_id=? AND category_id=? AND type IN ('지출','수입') AND deleted_at IS NULL",
    [MB_D1_HOUSEHOLD_ID, categoryId]
  );
  if (!category) mbD1Fail("CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없습니다.", 404);
  const validCode = category.type === "수입"
    ? Object.prototype.hasOwnProperty.call(INCOME_TAX_CODES, taxCode)
    : isValidTaxCode(taxCode);
  if (!validCode) mbD1Fail("INVALID_TAX_CODE", "연말정산 분류가 올바르지 않습니다.");
  const now = mbD1Now();
  const update = env.DB.prepare(
    "UPDATE categories SET default_tax_category_code=?,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
  ).bind(taxCode || null, now, session.name, MB_D1_HOUSEHOLD_ID, categoryId);
  const change = await mbD1InsertChange(env, "category", categoryId, "updated", null, session, { taxCode });
  await env.DB.batch([update, change]);
  return { saved: true, categoryId, taxCode };
}

// 추천 카테고리 정리: apply=false면 바뀔 내용만 돌려주고, true면 적용합니다.
export async function mbD1HandleTaxPreset(body, session, env) {
  const [rows, automation] = await Promise.all([
    mbD1All(
      env,
      "SELECT category_id,name,type,is_active,default_tax_category_code,deleted_at FROM categories WHERE household_id=?",
      [MB_D1_HOUSEHOLD_ID]
    ),
    mbD1AutomationSettingsData(env)
  ]);
  const plan = planCategoryPreset(
    rows.map((row) => ({
      categoryId: mbD1Text(row.category_id),
      name: mbD1Text(row.name),
      type: mbD1Text(row.type),
      taxCode: mbD1Text(row.default_tax_category_code),
      deleted: Boolean(row.deleted_at),
      active: mbD1Bool(row.is_active)
    })),
    { referencedCategoryIds: collectReferencedCategoryIds(automation) }
  );

  if (body.apply !== true) return { applied: false, ...plan };

  const actor = session.name;
  const now = mbD1Now();
  const statements = [];
  for (const item of plan.renames) {
    statements.push(
      env.DB.prepare(
        `UPDATE categories SET name=?,
           default_tax_category_code=CASE WHEN ? IS NOT NULL AND (default_tax_category_code IS NULL OR default_tax_category_code='') THEN ? ELSE default_tax_category_code END,
           updated_at=?,updated_by=?
         WHERE household_id=? AND category_id=? AND name=? AND deleted_at IS NULL`
      ).bind(item.to, item.taxCode, item.taxCode, now, actor, MB_D1_HOUSEHOLD_ID, item.categoryId, item.from),
      await mbD1InsertChange(env, "category", item.categoryId, "updated", null, session, { from: item.from, name: item.to })
    );
  }
  for (const item of plan.links) {
    statements.push(
      env.DB.prepare(
        "UPDATE categories SET default_tax_category_code=?,updated_at=?,updated_by=? WHERE household_id=? AND category_id=? AND (default_tax_category_code IS NULL OR default_tax_category_code='')"
      ).bind(item.taxCode, now, actor, MB_D1_HOUSEHOLD_ID, item.categoryId),
      await mbD1InsertChange(env, "category", item.categoryId, "updated", null, session, { taxCode: item.taxCode })
    );
  }
  for (const item of plan.deactivations) {
    statements.push(
      env.DB.prepare(
        "UPDATE categories SET is_active=0,updated_at=?,updated_by=? WHERE household_id=? AND category_id=? AND deleted_at IS NULL"
      ).bind(now, actor, MB_D1_HOUSEHOLD_ID, item.categoryId),
      await mbD1InsertChange(env, "category", item.categoryId, "updated", null, session, { active: false })
    );
  }
  for (const item of plan.creates) {
    const id = mbD1Id("CAT");
    statements.push(
      env.DB.prepare(
        "INSERT INTO categories (category_id,household_id,type,name,is_active,default_tax_category_code,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,1,?,?,?,?,?,NULL,NULL,NULL)"
      ).bind(id, MB_D1_HOUSEHOLD_ID, item.type, item.name, item.taxCode || null, now, now, actor, actor),
      await mbD1InsertChange(env, "category", id, "created", 1, session, { type: item.type, name: item.name, taxCode: item.taxCode })
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return { applied: true, ...plan };
}
