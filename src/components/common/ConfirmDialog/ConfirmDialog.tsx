import {
  useEffect,
  useRef,
  useSyncExternalStore
} from "react";

import { createPortal } from "react-dom";

import { Button } from "../Button/Button";

import {
  getConfirmActionSnapshot,
  resolveConfirmAction,
  subscribeConfirmAction
} from "../../../utils/confirmAction";

import styles from "./ConfirmDialog.module.css";

export function ConfirmDialogHost() {
  const request =
    useSyncExternalStore(
      subscribeConfirmAction,
      getConfirmActionSnapshot,
      () => null
    );

  const cancelRef =
    useRef<HTMLButtonElement>(null);

  const confirmRef =
    useRef<HTMLButtonElement>(null);

  useEffect(
    () => {
      if (!request) {
        return;
      }

      const activeRequest = request;

      const previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      const frame =
        window.requestAnimationFrame(
          () => {
            if (
              activeRequest.tone === "danger"
            ) {
              cancelRef.current?.focus();
            } else {
              confirmRef.current?.focus();
            }
          }
        );

      function handleKeyDown(
        event: KeyboardEvent
      ) {
        if (
          event.key === "Escape"
        ) {
          event.preventDefault();
          resolveConfirmAction(
            activeRequest.id,
            false
          );
          return;
        }

        if (
          event.key !== "Tab"
        ) {
          return;
        }

        const first =
          cancelRef.current;
        const last =
          confirmRef.current;

        if (!first || !last) {
          return;
        }

        if (
          event.shiftKey &&
          document.activeElement === first
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === last
        ) {
          event.preventDefault();
          first.focus();
        }
      }

      document.addEventListener(
        "keydown",
        handleKeyDown
      );

      return () => {
        window.cancelAnimationFrame(
          frame
        );

        document.removeEventListener(
          "keydown",
          handleKeyDown
        );

        previousFocus?.focus();
      };
    },
    [request]
  );

  if (
    !request ||
    typeof document === "undefined"
  ) {
    return null;
  }

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={
        event => {
          if (
            event.target ===
              event.currentTarget
          ) {
            resolveConfirmAction(
              request.id,
              false
            );
          }
        }
      }
    >
      <section
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`confirm-title-${request.id}`}
        aria-describedby={`confirm-message-${request.id}`}
      >
        <h2
          id={`confirm-title-${request.id}`}
          className={styles.title}
        >
          {request.title}
        </h2>

        <p
          id={`confirm-message-${request.id}`}
          className={styles.message}
        >
          {request.message}
        </p>

        <div
          className={styles.actions}
        >
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={
              () =>
                resolveConfirmAction(
                  request.id,
                  false
                )
            }
          >
            {request.cancelLabel}
          </Button>

          <Button
            ref={confirmRef}
            variant={
              request.tone === "danger"
                ? "danger"
                : "primary"
            }
            onClick={
              () =>
                resolveConfirmAction(
                  request.id,
                  true
                )
            }
          >
            {request.confirmLabel}
          </Button>
        </div>
      </section>
    </div>,
    document.body
  );
}
