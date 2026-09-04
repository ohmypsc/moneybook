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
      <div className={styles.main}>
        {children}
      </div>

      <BottomNav
        activeNavigation={
          activeNavigation
        }
        onNavigate={onNavigate}
      />
    </div>
  );
}
