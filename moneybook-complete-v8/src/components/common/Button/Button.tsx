import type {
  ButtonHTMLAttributes,
  ReactNode
} from "react";

import styles
  from "./Button.module.css";


export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost";


type ButtonProps =
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;

    variant?:
      ButtonVariant;

    fullWidth?:
      boolean;
  };


export function Button({
  children,
  variant = "primary",
  fullWidth = false,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {

  const classNames = [
    styles.button,
    styles[variant],
    fullWidth
      ? styles.fullWidth
      : "",
    className
  ]
    .filter(Boolean)
    .join(" ");


  return (
    <button
      type={
        type
      }

      className={
        classNames
      }

      {...props}
    >
      {
        children
      }
    </button>
  );
}
