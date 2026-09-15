import type {
  HTMLAttributes,
  ReactNode
} from "react";

import styles from "./Card.module.css";

export type CardPadding = "none" | "sm" | "md" | "lg";
export type CardTone = "default" | "soft" | "blue" | "sage";
export type CardShadow = "none" | "card";

type CardTag = "div" | "section" | "article" | "form";

type CardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: CardTag;
  padding?: CardPadding;
  tone?: CardTone;
  shadow?: CardShadow;
};

export function Card({
  children,
  as = "div",
  padding = "md",
  tone = "default",
  shadow = "card",
  className = "",
  ...props
}: CardProps) {
  const Component = as;
  const classNames = [
    styles.card,
    styles[`padding_${padding}`],
    styles[`tone_${tone}`],
    styles[`shadow_${shadow}`],
    className
  ].filter(Boolean).join(" ");

  return (
    <Component className={classNames} {...props}>
      {children}
    </Component>
  );
}
