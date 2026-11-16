export function normalizeTransactionPagination(limitValue, offsetValue) {
  const rawLimit = Number(limitValue) || 0;
  const rawOffset = Number(offsetValue) || 0;

  return {
    limit: Math.max(0, Math.min(1000, Math.floor(rawLimit))),
    offset: Math.max(0, Math.floor(rawOffset))
  };
}

export function escapeSqlLike(value) {
  return String(value || "").replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function buildTransactionSearchWhere({
  householdId,
  includeDeleted = false,
  type = "",
  categoryId = "",
  expenseCategory = "",
  expenseTarget = "",
  accountId = "",
  spendingTarget = "",
  dateFrom = "",
  dateTo = "",
  amount = null,
  tag = "",
  query = ""
}) {
  const where = ["t.household_id=?"];
  const binds = [householdId];

  if (!includeDeleted) where.push("t.deleted_at IS NULL");
  if (type) {
    where.push("t.type=?");
    binds.push(type);
  }
  // Report totals group original expenses by display name, including inactive categories.
  if (expenseCategory || expenseTarget) {
    where.push("t.type='지출'", "(t.reversal_of IS NULL OR t.reversal_of='')");
  }
  if (expenseCategory) {
    where.push("COALESCE(NULLIF(TRIM(c.name),''),'미분류')=?");
    binds.push(expenseCategory);
  }
  if (expenseTarget) {
    where.push("COALESCE(NULLIF(TRIM(t.spending_target),''),'미분류')=?");
    binds.push(expenseTarget);
  }
  if (categoryId) {
    where.push("t.category_id=?");
    binds.push(categoryId);
  }
  if (accountId) {
    where.push("(t.from_account_id=? OR t.to_account_id=? OR t.payment_method_id=?)");
    binds.push(accountId, accountId, accountId);
  }
  if (spendingTarget) {
    where.push("t.spending_target=?");
    binds.push(spendingTarget);
  }
  if (dateFrom) {
    where.push("t.date>=?");
    binds.push(dateFrom);
  }
  if (dateTo) {
    where.push("t.date<=?");
    binds.push(dateTo);
  }
  if (amount !== null) {
    where.push("ABS(t.amount - ?) <= 0.000001");
    binds.push(amount);
  }
  if (tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(COALESCE(t.tags_json,'[]')) WHERE value=?)");
    binds.push(tag);
  }
  if (query) {
    const like = `%${escapeSqlLike(query.toLowerCase())}%`;
    where.push(`LOWER(
      COALESCE(t.type,'') || ' ' ||
      COALESCE(c.name,'') || ' ' ||
      COALESCE(fa.display_name,'') || ' ' ||
      COALESCE(ta.display_name,'') || ' ' ||
      COALESCE(pm.display_name,'') || ' ' ||
      COALESCE(t.spending_target,'') || ' ' ||
      COALESCE(t.description,'') || ' ' ||
      COALESCE(t.memo,'')
    ) LIKE ? ESCAPE '\\'`);
    binds.push(like);
  }

  return {
    whereSql: `WHERE ${where.join(" AND ")}`,
    binds
  };
}
