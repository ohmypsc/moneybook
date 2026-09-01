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
  primeDashboardPrefetch
} from "./api/dashboard";

import {
  prefetchInvestmentTradesForAccounts
} from "./api/investments";

import type {
  User
} from "./types/api";

import type {
  DashboardData
} from "./types/dashboard";

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


interface DashboardResponse {
  success: boolean;

  apiVersion?:
    string;

  data?:
    DashboardData;

  error?: {
    code?:
      string;

    message?:
      string;
  };
}


const SPLASH_MINIMUM_MS =
  900;

const PRIMARY_WARM_TIMEOUT_MS =
  4500;

const SECONDARY_WARM_DELAY_MS =
  180;


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


function getInvestmentAccountIds(
  dashboard:
    DashboardData |
    null
) {
  if (
    !dashboard ||
    !dashboard.investments ||
    !Array.isArray(
      dashboard
        .investments
        .accounts
    )
  ) {
    return [];
  }


  return dashboard
    .investments
    .accounts
    .map(
      account =>
        account.accountId
    )
    .filter(
      (
        accountId
      ): accountId is string =>
        typeof accountId ===
          "string" &&
        accountId.length >
          0
    );
}


/*
 * 홈이 화면에 표시된 뒤
 * 투자계좌별 매매내역을 조용히 준비합니다.
 *
 * 자산 요약/투자계좌/보유종목/예수금은
 * 이미 dashboard 응답 안에 들어 있으므로
 * 별도 중복 요청을 하지 않습니다.
 */
function scheduleSecondaryWarm(
  dashboard:
    DashboardData |
    null
) {
  if (
    !dashboard
  ) {
    return;
  }


  const accountIds =
    getInvestmentAccountIds(
      dashboard
    );


  if (
    accountIds.length ===
    0
  ) {
    return;
  }


  window.setTimeout(
    () => {
      void prefetchInvestmentTradesForAccounts(
        accountIds
      );
    },
    SECONDARY_WARM_DELAY_MS
  );
}


/*
 * 앱 시작 화면이 떠 있는 동안
 * 가장 먼저 필요한 데이터를 준비합니다.
 *
 * 1. 홈 대시보드
 *    - 여기에는 자산/부채
 *    - 투자계좌
 *    - 보유종목
 *    - 예수금
 *      정보까지 들어 있습니다.
 *
 * 2. 이번 달 달력
 *
 * 3. 입력용 bootstrap
 *
 * 투자 매매내역은 홈이 뜬 직후
 * 2차 백그라운드 로딩으로 이어집니다.
 */
async function warmPrimaryData():
  Promise<
    DashboardData |
    null
  > {
  let dashboardData:
    DashboardData |
    null =
      null;


  const dashboardRequest =
    fetch(
      "/api/dashboard",
      {
        method:
          "GET",

        credentials:
          "same-origin",

        headers: {
          Accept:
            "application/json"
        }
      }
    )
      .then(
        async response => {
          let body:
            DashboardResponse;


          try {
            body =
              await response.json() as
                DashboardResponse;

          } catch {
            throw new Error(
              "홈 데이터를 읽지 못했습니다."
            );
          }


          if (
            !response.ok ||
            body.success !==
              true ||
            !body.data
          ) {
            throw new Error(
              body.error
                ?.message ||
              "홈 데이터를 준비하지 못했습니다."
            );
          }


          dashboardData =
            body.data;


          /*
           * AssetsPage가 처음 열릴 때
           * 서버를 다시 기다리지 않도록
           * 같은 응답을 한 번 사용할 수 있게
           * 넘겨둡니다.
           */
          primeDashboardPrefetch(
            body.data
          );


          return body.data;
        }
      );


  const calendarRequest =
    loadCalendarMonth(
      getCurrentCalendarMonth()
    );


  /*
   * 입력 화면용 데이터도
   * 같은 시점에 준비합니다.
   *
   * 이것 때문에 홈 진입이
   * 늦어지지는 않게 합니다.
   */
  void prefetchBootstrap()
    .catch(
      () => {
        /*
         * 실패해도 입력 화면에서
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


  return dashboardData;
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
            const warmDashboard =
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


            /*
             * 홈이 뜨고 난 뒤
             * 투자 매매내역까지
             * 2차로 준비합니다.
             */
            scheduleSecondaryWarm(
              warmDashboard
            );


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


      const warmDashboard =
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


      scheduleSecondaryWarm(
        warmDashboard
      );

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
