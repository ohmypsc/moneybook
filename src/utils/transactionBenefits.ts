type BenefitTransactionLike = {
  type?: string | null;
  requestId?: string | null;
  description?: string | null;
};

export function isPreDiscountBenefitTransaction(
  transaction: BenefitTransactionLike
) {
  return (
    transaction.type === "수입" &&
    Boolean(transaction.requestId?.startsWith("BENEFIT_")) &&
    Boolean(transaction.description?.trim().endsWith("선할인"))
  );
}
