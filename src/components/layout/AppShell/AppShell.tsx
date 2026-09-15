import type {
  ReactNode,
} from "react";

import {
  BottomNav,
  type NavigationKey,
} from "../BottomNav/BottomNav";

import styles from "./AppShell.module.css";

type AppShellProps = {
  activeNavigation: NavigationKey;

  onNavigate: (
    navigation: NavigationKey
  ) => void;

  pendingTransactionCount?: number;
  pendingTransactionFailedCount?: number;

  children: ReactNode;
};

export function AppShell({
  activeNavigation,
  onNavigate,
  pendingTransactionCount = 0,
  pendingTransactionFailedCount = 0,
  children,
}: AppShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.main}>
        {children}
      </div>

      <BottomNav
        activeNavigation={
          activeNavigation
        }
        pendingTransactionCount={
          pendingTransactionCount
        }
        pendingTransactionFailedCount={
          pendingTransactionFailedCount
        }
        onNavigate={onNavigate}
      />
    </div>
  );
}
