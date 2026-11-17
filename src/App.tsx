import type { ReactNode } from "react";

import { useAppNavigation, useNavigationHistorySync } from "./app/hooks/useAppNavigation";
import { useAuthSession } from "./app/hooks/useAuthSession";
import { useLedgerBackgroundSync } from "./app/hooks/useLedgerBackgroundSync";
import { usePendingTransactionSummary } from "./app/hooks/usePendingTransactionSummary";
import { createInputPresetFromTransaction } from "./app/navigation";
import type { Transaction } from "./api/transactions";
import { Card } from "./components/common/Card/Card";
import { ConfirmDialogHost } from "./components/common/ConfirmDialog/ConfirmDialog";
import { AppShell } from "./components/layout/AppShell/AppShell";
import AssetsPage from "./pages/AssetsPage/AssetsPage";
import HistoryPage from "./pages/HistoryPage/HistoryPage";
import HomePage from "./pages/HomePage/HomePage";
import InputPage from "./pages/InputPage/InputPage";
import LoginPage from "./pages/LoginPage/LoginPage";
import SettingsPage from "./pages/SettingsPage/SettingsPage";
import styles from "./App.module.css";

/*
 * 앱 최상위 화면 조립.
 * 상태와 부수 효과는 src/app/hooks/* 에 있습니다.
 */
export default function App() {
  const navigation = useAppNavigation();
  const { status, user, loginLoading, loginError, handleLogin } = useAuthSession(navigation.goHome);

  useNavigationHistorySync(status, user, navigation);
  const pendingTransactionSummary = usePendingTransactionSummary(status, user);
  const remoteRevision = useLedgerBackgroundSync(status, user);

  if (status === "checking") {
    return (
      <main className={styles.center}>
        <Card as="section" padding="lg" className={styles.panel}>
          <h1>우리 가계부</h1>
          <p>로그인 상태를 확인하고 있습니다.</p>
        </Card>
      </main>
    );
  }

  if (status === "guest" || !user) {
    return <LoginPage loading={loginLoading} errorMessage={loginError} onLogin={handleLogin} />;
  }

  const { activeNavigation, inputInitialDate, inputPreset, navigateTo } = navigation;

  function copyTransactionToInput(transaction: Transaction) {
    navigateTo("input", null, createInputPresetFromTransaction(transaction));
  }

  let pageContent: ReactNode;

  if (activeNavigation === "home") {
    pageContent = <HomePage onCopyTransaction={copyTransactionToInput} />;
  } else if (activeNavigation === "calendar") {
    pageContent = (
      <HistoryPage
        onAddTransaction={date => navigateTo("input", date)}
        onCopyTransaction={copyTransactionToInput}
      />
    );
  } else if (activeNavigation === "input") {
    pageContent = (
      <InputPage
        userName={user.name}
        initialDate={inputInitialDate}
        initialMode={inputPreset?.mode ?? null}
        initialFromAccountId={inputPreset?.fromAccountId ?? null}
        initialToAccountId={inputPreset?.toAccountId ?? null}
        initialCategoryId={inputPreset?.categoryId ?? null}
        initialAmount={inputPreset?.amount ?? null}
        initialPaymentMethodId={inputPreset?.paymentMethodId ?? null}
        initialSpendingTarget={inputPreset?.spendingTarget ?? null}
        initialDescription={inputPreset?.description ?? null}
        initialMemo={inputPreset?.memo ?? null}
      />
    );
  } else if (activeNavigation === "assets") {
    pageContent = (
      <AssetsPage userName={user.name} onOpenInput={preset => navigateTo("input", null, preset)} />
    );
  } else {
    pageContent = <SettingsPage refreshRevision={remoteRevision} />;
  }

  return (
    <>
      <AppShell
        activeNavigation={activeNavigation}
        pendingTransactionCount={pendingTransactionSummary.total}
        pendingTransactionFailedCount={pendingTransactionSummary.failed}
        onNavigate={nextNavigation => navigateTo(nextNavigation, null)}
      >
        {pageContent}
      </AppShell>

      <ConfirmDialogHost />
    </>
  );
}
