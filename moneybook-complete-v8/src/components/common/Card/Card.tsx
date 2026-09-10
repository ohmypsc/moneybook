import type {
  HTMLAttributes,
  ReactNode
} from "react";

import styles
  from "./Card.module.css";


type CardProps =
  HTMLAttributes<HTMLDivElement> & {
    children: ReactNode;

    compact?:
      boolean;

    flat?:
      boolean;
  };


export function Card({
  children,
  compact = false,
  flat = false,
  className = "",
  ...props
}: CardProps) {

  const classNames = [
    styles.card,
    compact
      ? styles.compact
      : "",
    flat
      ? styles.flat
      : "",
    className
  ]
    .filter(Boolean)
    .join(" ");


  return (
    <div
      className={
        classNames
      }

      {...props}
    >
      {
        children
      }
    </div>
  );
}
