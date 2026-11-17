import ClassificationSettings from "./ClassificationSettings";
import { useEffect, useState } from "react";

import AutomationSettingsPanel from "./AutomationSettingsPanel";

import { CategorySettings } from "./CategorySettings";

import { AccountSettings } from "./AccountSettings";

import { LedgerDataSettings } from "./LedgerDataSettings";

import { ProfileSettings } from "./ProfileSettings";

import { DetailHeader, SettingsHome } from "./SettingsNavigation";

import type { SettingsView } from "./SettingsNavigation";

import styles from "./SettingsPage.module.css";

type SettingsHistoryState = {
  moneybook?: boolean;
  navigation?: string;
  moneybookSettingsView?: SettingsView;
};

function isSettingsView(value: unknown): value is SettingsView {
  return (
    value === "home" ||
    value === "categories" ||
    value === "accounts" ||
    value === "classification" ||
    value === "automation" ||
    value === "ledger" ||
    value === "profile"
  );
}

function historySettingsView() {
  const state = window.history.state as SettingsHistoryState | null;

  return isSettingsView(state?.moneybookSettingsView) ? state.moneybookSettingsView : "home";
}

interface SettingsPageProps {
  refreshRevision?: number;
}

export default function SettingsPage({ refreshRevision = 0 }: SettingsPageProps) {
  const [view, setView] = useState<SettingsView>(() => historySettingsView());

  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      const state = event.state as SettingsHistoryState | null;

      if (state?.navigation !== "settings") {
        return;
      }

      setView(isSettingsView(state.moneybookSettingsView) ? state.moneybookSettingsView : "home");
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    window.requestAnimationFrame(() =>
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "auto"
      })
    );
  }, [view]);

  function openView(nextView: SettingsView) {
    const currentState = window.history.state as SettingsHistoryState | null;

    window.history.pushState(
      {
        ...(currentState || {}),
        moneybook: true,
        navigation: "settings",
        moneybookSettingsView: nextView
      },
      ""
    );

    setView(nextView);
  }

  function handleDetailBack() {
    const currentState = window.history.state as SettingsHistoryState | null;

    if (
      currentState?.navigation === "settings" &&
      isSettingsView(currentState.moneybookSettingsView) &&
      currentState.moneybookSettingsView !== "home"
    ) {
      window.history.back();
      return;
    }

    setView("home");
  }

  const detail = {
    classification: {
      title: "자동 분류·태그",
      description: "거래 내용과 계좌에 따라 카테고리와 태그를 자동으로 붙입니다."
    },
    categories: {
      title: "카테고리 관리",

      description: "카테고리를 관리하고 입력 화면 순서를 정합니다."
    },

    accounts: {
      title: "자산 관리",

      description: "자산을 관리하고 결제수단 노출과 입력 화면 순서를 정합니다."
    },

    automation: {
      title: "자동화",

      description: "고정 거래의 자동 등록과 확인 방식을 관리합니다."
    },

    ledger: {
      title: "가계부 운영·데이터",

      description: "운영 기준, 삭제 내역 복원, 데이터 내보내기를 관리합니다."
    },

    profile: {
      title: "화면·알림·내 계정",

      description: "화면 테마와 배우자 입력 알림을 정하고, 로그인 정보를 확인합니다."
    }
  } as const;

  const detailViewKey = view as Exclude<SettingsView, "home">;

  return (
    <main className={styles.page}>
      {view === "home" ? (
        <SettingsHome onOpen={openView} />
      ) : (
        <>
          <DetailHeader
            title={detail[detailViewKey].title}
            description={detail[detailViewKey].description}
            onBack={handleDetailBack}
          />

          {view === "classification" && (
            <ClassificationSettings key={`classification:${refreshRevision}`} />
          )}
          {view === "categories" && <CategorySettings key={`categories:${refreshRevision}`} />}

          {view === "accounts" && <AccountSettings key={`accounts:${refreshRevision}`} />}

          {view === "automation" && (
            <AutomationSettingsPanel key={`automation:${refreshRevision}`} />
          )}

          {view === "ledger" && <LedgerDataSettings key={`ledger:${refreshRevision}`} />}

          {view === "profile" && <ProfileSettings />}
        </>
      )}
    </main>
  );
}
