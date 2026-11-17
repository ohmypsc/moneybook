import { useEffect, useRef, useState } from "react";

import { prefetchBootstrap } from "../../api/bootstrap";
import { prefetchManagedSettings } from "../../api/settingsManagement";
import type { NavigationKey } from "../../components/layout/BottomNav/BottomNav";
import type { User } from "../../types/api";
import { parseAppShortcut } from "../../utils/appShortcut";
import {
  createHistoryState,
  isPrimaryNavigation,
  isSameHistoryDestination,
  scrollToPageTop
} from "../navigation";
import type { AppHistoryState, InputLaunchPreset } from "../navigation";

export type AppNavigation = ReturnType<typeof useAppNavigation>;

/** 현재 화면(하단 탭)과 입력 화면에 넘길 초기값을 관리합니다. */
export function useAppNavigation() {
  const [activeNavigation, setActiveNavigation] = useState<NavigationKey>("home");
  const [inputInitialDate, setInputInitialDate] = useState<string | null>(null);
  const [inputPreset, setInputPreset] = useState<InputLaunchPreset | null>(null);

  function goHome() {
    setActiveNavigation("home");
  }

  function navigateTo(
    nextNavigation: NavigationKey,
    nextInputDate: string | null = null,
    nextInputPreset: InputLaunchPreset | null = null
  ) {
    const normalizedInputDate = nextNavigation === "input" ? nextInputDate : null;
    const normalizedInputPreset = nextNavigation === "input" ? nextInputPreset : null;

    setInputInitialDate(normalizedInputDate);
    setInputPreset(normalizedInputPreset);

    if (
      !isSameHistoryDestination(
        window.history.state as AppHistoryState | null,
        nextNavigation,
        normalizedInputDate,
        normalizedInputPreset
      )
    ) {
      window.history.pushState(
        createHistoryState(nextNavigation, normalizedInputDate, normalizedInputPreset),
        ""
      );
    }

    setActiveNavigation(nextNavigation);
    scrollToPageTop();

    /*
     * 앱 시작 프리페치가 아직 진행 중이면 같은 요청을 재사용하므로
     * 중복 네트워크 요청은 생기지 않습니다. 실패하면 각 화면에서 다시 요청합니다.
     */
    if (nextNavigation === "settings") {
      void prefetchManagedSettings().catch(() => {});
    }

    if (nextNavigation === "input") {
      void prefetchBootstrap().catch(() => {});
    }
  }

  return {
    activeNavigation,
    inputInitialDate,
    inputPreset,
    setActiveNavigation,
    setInputInitialDate,
    setInputPreset,
    goHome,
    navigateTo
  };
}

/**
 * 로그인된 동안 브라우저 history와 화면을 맞춥니다.
 * - 뒤로가기/앞으로가기(popstate)로 화면 복원
 * - PWA 바로가기(?shortcut=...)로 연 경우 해당 화면으로 이동
 * - 화면이 바뀌면 맨 위로 스크롤
 */
export function useNavigationHistorySync(
  status: string,
  user: User | null,
  navigation: AppNavigation
) {
  const { activeNavigation, setActiveNavigation, setInputInitialDate, setInputPreset } = navigation;
  const shortcutHandledRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      return;
    }

    // 앱을 새로 연 시점에는 화면도 home으로 시작하므로 history 항목도 home과 맞춰 둡니다.
    window.history.replaceState(createHistoryState("home"), "");

    function handlePopState(event: PopStateEvent) {
      const state = event.state as AppHistoryState | null;
      const nextNavigation = isPrimaryNavigation(state?.navigation) ? state.navigation : "home";

      setInputInitialDate(nextNavigation === "input" ? (state?.inputInitialDate ?? null) : null);
      setInputPreset(nextNavigation === "input" ? (state?.inputPreset ?? null) : null);
      setActiveNavigation(nextNavigation);
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [status, user]);

  useEffect(() => {
    if (status !== "authenticated" || !user || shortcutHandledRef.current) {
      return;
    }

    const shortcut = parseAppShortcut(window.location.search);
    if (!shortcut) {
      return;
    }

    shortcutHandledRef.current = true;

    const preset: InputLaunchPreset | null =
      shortcut.navigation === "input" ? { mode: shortcut.mode } : null;

    setInputInitialDate(null);
    setInputPreset(preset);
    setActiveNavigation(shortcut.navigation);

    window.history.replaceState(
      createHistoryState(shortcut.navigation, null, preset),
      "",
      window.location.pathname
    );

    if (shortcut.navigation === "input") {
      void prefetchBootstrap().catch(() => {});
    }
  }, [status, user]);

  useEffect(() => {
    if (status === "authenticated") {
      scrollToPageTop();
    }
  }, [activeNavigation, status]);
}
