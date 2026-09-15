import {
  forwardRef
} from "react";

import type {
  ButtonHTMLAttributes,
  ReactNode
} from "react";

import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "soft"
  | "ghost"
  | "danger"
  | "dangerSoft";

export type ButtonSize =
  | "sm"
  | "md"
  | "lg"
  | "xl";

export type ButtonProps =
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    iconOnly?: boolean;
    loading?: boolean;
    loadingLabel?: string;
  };

export const Button =
  forwardRef<
    HTMLButtonElement,
    ButtonProps
  >(function Button(
    {
      children,
      variant = "primary",
      size = "md",
      fullWidth = false,
      iconOnly = false,
      loading = false,
      loadingLabel = "처리 중",
      className = "",
      disabled,
      type = "button",
      ...props
    },
    ref
  ) {
    const classNames = [
      styles.button,
      styles[variant],
      styles[size],
      fullWidth ? styles.fullWidth : "",
      iconOnly ? styles.iconOnly : "",
      className
    ].filter(Boolean).join(" ");

    return (
      <button
        ref={ref}
        type={type}
        className={classNames}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            <span>{loadingLabel}</span>
          </>
        ) : children}
      </button>
    );
  });
