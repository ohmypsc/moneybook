/** 금액을 화면 표시용 문자열로 바꿉니다. 반올림 후 0이 되는 값(-0 포함)은 부호 없이 0으로 표시합니다. */
export type FormatMoneyOptions = {
  absolute?: boolean;
  showPlus?: boolean;
  currency?: string;
  maximumFractionDigits?: number;
};

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string, maximumFractionDigits: number) {
  const key = `${currency}:${maximumFractionDigits}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const formatter =
    currency === "KRW"
      ? new Intl.NumberFormat("ko-KR", { maximumFractionDigits })
      : new Intl.NumberFormat("ko-KR", {
          style: "currency",
          currency,
          currencyDisplay: "narrowSymbol",
          maximumFractionDigits
        });

  formatterCache.set(key, formatter);
  return formatter;
}

export function formatMoney(amount: number, options: FormatMoneyOptions = {}) {
  const {
    absolute = false,
    showPlus = false,
    currency = "KRW",
    maximumFractionDigits = currency === "KRW" ? 0 : 2
  } = options;

  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const signed = absolute ? Math.abs(safeAmount) : safeAmount;
  const scale = 10 ** maximumFractionDigits;
  // -0이나 -0.3처럼 반올림하면 0이 되는 음수가 "-0원"으로 보이지 않게 합니다.
  const value = Math.round(Math.abs(signed) * scale) === 0 ? 0 : signed;
  const formatter = getFormatter(currency, maximumFractionDigits);
  const prefix = showPlus && value > 0 ? "+" : "";
  const formatted = formatter.format(value);

  return currency === "KRW" ? `${prefix}${formatted}원` : `${prefix}${formatted}`;
}
