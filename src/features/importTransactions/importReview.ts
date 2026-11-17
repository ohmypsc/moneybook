import { classifyTransaction, normalizeTags } from "../../../shared/classification.js";
import type { ImportedTransactionCandidate } from "../../api/transactionImport";
import type { CreateTransactionInput } from "../../api/transactions";
import type { BootstrapData } from "../../types/bootstrap";

export type ImportKind = ImportedTransactionCandidate["kind"];
export const IMPORT_TYPE_LABELS = {
  expense: "지출",
  income: "수입",
  transfer: "이체",
  refund: "취소/환불"
} as const;

export interface EditableCandidate extends ImportedTransactionCandidate {
  tagsText?: string;
  categorySource?: "manual" | "auto";
  automaticTags?: string[];
  matchedRules?: string[];
  requestId: string;
  queued?: boolean;
}

export function changeImportKind(item: EditableCandidate, kind: ImportKind): EditableCandidate {
  if (kind === item.kind || item.kind === "refund" || item.queued) return item;
  return {
    ...item,
    kind,
    categorySource: "auto",
    automaticTags: [],
    matchedRules: [],
    categoryId: null,
    categoryName: "",
    categorySuggestionSource: null,
    paymentMethodId: null,
    paymentMethodName: "",
    fromAccountId: "",
    toAccountId: "",
    duplicate: null
  };
}

export function deriveReviewReasons(item: EditableCandidate) {
  const reasons: string[] = [];
  try {
    normalizeTags(item.tagsText || "");
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "태그 확인 필요");
  }
  const parsedDate = new Date(`${item.date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== item.date
  )
    reasons.push("날짜 확인 필요");
  if (!Number.isSafeInteger(item.amount) || item.amount <= 0) reasons.push("금액 확인 필요");
  if (!item.merchant.trim()) reasons.push("거래 내용 확인 필요");
  if (!item.categoryId) reasons.push("카테고리 선택 필요");
  if (item.kind === "expense") {
    if (!item.paymentMethodId) reasons.push("결제수단 선택 필요");
    if (!item.spendingTarget) reasons.push("지출대상 선택 필요");
  }
  if (item.kind === "income" || item.kind === "transfer") {
    if (!item.toAccountId) reasons.push("입금계좌 선택 필요");
  }
  if (item.kind === "transfer") {
    if (!item.fromAccountId) reasons.push("출금계좌 선택 필요");
    if (item.fromAccountId && item.fromAccountId === item.toAccountId)
      reasons.push("출금계좌와 입금계좌는 달라야 합니다");
  }
  if (item.confidence === "low") reasons.push("인식 결과 확인 필요");
  if (item.duplicate) reasons.push("중복 거래 의심");
  if (item.kind === "refund") reasons.push("취소/환불은 원거래 연결 확인 필요");
  return reasons;
}

export function buildImportPayload(
  item: EditableCandidate,
  bootstrap: BootstrapData
): CreateTransactionInput {
  if (item.kind === "refund") throw new Error("취소/환불은 내역 화면에서 원거래에 연결해주세요.");
  // Low confidence and duplicate hints are review warnings; required fields are hard errors.
  const errors = deriveReviewReasons({ ...item, confidence: "high", duplicate: null });
  if (errors.length) throw new Error(`${item.merchant || "거래"}: ${errors[0]}`);
  const type = IMPORT_TYPE_LABELS[item.kind];
  if (
    !bootstrap.categories.some(
      category =>
        category.categoryId === item.categoryId &&
        category.type === type &&
        category.active &&
        !category.isDeleted
    )
  ) {
    throw new Error(`${item.merchant}: ${type} 카테고리를 선택해주세요.`);
  }
  const accountIds =
    item.kind === "expense"
      ? [item.paymentMethodId]
      : item.kind === "income"
        ? [item.toAccountId]
        : [item.fromAccountId, item.toAccountId];
  if (
    accountIds.some(
      id =>
        !bootstrap.accounts.some(
          account =>
            account.accountId === id &&
            account.active &&
            !account.isDeleted &&
            (item.kind === "expense" || account.subType !== "체크카드")
        )
    )
  ) {
    throw new Error(`${item.merchant}: 사용 가능한 계좌를 선택해주세요.`);
  }
  if (item.kind === "expense" && !bootstrap.spendingTargets.includes(item.spendingTarget))
    throw new Error(`${item.merchant}: 지출대상을 선택해주세요.`);
  const common = {
    date: item.date,
    type,
    amount: item.amount,
    categoryId: item.categoryId!,
    description: item.merchant.trim(),
    memo: item.memo,
    requestId: item.requestId,
    tags: applyImportClassification(item, bootstrap).automaticTags || [],
    categorySource: item.categorySource || "manual"
  };
  if (item.kind === "income") return { ...common, toAccountId: item.toAccountId };
  if (item.kind === "transfer")
    return { ...common, fromAccountId: item.fromAccountId, toAccountId: item.toAccountId };
  const rule = bootstrap.automationSettings?.benefitRules.find(
    rule =>
      rule.accountId === item.paymentMethodId &&
      rule.enabled &&
      rule.kind === "post_reward" &&
      (!rule.validFrom || item.date >= rule.validFrom) &&
      (!rule.validTo || item.date <= rule.validTo)
  );
  return {
    ...common,
    paymentMethodId: item.paymentMethodId!,
    spendingTarget: item.spendingTarget,
    ...(rule
      ? { benefitRuleId: rule.id, benefitRewardUsedAmount: 0, benefitAccrualEnabled: true }
      : {})
  };
}

export function applyImportClassification(
  item: EditableCandidate,
  bootstrap: BootstrapData
): EditableCandidate {
  if (item.kind === "refund" || item.queued) return item;
  let tags: string[] = [];
  try {
    tags = normalizeTags(item.tagsText || "");
  } catch {
    return item;
  }
  const result = classifyTransaction(
    {
      type: IMPORT_TYPE_LABELS[item.kind],
      description: item.merchant,
      categoryId: item.categoryId,
      categorySource: item.categorySource || (item.categoryId ? "manual" : "auto"),
      tags,
      paymentMethodId: item.paymentMethodId,
      fromAccountId: item.fromAccountId,
      toAccountId: item.toAccountId
    },
    bootstrap.classificationSettings?.rules || [],
    bootstrap.categories
  );
  return {
    ...item,
    categoryId: result.categoryId || null,
    categorySource: result.categorySource as "auto" | "manual",
    categoryName:
      bootstrap.categories.find(c => c.categoryId === result.categoryId)?.name || item.categoryName,
    automaticTags: result.tags,
    matchedRules: result.matchedNames
  };
}
