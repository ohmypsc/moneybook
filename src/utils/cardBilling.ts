import type { Transaction } from "../api/transactions";

// 서버(worker/d1/dashboard.js, worker/domain/installment.js)의 카드 청구 계산과 같은 규칙입니다.

function monthIndex(month: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match) return null;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

export function shiftMonth(month: string, offset: number) {
  const index = monthIndex(month);
  if (index === null) return month;
  const next = index + offset;
  return `${Math.floor(next / 12)}-${String((next % 12) + 1).padStart(2, "0")}`;
}

export function estimateBillingMonth(
  dateText: string,
  cutoff: number | null | undefined,
  paymentDay: number | null | undefined
) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateText || ""));
  const cutoffNumber = Number(cutoff);
  const paymentDayNumber = Number(paymentDay);
  if (!match || !(cutoffNumber > 0) || !(paymentDayNumber > 0)) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let offset = day <= Math.min(cutoffNumber, lastDay) ? 0 : 1;
  if (paymentDayNumber <= cutoffNumber) offset += 1;
  return shiftMonth(`${match[1]}-${match[2]}`, offset);
}

function installmentSchedule(amount: number, months: number | null | undefined) {
  const total = Math.round(Number(amount) || 0);
  const count = Number(months) >= 2 ? Math.trunc(Number(months)) : 1;
  const sign = total < 0 ? -1 : 1;
  const absolute = Math.abs(total);
  const base = Math.floor(absolute / count);
  const remainder = absolute - base * count;
  return Array.from(
    { length: count },
    (_, index) => sign * (index === 0 ? base + remainder : base)
  );
}

function installmentAmountForMonth(
  amount: number,
  months: number | null | undefined,
  firstBillingMonth: string | null,
  month: string
) {
  const first = monthIndex(firstBillingMonth);
  const target = monthIndex(month);
  if (first === null || target === null) return 0;
  const schedule = installmentSchedule(amount, months);
  const offset = target - first;
  return offset >= 0 && offset < schedule.length ? schedule[offset] : 0;
}

export interface CardBillCard {
  accountId: string;
  billingCutoffDay: number | null;
  paymentDay: number | null;
}

export interface CardBillUsageItem {
  transaction: Transaction;
  /** 이번 청구월에 청구되는 금액(할부 회차분, 환불 반영) */
  billedAmount: number;
  refundAmount: number;
  /** 할부라면 몇 회차인지(1부터) */
  installmentIndex: number | null;
}

export interface CardBillPaymentItem {
  transaction: Transaction;
  amount: number;
}

export interface CardBillBreakdown {
  usage: CardBillUsageItem[];
  payments: CardBillPaymentItem[];
  usageTotal: number;
  paymentTotal: number;
}

/** 카드 결제 예정액에 들어간 사용 내역과 결제(이체) 내역을 고릅니다. */
export function buildCardBillBreakdown(
  transactions: Transaction[],
  card: CardBillCard,
  month: string
): CardBillBreakdown {
  const usage: CardBillUsageItem[] = [];
  const payments: CardBillPaymentItem[] = [];

  for (const tx of transactions) {
    if (tx.reversalOf) continue;

    if (tx.type === "지출" && tx.paymentMethodId === card.accountId) {
      const bill =
        tx.billingOverride ||
        tx.billingMonth ||
        estimateBillingMonth(tx.date, card.billingCutoffDay, card.paymentDay);
      const gross = installmentAmountForMonth(tx.amount, tx.installmentMonths, bill, month);
      if (gross === 0) continue;
      const refund = Math.max(0, Number(tx.refundAmount) || 0);
      const refundShare = refund
        ? installmentAmountForMonth(refund, tx.installmentMonths, bill, month)
        : 0;
      const first = monthIndex(bill);
      const target = monthIndex(month);
      usage.push({
        transaction: tx,
        billedAmount: gross - refundShare,
        refundAmount: refundShare,
        installmentIndex:
          Number(tx.installmentMonths) >= 2 && first !== null && target !== null
            ? target - first + 1
            : null
      });
      continue;
    }

    if (tx.type === "이체" && tx.toAccountId === card.accountId) {
      const bill = tx.billingOverride || tx.billingMonth || tx.date.slice(0, 7);
      if (bill !== month) continue;
      const amount = (Number(tx.amount) || 0) - Math.max(0, Number(tx.reversalAmount) || 0);
      if (amount !== 0) payments.push({ transaction: tx, amount });
    }
  }

  usage.sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));
  payments.sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));

  return {
    usage,
    payments,
    usageTotal: usage.reduce((sum, item) => sum + item.billedAmount, 0),
    paymentTotal: payments.reduce((sum, item) => sum + item.amount, 0)
  };
}
