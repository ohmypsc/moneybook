import type { Transaction } from "../../api/transactions";

export function reportExpenseAmounts(
  transaction: Pick<Transaction, "amount" | "netAmount" | "reversalAmount">
) {
  const original = transaction.amount;
  const actual = transaction.netAmount ?? original - (transaction.reversalAmount || 0);
  return { original, actual, deducted: original - actual };
}

// Reload every previously loaded page so returning from an edit retains deep-list positions.
export async function reloadTransactionWindow<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total: number }>,
  desiredCount: number,
  isCurrent: () => boolean = () => true
): Promise<{ items: T[]; total: number } | null> {
  const items: T[] = [];
  let total = 0;
  const desired = Math.max(100, desiredCount);
  do {
    const page = await fetchPage(items.length, Math.min(1000, desired - items.length));
    if (!isCurrent()) return null;
    total = page.total;
    items.push(...page.items);
    if (!page.items.length) break;
  } while (items.length < desired && items.length < total);
  return { items, total };
}
