function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

function isBenefitTransaction(transaction) {
  const requestId = text(transaction?.requestId ?? transaction?.request_id);
  return text(transaction?.type) === "수입" && requestId.startsWith("BENEFIT_");
}

/**
 * 월별 수입/지출은 환불·정산이 실제로 입금된 달이 아니라
 * 원거래가 속한 달에 귀속한다. 이렇게 해야 다음 달 정산 때문에
 * 다음 달 지출이 음수가 되지 않고, 원래 소비월의 실지출이 맞아진다.
 */
export function netMonthStats(transactions, month) {
  const items = Array.isArray(transactions) ? transactions : [];
  const linkedByOriginal = new Map();

  for (const tx of items) {
    if (!tx?.reversalOf) continue;
    const list = linkedByOriginal.get(tx.reversalOf) || [];
    list.push(tx);
    linkedByOriginal.set(tx.reversalOf, list);
  }

  let incomeGross = 0;
  let expenseGross = 0;
  let expenseRefunds = 0;
  let incomeReversals = 0;
  const categoryNet = new Map();
  const targetNet = new Map();

  for (const tx of items) {
    if (!text(tx?.date).startsWith(month)) continue;
    if (tx?.reversalOf) continue;
    if (isBenefitTransaction(tx)) continue;

    const amount = number(tx.amount);
    const linked = linkedByOriginal.get(tx.transactionId) || [];

    if (tx.type === "수입") {
      incomeGross += amount;
      const reversed = linked
        .filter((item) => item.type === "지출" && !isBenefitTransaction(item))
        .reduce((sum, item) => sum + number(item.amount), 0);
      incomeReversals += reversed;
      continue;
    }

    if (tx.type !== "지출") continue;

    expenseGross += amount;
    const reversed = linked
      .filter((item) => item.type === "수입" && !isBenefitTransaction(item))
      .reduce((sum, item) => sum + number(item.amount), 0);
    expenseRefunds += reversed;

    const netAmount = amount - reversed;
    const category = text(tx.category) || "미분류";
    const target = text(tx.spendingTarget) || "미분류";
    categoryNet.set(category, (categoryNet.get(category) || 0) + netAmount);
    targetNet.set(target, (targetNet.get(target) || 0) + netAmount);
  }

  const categoryExpense = Array.from(categoryNet.entries())
    .map(([name, amount]) => ({ name, amount: round(amount) }))
    .filter((item) => Math.abs(item.amount) > 0.0001)
    .sort((a, b) => b.amount - a.amount);

  const targetExpense = Array.from(targetNet.entries())
    .map(([name, amount]) => ({ name, amount: round(amount) }))
    .filter((item) => Math.abs(item.amount) > 0.0001)
    .sort((a, b) => b.amount - a.amount);

  const income = incomeGross - incomeReversals;
  const expense = expenseGross - expenseRefunds;

  return {
    incomeGross: round(incomeGross),
    expenseGross: round(expenseGross),
    expenseRefunds: round(expenseRefunds),
    incomeReversals: round(incomeReversals),
    income: round(income),
    expense: round(expense),
    net: round(income - expense),
    categoryExpense,
    targetExpense
  };
}
