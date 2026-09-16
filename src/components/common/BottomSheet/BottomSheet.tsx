import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef
} from "react";

import { Button } from "../Button/Button";
import styles from "./BottomSheet.module.css";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

export interface BottomSheetProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  ariaLabel?: string;
  contentClassName?: string;
  size?: "default" | "large";
}

export function BottomSheet({
  title,
  children,
  onClose,
  ariaLabel,
  contentClassName = "",
  size = "default"
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.requestAnimationFrame(() => {
      const firstFocusable =
        sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? closeButtonRef.current)?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab" || !sheetRef.current) {
      return;
    }

    const focusable = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    );

    if (focusable.length === 0) {
      event.preventDefault();
      closeButtonRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={sheetRef}
        className={[styles.sheet, size === "large" ? styles.large : ""].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.handle} aria-hidden="true" />

        <div className={styles.header}>
          <h2>{title}</h2>
          <Button
            ref={closeButtonRef}
            variant="soft"
            size="sm"
            iconOnly
            className={styles.close}
            aria-label="닫기"
            onClick={onClose}
          >
            ×
          </Button>
        </div>

        <div className={[styles.content, contentClassName].filter(Boolean).join(" ")}>
          {children}
        </div>
      </section>
    </div>
  );
}
