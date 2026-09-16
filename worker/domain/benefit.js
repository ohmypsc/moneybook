function text(value) {
  return String(value ?? "").trim();
}

export function isBenefitTransaction(transaction) {
  const requestId = text(transaction?.requestId ?? transaction?.request_id);

  return (
    text(transaction?.type) === "수입" &&
    requestId.startsWith("BENEFIT_")
  );
}

export function isPreDiscountBenefitTransaction(transaction) {
  const description = text(transaction?.description);

  return (
    isBenefitTransaction(transaction) &&
    description.endsWith("선할인")
  );
}
