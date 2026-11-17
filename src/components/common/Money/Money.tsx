import type { HTMLAttributes } from "react";

import { formatMoney } from "../../../utils/money";
import styles from "./Money.module.css";

export { formatMoney };
export type { FormatMoneyOptions } from "../../../utils/money";

export type MoneyTone = "default" | "muted" | "income" | "expense" | "positive" | "negative";

export type MoneySize = "inherit" | "sm" | "md" | "lg";

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
  const classNames = [styles.money, styles[tone], styles[`size_${size}`], className]
    .filter(Boolean)
    .join(" ");

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
