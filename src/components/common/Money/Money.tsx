import styles
  from "./Money.module.css";


type MoneyProps = {
  amount: number;

  showPlus?:
    boolean;

  className?:
    string;
};


const formatter =
  new Intl.NumberFormat(
    "ko-KR",
    {
      maximumFractionDigits: 0
    }
  );


export function Money({
  amount,
  showPlus = false,
  className = ""
}: MoneyProps) {

  const prefix =
    showPlus &&
    amount > 0
      ? "+"
      : "";


  const classNames = [
    styles.money,
    className
  ]
    .filter(Boolean)
    .join(" ");


  return (
    <span
      className={
        classNames
      }
    >
      {
        prefix
      }
      {
        formatter.format(
          amount
        )
      }
      원
    </span>
  );
}
