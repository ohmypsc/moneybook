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

  children: ReactNode;
};

export function AppShell({
  activeNavigation,
  onNavigate,
  children,
}: AppShellProps) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        {children}
      </main>

      <BottomNav
        activeNavigation={
          activeNavigation
        }
        onNavigate={onNavigate}
      />
    </div>
  );
}
