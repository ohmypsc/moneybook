export interface DashboardCard {
  name: string;
  used: number;
  prepaid: number;
  remaining: number;
}

export interface DashboardData {
  assets: number;
  liabilities: number;
  netWorth: number;
  investmentValue: number;
  cashLikeValue: number;
  monthIncome: number;
  monthExpense: number;
  monthNetCashFlow: number;
  cards?: DashboardCard[];
}
