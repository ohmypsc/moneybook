import {
  useEffect,
  useState
} from "react";

import type {
  ReactNode
} from "react";

import {
  getSession,
  login,
  logout
} from "./api/auth";

import {
  ApiError
} from "./api/client";

import {
  prefetchBootstrap
} from "./api/bootstrapCache";

import {
  getCurrentCalendarMonth,
  loadCalendarMonth
} from "./api/calendarCache";

import {
  getDashboard,
  invalidateDashboardCache
} from "./api/dashboard";

import {
  clearInvestmentPrefetchCache,
  prefetchInvestmentTrades
} from "./api/investments";

import type {
  User
} from "./types/api";

import LoginPage
  from "./pages/LoginPage/LoginPage";

import HomePage
  from "./pages/HomePage/HomePage";

import CalendarPage
  from "./pages/CalendarPage/CalendarPage";

import InputPage
  from "./pages/InputPage/InputPage";

import AssetsPage
  from "./pages/AssetsPage/AssetsPage";

import SettingsPage
  from "./pages/SettingsPage/SettingsPage";

import {
  AppShell
} from "./components/layout/AppShell/AppShell";

import type {
  NavigationKey
} from "./components/layout/BottomNav/BottomNav";

import styles
  from "./App.module.css";


type AppStatus =
  | "checking"
  | "authenticated"
  | "guest";


type SplashWindow =
  Window & {
    __moneybookSplashStartedAt?:
      number;
  };


const SPLASH_MINIMUM_MS =
  900;

const PRIMARY_WARM_TIMEOUT_MS =
  4500;

const SECONDARY_WARM_DELAY_MS =
  250;


function wait(
  milliseconds:
    number
) {
  return new Promise<void>(
    resolve => {
      window.setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}


function getSplashElement() {
  return document
    .getElementById(
      "launch-splash"
    );
}


function showLaunchSplash() {
  const splash =
    getSplashElement();


  if (!splash) {
    return;
  }


  (
    window as
      SplashWindow
  ).__moneybookSplashStartedAt =
    Date.now();


  splash.classList.remove(
    "is-hidden"
  );
}


function hideLaunchSplashNow() {
  const splash =
    getSplashElement();


  if (!splash) {
    return;
  }


  splash.classList.add(
    "is-hidden"
  );
}


async function waitForMinimumSplash() {
  const startedAt =
    (
      window as
        SplashWindow
    ).__moneybookSplashStartedAt ??
    Date.now();


  const elapsed =
    Date.now() -
    startedAt;


  const remaining =
    SPLASH_MINIMUM_MS -
    elapsed;


  if (
    remaining >
    0
  ) {
    await wait(
      remaining
    );
  }
}


function hideSplashAfterPaint() {
  window.requestAnimationFrame(
    () => {
      window.requestAnimationFrame(
        () => {
          hideLaunchSplashNow();
        }
      );
    }
  );
}


/*
 * 스플래시가 보이는 동안
 * 첫 진입에 가장 중요한 세 가지를 준비합니다.
 *
 * 1. dashboard
 *    - 홈
 *    - 현금성 자산
 *    - 투자계좌
 *    - 보유종목
 *    - 예수금
 *    을 한 번의 Apps Script dashboard 요청으로 준비합니다.
 *
 * 2. 이번 달 달력 거래
 *
 * 3. 입력용 bootstrap
 *
 * 같은 dashboard 응답은 브라우저 공용 캐시에 저장되어
 * HomePage와 AssetsPage가 다시 서버에서 받을 필요가 없습니다.
 */
async function warmPrimaryData() {
  const dashboardRequest =
    getDashboard();


  const calendarRequest =
    loadCalendarMonth(
      getCurrentCalendarMonth()
    );


  /*
   * 입력 화면용 데이터도 동시에 준비합니다.
   * bootstrap이 늦어져도 홈 진입은 막지 않습니다.
   */
  void prefetchBootstrap()
    .catch(
      () => {
        /*
         * 입력 화면에서 필요할 때
         * 다시 요청할 수 있습니다.
         */
      }
    );


  await Promise.race([
    Promise.allSettled([
      dashboardRequest,
      calendarRequest
    ]),

    wait(
      PRIMARY_WARM_TIMEOUT_MS
    )
  ]);
}


/*
 * 홈이 실제로 뜬 뒤에는
 * dashboard에 포함되지 않는 투자 매매내역을
 * 전체 1회만 조용히 받아둡니다.
 *
 * 이후 특정 투자계좌를 펼치면
 * 프런트에서 accountId 기준으로 필터링합니다.
 */
function scheduleSecondaryWarm() {
  window.setTimeout(
    () => {
      void prefetchInvestmentTrades()
        .catch(
          () => {
            /*
             * 실패해도 자산 화면에서
             * 필요할 때 다시 요청합니다.
             */
          }
        );
    },
    SECONDARY_WARM_DELAY_MS
  );
}


export default function App() {
  const [
    status,
    setStatus
  ] =
    useState<AppStatus>(
      "checking"
    );


  const [
    user,
    setUser
  ] =
    useState<
      User |
      null
    >(
      null
    );


  const [
    loginLoading,
    setLoginLoading
  ] =
    useState(
      false
    );


  const [
    loginError,
    setLoginError
  ] =
    useState(
      ""
    );


  const [
    activeNavigation,
    setActiveNavigation
  ] =
    useState<
      NavigationKey
    >(
      "home"
    );


  useEffect(
    () => {
      let cancelled =
        false;


      async function restoreSession() {
        try {
          const session =
            await getSession();


          if (
            cancelled
          ) {
            return;
          }


          if (
            session.loggedIn &&
            session.user
          ) {
            await warmPrimaryData();


            if (
              cancelled
            ) {
              return;
            }


            await waitForMinimumSplash();


            if (
              cancelled
            ) {
              return;
            }


            setUser(
              session.user
            );


            setStatus(
              "authenticated"
            );


            setActiveNavigation(
              "home"
            );


            hideSplashAfterPaint();


            scheduleSecondaryWarm();


            return;
          }


          setUser(
            null
          );


          setStatus(
            "guest"
          );


          await waitForMinimumSplash();


          if (
            cancelled
          ) {
            return;
          }


          hideSplashAfterPaint();

        } catch (
          error
        ) {
          if (
            cancelled
          ) {
            return;
          }


          setUser(
            null
          );


          setStatus(
            "guest"
          );


          if (
            error instanceof
              ApiError &&
            error.status ===
              401
          ) {
            setLoginError(
              ""
            );

          } else {
            setLoginError(
              error instanceof
                Error
                ? error.message
                : "로그인 상태를 확인하지 못했습니다."
            );
          }


          await waitForMinimumSplash();


          if (
            cancelled
          ) {
            return;
          }


          hideSplashAfterPaint();
        }
      }


      void restoreSession();


      return () => {
        cancelled =
          true;
      };
    },
    []
  );


  async function handleLogin(
    name:
      string,

    password:
      string
  ) {
    setLoginLoading(
      true
    );


    setLoginError(
      ""
    );


    try {
      const result =
        await login(
          name,
          password
        );


      showLaunchSplash();


      await warmPrimaryData();


      await waitForMinimumSplash();


      setUser(
        result.user
      );


      setStatus(
        "authenticated"
      );


      setActiveNavigation(
        "home"
      );


      hideSplashAfterPaint();


      scheduleSecondaryWarm();

    } catch (
      error
    ) {
      hideLaunchSplashNow();


      setLoginError(
        error instanceof
          Error
          ? error.message
          : "로그인에 실패했습니다."
      );

    } finally {
      setLoginLoading(
        false
      );
    }
  }


  async function handleLogout() {
    try {
      await logout();

    } finally {
      invalidateDashboardCache();
      clearInvestmentPrefetchCache();


      setUser(
        null
      );


      setStatus(
        "guest"
      );


      setActiveNavigation(
        "home"
      );


      setLoginError(
        ""
      );
    }
  }


  if (
    status ===
    "checking"
  ) {
    return (
      <main
        className={
          styles.center
        }
      >
        <section
          className={
            styles.panel
          }
        >
          <h1>
            우리 가계부
          </h1>

          <p>
            로그인 상태를 확인하고 있습니다.
          </p>
        </section>
      </main>
    );
  }


  if (
    status ===
      "guest" ||
    !user
  ) {
    return (
      <LoginPage
        loading={
          loginLoading
        }
        errorMessage={
          loginError
        }
        onLogin={
          handleLogin
        }
      />
    );
  }


  let pageContent:
    ReactNode;


  if (
    activeNavigation ===
    "home"
  ) {
    pageContent = (
      <HomePage
        user={
          user
        }
        onLogout={
          handleLogout
        }
      />
    );

  } else if (
    activeNavigation ===
    "calendar"
  ) {
    pageContent = (
      <CalendarPage />
    );

  } else if (
    activeNavigation ===
    "input"
  ) {
    pageContent = (
      <InputPage />
    );

  } else if (
    activeNavigation ===
    "assets"
  ) {
    pageContent = (
      <AssetsPage />
    );

  } else {
    pageContent = (
      <SettingsPage />
    );
  }


  return (
    <AppShell
      activeNavigation={
        activeNavigation
      }
      onNavigate={
        setActiveNavigation
      }
    >
      {pageContent}
    </AppShell>
  );
}
