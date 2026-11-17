// Shared deterministic rules: no network, AI, or regular-expression execution.
export function normalizeTags(value = []) {
  if (typeof value === "string") value = value.split(/[,，\n]/);
  if (!Array.isArray(value)) throw new Error("태그는 배열 또는 쉼표로 구분한 문자열이어야 합니다.");
  const tags = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("태그 이름은 문자열이어야 합니다.");
    const tag = item.normalize("NFC").trim().replace(/^#+/, "").trim();
    if (!tag) continue;
    if (tag.length > 30) throw new Error("태그 이름은 30자 이내로 입력해주세요.");
    if (!tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  if (tags.length > 10) throw new Error("거래당 태그는 최대 10개입니다.");
  return tags;
}
export function normalizeRules(value) {
  if (!Array.isArray(value) || value.length > 50) throw new Error("분류 규칙은 최대 50개입니다.");
  const ids = new Set();
  return value.map((rule, index) => {
    if (!rule || typeof rule !== "object") throw new Error("분류 규칙 형식이 올바르지 않습니다.");
    const id = String(rule.id || "").trim();
    const name = String(rule.name || "").trim();
    const contains = String(rule.contains || "").trim();
    const accountId = String(rule.accountId || "").trim();
    const categoryId = String(rule.categoryId || "").trim();
    const type = String(rule.type || "");
    if (!id || id.length > 100 || ids.has(id)) throw new Error("규칙 ID가 없거나 중복됩니다.");
    if (!name || name.length > 60 || contains.length > 100)
      throw new Error("규칙 이름은 60자, 검색어는 100자 이내로 입력해주세요.");
    if (!["수입", "지출", "이체"].includes(type))
      throw new Error("규칙의 거래 유형을 선택해주세요.");
    if (!contains && !accountId) throw new Error("거래 내용 또는 계좌 조건이 필요합니다.");
    const tags = normalizeTags(rule.tags);
    if (!categoryId && !tags.length) throw new Error("지정할 카테고리 또는 태그가 필요합니다.");
    ids.add(id);
    return {
      id,
      name,
      type,
      contains,
      accountId,
      categoryId,
      tags,
      enabled: rule.enabled !== false,
      priority: index
    };
  });
}
export function classifyTransaction(transaction, rules = [], categories = []) {
  let categoryId = transaction.categoryId || "";
  let categorySource = transaction.categorySource || (categoryId ? "manual" : "auto");
  const tags = normalizeTags(transaction.tags || []);
  const matchedNames = [];
  let assigned = false;
  // First eligible category wins; tags from all matches are combined in rule order.
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== transaction.type) continue;
    if (
      rule.contains &&
      !String(transaction.description || "")
        .normalize("NFC")
        .toLowerCase()
        .includes(rule.contains.normalize("NFC").toLowerCase())
    )
      continue;
    if (
      rule.accountId &&
      ![transaction.paymentMethodId, transaction.fromAccountId, transaction.toAccountId].includes(
        rule.accountId
      )
    )
      continue;
    matchedNames.push(rule.name);
    if (
      !assigned &&
      categorySource !== "manual" &&
      rule.categoryId &&
      categories.some(
        c =>
          c.categoryId === rule.categoryId &&
          c.type === transaction.type &&
          c.active !== false &&
          !c.isDeleted
      )
    ) {
      categoryId = rule.categoryId;
      categorySource = "auto";
      assigned = true;
    }
    for (const tag of rule.tags) {
      if (tags.length < 10 && !tags.some(t => t.toLowerCase() === tag.toLowerCase()))
        tags.push(tag);
    }
  }
  return { categoryId, categorySource, tags, matchedNames };
}
