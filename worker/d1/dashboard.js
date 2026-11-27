// 대시보드 집계와 bootstrap 응답 생성
import {
  estimateBillingMonth as mbD1EstimateBilling,
  monthOnly as mbD1MonthOnly
} from "../domain/date.js";
import { categoryUsageCounts } from "../domain/categoryUsage.js";
import { holdingCurrencies as mbD1HoldingCurrencies } from "../domain/investment.js";
import { installmentAmountForMonth, installmentRemainingAfter } from "../domain/installment.js";
import { netMonthStats as mbD1NetMonthStats } from "../domain/monthStats.js";
import { listRealEstateAssets, realEstateSummary } from "../realEstate.js";
import { mbD1AutomationSettingsData } from "./automation.js";
import { mbD1EnsureDefaultCashbackIncomeCategory } from "./benefits.js";
import {
  MB_D1_API_VERSION,
  MB_D1_HOUSEHOLD_ID,
  mbD1All,
  mbD1CurrentDateSeoul,
  mbD1CurrentMonthSeoul,
  mbD1Fail,
  mbD1GetLedgerConfigData,
  mbD1IsInvestmentAccount,
  mbD1Members,
  mbD1Number,
  mbD1Round,
  mbD1Text,
  mbD1TimestampMs
} from "./core.js";
import {
  mbD1AllTransactions,
  mbD1Holdings,
  mbD1MapAccountRow,
  mbD1MapCategory,
  mbD1RawAccounts,
  mbD1Trades
} from "./records.js";
import { mbD1HouseholdOverviewData, mbD1InputPreferencesData } from "./settings.js";

export function mbD1TransactionAfterBaseline(transaction, baselineAt) {
  const baselineMs = mbD1TimestampMs(baselineAt);
  if (baselineMs === null || !transaction?.date) return false;
  const baselineDate = new Date(baselineMs).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  if (transaction.date > baselineDate) return true;
  if (transaction.date < baselineDate) return false;
  const createdMs = mbD1TimestampMs(transaction.createdAt);
  return createdMs !== null && createdMs > baselineMs;
}

export function mbD1InvestmentStatusFromData(
  accounts,
  transactions,
  trades,
  holdings,
  accountId = ""
) {
  const valueMap = new Map();
  for (const holding of holdings || []) {
    if (holding.isDeleted) continue;
    valueMap.set(
      holding.accountId,
      (valueMap.get(holding.accountId) || 0) + mbD1Number(holding.valueKrw)
    );
  }
  let items = (accounts || [])
    .filter(account => !account.isDeleted && account.active && mbD1IsInvestmentAccount(account))
    .map(account => {
      const configured = Boolean(account.cashBaselineAt);
      let ledgerDelta = 0;
      let tradeDelta = 0;
      let realized = 0;
      if (configured) {
        for (const tx of transactions || []) {
          if (tx.isDeleted || !mbD1TransactionAfterBaseline(tx, account.cashBaselineAt)) continue;
          if (tx.fromAccountId === account.accountId) ledgerDelta -= mbD1Number(tx.amount);
          if (tx.toAccountId === account.accountId) ledgerDelta += mbD1Number(tx.amount);
        }
        const baselineMs = mbD1TimestampMs(account.cashBaselineAt);
        for (const trade of trades || []) {
          if (trade.isDeleted || trade.accountId !== account.accountId) continue;
          const createdMs = mbD1TimestampMs(trade.createdAt);
          if (baselineMs !== null && createdMs !== null && createdMs < baselineMs) continue;
          tradeDelta +=
            trade.tradeType === "매수"
              ? -mbD1Number(trade.settlementKrw)
              : mbD1Number(trade.settlementKrw);
          realized += mbD1Number(trade.realizedPnlKrw);
        }
      }
      const currentCash = configured
        ? mbD1Number(account.cashBaselineKrw) + ledgerDelta + tradeDelta
        : null;
      const holdingValue = mbD1Number(valueMap.get(account.accountId));
      return {
        accountId: account.accountId,
        accountName: account.displayName,
        owner: account.owner,
        accountType: account.accountType,
        subType: account.subType,
        cashBaselineConfigured: configured,
        cashBaselineKrw: configured ? mbD1Number(account.cashBaselineKrw) : null,
        cashBaselineAt: account.cashBaselineAt,
        ledgerCashDeltaKrw: configured ? mbD1Round(ledgerDelta, 2) : null,
        investmentTradeCashDeltaKrw: configured ? mbD1Round(tradeDelta, 2) : null,
        currentCashKrw: currentCash === null ? null : mbD1Round(currentCash, 2),
        holdingValueKrw: mbD1Round(holdingValue, 2),
        accountValueKrw: mbD1Round((currentCash === null ? 0 : currentCash) + holdingValue, 2),
        realizedPnlKrw: mbD1Round(realized, 2)
      };
    });
  if (accountId) items = items.filter(item => item.accountId === accountId);
  return { accounts: items };
}

export async function mbD1LoadFinancialData(env) {
  const rawAccounts = await mbD1RawAccounts(env);
  const accounts = rawAccounts.map(mbD1MapAccountRow);
  const transactions = await mbD1AllTransactions(env, false);
  const holdings = await mbD1Holdings(env, false);
  const trades = await mbD1Trades(env, false);
  const investment = mbD1InvestmentStatusFromData(accounts, transactions, trades, holdings);
  const balances = new Map();
  for (const account of accounts) {
    if (account.active && !account.isDeleted)
      balances.set(account.accountId, mbD1Number(account.openingBalance));
  }
  for (const tx of transactions) {
    if (tx.fromAccountId && balances.has(tx.fromAccountId)) {
      balances.set(tx.fromAccountId, balances.get(tx.fromAccountId) - mbD1Number(tx.amount));
    }
    if (tx.toAccountId && balances.has(tx.toAccountId)) {
      balances.set(tx.toAccountId, balances.get(tx.toAccountId) + mbD1Number(tx.amount));
    }
  }
  for (const item of investment.accounts) {
    balances.set(item.accountId, item.accountValueKrw);
  }
  for (const account of accounts) {
    account.currentBalance = balances.has(account.accountId)
      ? mbD1Round(balances.get(account.accountId), 2)
      : mbD1Number(account.sheetCurrentBalance);
    const inv = investment.accounts.find(item => item.accountId === account.accountId);
    if (inv) {
      account.investmentCashConfigured = inv.cashBaselineConfigured;
      account.investmentCashKrw = inv.currentCashKrw ?? 0;
      account.securitiesValueKrw = inv.holdingValueKrw;
      account.realizedPnlKrw = inv.realizedPnlKrw;
    }
  }
  return { accounts, transactions, holdings, trades, investment, balances };
}

export async function mbD1BuildDashboard(env, monthValue = "") {
  const month = monthValue || mbD1CurrentMonthSeoul();
  if (!mbD1MonthOnly(month)) mbD1Fail("INVALID_MONTH", "month는 YYYY-MM 형식이어야 합니다.");
  const data = await mbD1LoadFinancialData(env);
  const { accounts, transactions, holdings, trades, investment } = data;
  const realEstate = realEstateSummary(await listRealEstateAssets(env, MB_D1_HOUSEHOLD_ID, false));
  let assets = realEstate.totalValueKrw;
  let liabilities = 0;
  let investmentValue = 0;
  let cashLikeValue = 0;
  for (const account of accounts.filter(item => item.active && !item.isDeleted)) {
    const balance = mbD1Number(account.currentBalance);
    if (account.accountType === "부채") {
      liabilities += Math.max(0, -balance);
    } else {
      assets += balance;
      if (mbD1IsInvestmentAccount(account)) investmentValue += balance;
      else cashLikeValue += balance;
    }
  }
  const stats = mbD1NetMonthStats(transactions, month);
  const transactionById = new Map(transactions.map(tx => [tx.transactionId, tx]));
  const cards = accounts
    .filter(account => account.active && !account.isDeleted && account.subType === "신용카드")
    .map(card => {
      let usage = 0;
      let payments = 0;
      let installmentRemaining = 0;
      for (const tx of transactions) {
        if (tx.type === "지출" && tx.paymentMethodId === card.accountId) {
          const bill =
            tx.billingOverride ||
            tx.billingMonth ||
            mbD1EstimateBilling(tx.date, card.billingCutoffDay, card.paymentDay);
          // 할부는 첫 청구월부터 개월 수만큼 나눠 청구합니다(일시불이면 그 달 전액).
          usage += installmentAmountForMonth(tx.amount, tx.installmentMonths, bill, month);
          if (tx.installmentMonths) {
            installmentRemaining += installmentRemainingAfter(
              tx.amount,
              tx.installmentMonths,
              bill,
              month
            );
          }
        }
        if (tx.type === "이체" && tx.toAccountId === card.accountId) {
          const bill = tx.billingOverride || tx.billingMonth || tx.date.slice(0, 7);
          if (bill === month) payments += tx.amount;
        }
        if (tx.reversalOf) {
          const original = transactionById.get(tx.reversalOf);
          if (
            tx.toAccountId === card.accountId &&
            original &&
            original.type === "지출" &&
            original.paymentMethodId === card.accountId
          ) {
            const bill =
              original.billingOverride ||
              original.billingMonth ||
              mbD1EstimateBilling(original.date, card.billingCutoffDay, card.paymentDay);
            // 할부 거래의 취소·환불은 남은 회차에 같은 비율로 나눠 빼서 전액 취소 시 정확히 0이 되게 합니다.
            usage -= installmentAmountForMonth(tx.amount, original.installmentMonths, bill, month);
            if (original.installmentMonths) {
              installmentRemaining -= installmentRemainingAfter(
                tx.amount,
                original.installmentMonths,
                bill,
                month
              );
            }
          }
          if (
            tx.fromAccountId === card.accountId &&
            original &&
            original.type === "이체" &&
            original.toAccountId === card.accountId
          ) {
            const bill =
              original.billingOverride || original.billingMonth || original.date.slice(0, 7);
            if (bill === month) payments -= tx.amount;
          }
        }
      }
      return {
        accountId: card.accountId,
        accountName: card.displayName,
        billingMonth: month,
        usage: mbD1Round(usage, 2),
        payments: mbD1Round(payments, 2),
        estimatedRemaining: mbD1Round(usage - payments, 2),
        // 이번 청구월 이후에 남은 할부 청구액(다음 달부터 나갈 돈)
        installmentRemaining: mbD1Round(Math.max(0, installmentRemaining), 2)
      };
    });
  const trend = [];
  const [year, monthNumber] = month.split("-").map(Number);
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1 - index, 1));
    const trendMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const item = mbD1NetMonthStats(transactions, trendMonth);
    trend.push({ month: trendMonth, income: item.income, expense: item.expense, net: item.net });
  }
  const recentTransactions = transactions
    .slice()
    .sort(
      (a, b) =>
        (b.date || "").localeCompare(a.date || "") ||
        (b.createdAt || "").localeCompare(a.createdAt || "")
    )
    .slice(0, 20)
    .map(tx => ({
      transactionId: tx.transactionId,
      date: tx.date,
      type: tx.type,
      categoryId: tx.categoryId,
      category: tx.category,
      amount: tx.amount,
      fromAccountId: tx.fromAccountId,
      fromAccount: tx.fromAccount,
      toAccountId: tx.toAccountId,
      toAccount: tx.toAccount,
      paymentMethodId: tx.paymentMethodId,
      paymentMethod: tx.paymentMethod,
      spendingTarget: tx.spendingTarget,
      description: tx.description,
      memo: tx.memo,
      reversalOf: tx.reversalOf
    }));
  const holdingCurrencies = mbD1HoldingCurrencies(trades);
  const staleManual = holdings
    .filter(
      holding =>
        holding.quoteMode === "수동" &&
        holding.quantity > 0 &&
        (holding.elapsedDays === null ||
          // 금액형 상품(발행어음·IMA 등)은 이자만 바뀌므로 한 달에 한 번만 확인을 권합니다.
          holding.elapsedDays >= (holding.stockCode.startsWith("AMT-") ? 30 : 7))
    )
    .map(holding => ({
      holdingId: holding.holdingId,
      accountId: holding.accountId,
      accountName: holding.accountName,
      stockCode: holding.stockCode,
      stockName: holding.stockName,
      lastUpdated: holding.lastUpdated,
      elapsedDays: holding.elapsedDays
    }));
  return {
    backendVersion: MB_D1_API_VERSION,
    month,
    summary: {
      assets: mbD1Round(assets, 2),
      liabilities: mbD1Round(liabilities, 2),
      netWorth: mbD1Round(assets - liabilities, 2),
      investmentValue: mbD1Round(investmentValue, 2),
      cashLikeValue: mbD1Round(cashLikeValue, 2),
      realEstateValue: mbD1Round(realEstate.totalValueKrw, 2),
      realEstateCount: realEstate.count,
      monthIncome: stats.income,
      monthIncomeGross: stats.incomeGross,
      monthIncomeReversals: stats.incomeReversals,
      monthExpense: stats.expense,
      monthExpenseGross: stats.expenseGross,
      monthRefunds: stats.expenseRefunds,
      monthNetCashFlow: stats.net
    },
    accounts: accounts.filter(account => account.active && !account.isDeleted),
    categoryExpense: stats.categoryExpense,
    spendingTargetExpense: stats.targetExpense,
    cards,
    monthlyTrend: trend,
    recentTransactions,
    categoryUsage: categoryUsageCounts(transactions, mbD1CurrentDateSeoul()),
    realEstate,
    investments: {
      totalAccountValue: mbD1Round(
        investment.accounts.reduce((sum, item) => sum + item.accountValueKrw, 0),
        2
      ),
      cashTotal: mbD1Round(
        investment.accounts.reduce((sum, item) => sum + (item.currentCashKrw ?? 0), 0),
        2
      ),
      realizedPnlTotal: mbD1Round(
        trades.reduce((sum, item) => sum + item.realizedPnlKrw, 0),
        2
      ),
      accounts: investment.accounts,
      holdings: holdings.map(holding => ({
        ...holding,
        currency:
          holdingCurrencies.get(holding.holdingId) || (holding.market === "국내" ? "KRW" : "USD")
      })),
      staleManualPrices: staleManual,
      cashBaselinePending: investment.accounts
        .filter(item => !item.cashBaselineConfigured)
        .map(item => ({ accountId: item.accountId, accountName: item.accountName }))
    }
  };
}

export async function mbD1BuildBootstrap(env, session = null) {
  await mbD1EnsureDefaultCashbackIncomeCategory(env);
  const [members, rawAccounts, categoryRows, ledgerConfig, inputPreferences, automationSettings] =
    await Promise.all([
      mbD1Members(env),
      mbD1RawAccounts(env),
      mbD1All(
        env,
        "SELECT * FROM categories WHERE household_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY CASE type WHEN '수입' THEN 1 WHEN '지출' THEN 2 WHEN '이체' THEN 3 ELSE 99 END,name",
        [MB_D1_HOUSEHOLD_ID]
      ),
      mbD1GetLedgerConfigData(env),
      mbD1InputPreferencesData(env, session?.name || ""),
      mbD1AutomationSettingsData(env)
    ]);
  const accounts = rawAccounts
    .map(mbD1MapAccountRow)
    .filter(account => account.active && !account.isDeleted);
  const categories = categoryRows.map(mbD1MapCategory);
  const memberNames = members.map(member => mbD1Text(member.display_name)).filter(Boolean);
  return {
    userName: session?.name || "",
    householdOverview: await mbD1HouseholdOverviewData(env),
    backendVersion: MB_D1_API_VERSION,
    transactionTypes: ["수입", "지출", "이체"],
    investmentTradeTypes: ["매수", "매도", "배당"],
    members: memberNames,
    spendingTargets: [...memberNames, "공동"],
    accounts,
    categories,
    investmentAccounts: accounts.filter(mbD1IsInvestmentAccount).map(account => ({
      accountId: account.accountId,
      accountName: account.displayName,
      owner: account.owner,
      accountType: account.accountType,
      subType: account.subType,
      cashBaselineConfigured: Boolean(account.cashBaselineAt),
      cashBaselineKrw: account.cashBaselineKrw,
      cashBaselineAt: account.cashBaselineAt
    })),
    ledgerConfig,
    inputPreferences,
    automationSettings
  };
}
