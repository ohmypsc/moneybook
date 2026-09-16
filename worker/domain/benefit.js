function text(value) {
  return String(value ?? "").trim();
}

export function isPreDiscountBenefitTransaction(transaction) {
  const requestId = text(transaction?.requestId ?? transaction?.request_id);
  const description = text(transaction?.description);

  return (
    text(transaction?.type) === "수입" &&
    requestId.startsWith("BENEFIT_") &&
    description.endsWith("선할인")
  );
}
