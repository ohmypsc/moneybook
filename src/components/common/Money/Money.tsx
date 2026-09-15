import type { HTMLAttributes } from "react";

import styles from "./Money.module.css";

export type MoneyTone =
  | "default"
  | "muted"
  | "income"
  | "expense"
  | "positive"
  | "negative";

export type MoneySize = "inherit" | "sm" | "md" | "lg";

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

  const formatter = currency === "KRW"
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

export function formatMoney(
  amount: number,
  options: FormatMoneyOptions = {}
) {
  const {
    absolute = false,
    showPlus = false,
    currency = "KRW",
    maximumFractionDigits = currency === "KRW" ? 0 : 2
  } = options;

  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const value = absolute ? Math.abs(safeAmount) : safeAmount;
  const formatter = getFormatter(currency, maximumFractionDigits);
  const prefix = showPlus && value > 0 ? "+" : "";
  const formatted = formatter.format(value);

  return currency === "KRW"
    ? `${prefix}${formatted}원`
    : `${prefix}${formatted}`;
}

type MoneyProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  amount: number;
  absolute?: boolean;
  showPlus?: boolean;
  currency?: string;
  maximumFractionDigits?: number;
  tone?: MoneyTone;
  size?: MoneySize;
};

export function Money({
  amount,
  absolute = false,
  showPlus = false,
  currency = "KRW",
  maximumFractionDigits,
  tone = "default",
  size = "inherit",
  className = "",
  ...props
}: MoneyProps) {
  const classNames = [
    styles.money,
    styles[tone],
    styles[`size_${size}`],
    className
  ].filter(Boolean).join(" ");

  return (
    <span className={classNames} {...props}>
      {formatMoney(amount, {
        absolute,
        showPlus,
        currency,
        maximumFractionDigits
      })}
    </span>
  );
}
