import { useEffect, useState } from "react";
import { clearPersistedBootstrapSnapshot } from "../../api/bootstrapPersistence";

import { getSession, login } from "../../api/auth";
import { clearBootstrapMemoryCache } from "../../api/bootstrapCache";
import { ApiError } from "../../api/client";
import { clearDashboardPersistentSnapshot, invalidateDashboardCache } from "../../api/dashboard";
import { clearInvestmentPrefetchCache } from "../../api/investments";
import { clearManagedSettingsCache } from "../../api/settingsManagement";
import type { User } from "../../types/api";
import { subscribeAuthExpired } from "../../utils/authEvents";
import { prefetchSecondaryPages } from "../pages";
import { readLastAuthenticatedUser, saveLastAuthenticatedUser } from "../lastAuthenticatedUser";
import {
  hideLaunchSplashNow,
  hideSplashAfterPaint,
  showLaunchSplash,
  waitForMinimumSplash
} from "../splash";
import { scheduleSecondaryWarm, warmPrimaryData } from "../warmup";

export type AppStatus = "checking" | "authenticated" | "guest";

/**
 * 로그인 상태를 관리합니다.
 * - 앱 시작 시 세션 확인(오프라인이면 마지막 로그인 사용자로 계속 사용)
 * - 로그인 처리와 첫 화면 데이터 준비, 스플래시 숨김
 * - 세션 만료 이벤트를 받으면 로그인 화면으로 전환
 *
 * onEnterApp: 로그인 완료·로그아웃 시 첫 화면(home)으로 돌리는 콜백
 */
export function useAuthSession(onEnterApp: () => void) {
  const [status, setStatus] = useState<AppStatus>("checking");
  const [user, setUser] = useState<User | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  function resetToGuest(message = "") {
    invalidateDashboardCache();
    clearDashboardPersistentSnapshot();
    clearPersistedBootstrapSnapshot();
    clearBootstrapMemoryCache();
    clearInvestmentPrefetchCache();
    clearManagedSettingsCache();

    saveLastAuthenticatedUser(null);
    setUser(null);
    setStatus("guest");
    onEnterApp();
    setLoginError(message);

    window.history.replaceState({}, "");
  }

  useEffect(
    () =>
      subscribeAuthExpired(() => {
        if (status !== "authenticated") {
          return;
        }

        resetToGuest("로그인 세션이 만료되었습니다. 다시 로그인해주세요.");
      }),
    [status]
  );

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const session = await getSession();
        if (cancelled) return;

        if (session.loggedIn && session.user) {
          await warmPrimaryData();
          if (cancelled) return;

          await waitForMinimumSplash();
          if (cancelled) return;

          saveLastAuthenticatedUser(session.user);
          setUser(session.user);
          setStatus("authenticated");
          onEnterApp();
          hideSplashAfterPaint();
          scheduleSecondaryWarm();
          return;
        }

        setUser(null);
        setStatus("guest");

        await waitForMinimumSplash();
        if (cancelled) return;

        hideSplashAfterPaint();
      } catch (error) {
        if (cancelled) return;

        const unauthorizedError = error instanceof ApiError && error.status === 401;

        // 네트워크 문제로 세션을 확인하지 못했으면 이 기기의 마지막 로그인 사용자로 계속 사용합니다.
        const offlineUser = unauthorizedError ? null : readLastAuthenticatedUser();

        if (offlineUser) {
          setUser(offlineUser);
          setStatus("authenticated");
          onEnterApp();
          setLoginError("");

          await waitForMinimumSplash();
          if (!cancelled) {
            hideSplashAfterPaint();
            prefetchSecondaryPages();
          }
          return;
        }

        if (unauthorizedError) {
          saveLastAuthenticatedUser(null);
        }

        setUser(null);
        setStatus("guest");
        setLoginError(
          unauthorizedError
            ? ""
            : error instanceof Error
              ? error.message
              : "로그인 상태를 확인하지 못했습니다."
        );

        await waitForMinimumSplash();
        if (cancelled) return;

        hideSplashAfterPaint();
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(name: string, password: string) {
    setLoginLoading(true);
    setLoginError("");

    try {
      const result = await login(name, password);

      showLaunchSplash();
      clearBootstrapMemoryCache();

      await warmPrimaryData();
      await waitForMinimumSplash();

      saveLastAuthenticatedUser(result.user);
      setUser(result.user);
      setStatus("authenticated");
      onEnterApp();
      hideSplashAfterPaint();
      scheduleSecondaryWarm();
    } catch (error) {
      hideLaunchSplashNow();
      setLoginError(error instanceof Error ? error.message : "로그인에 실패했습니다.");
    } finally {
      setLoginLoading(false);
    }
  }

  return { status, user, loginLoading, loginError, handleLogin };
}
