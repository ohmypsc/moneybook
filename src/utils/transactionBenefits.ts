type BenefitTransactionLike = {
  type?: string | null;
  requestId?: string | null;
  description?: string | null;
};

export function isBenefitTransaction(
  transaction: BenefitTransactionLike
) {
  return (
    transaction.type === "수입" &&
    Boolean(transaction.requestId?.startsWith("BENEFIT_"))
  );
}

export function isPreDiscountBenefitTransaction(
  transaction: BenefitTransactionLike
) {
  return (
    isBenefitTransaction(transaction) &&
    Boolean(transaction.description?.trim().endsWith("선할인"))
  );
}

export function getBenefitTransactionTitle(
  transaction: BenefitTransactionLike
) {
  return isPreDiscountBenefitTransaction(transaction)
    ? "선할인 혜택"
    : "캐시백·포인트 혜택";
}

export function getBenefitTransactionMeta(
  transaction: BenefitTransactionLike
) {
  return isPreDiscountBenefitTransaction(transaction)
    ? "충전 선할인 혜택 · 수입 합계 제외"
    : "캐시백·포인트 혜택 · 수입 합계 제외";
}
