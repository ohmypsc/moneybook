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


function wait(
  milliseconds: number
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
    window as SplashWindow
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
      window as SplashWindow
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
 * 앱 시작 화면이 떠 있는 동안
 * 실제로 자주 사용하는 데이터를 준비합니다.
 *
 * - 홈 대시보드
 * - 이번 달 달력 거래
 * - 입력 화면 bootstrap
 *
 * bootstrap은 같이 시작하지만
 * 홈/달력 진입을 막지는 않습니다.
 */
async function warmPrimaryData() {
  const dashboardRequest =
    fetch(
      "/api/dashboard",
      {
        method: "GET",

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
          if (
            !response.ok
          ) {
            throw new Error(
              "홈 데이터를 준비하지 못했습니다."
            );
          }

          /*
           * 응답 본문까지 소비해서
           * Worker 쪽 대시보드 준비를
           * 완전히 끝냅니다.
           */
          await response.json();
        }
      );


  const calendarRequest =
    loadCalendarMonth(
      getCurrentCalendarMonth()
    );


  /*
   * 입력 화면 데이터도 동시에 준비하되
   * 이것 때문에 스플래시가 오래 유지되지는
   * 않도록 기다리는 대상에서는 제외합니다.
   */
  void prefetchBootstrap()
    .catch(
      () => {
        /*
         * 입력 화면에서 필요할 때
         * 다시 요청할 수 있으므로
         * 앱 시작 자체는 막지 않습니다.
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
    useState<User | null>(
      null
    );


  const [
    loginLoading,
    setLoginLoading
  ] =
    useState(false);


  const [
    loginError,
    setLoginError
  ] =
    useState("");


  const [
    activeNavigation,
    setActiveNavigation
  ] =
    useState<NavigationKey>(
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
            /*
             * 사진이 떠 있는 동안
             * 홈과 이번 달 달력을
             * 미리 준비합니다.
             */
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


            /*
             * 실제 홈이 한 번 그려진 다음
             * 사진이 자연스럽게 사라집니다.
             */
            hideSplashAfterPaint();

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
            error instanceof ApiError &&
            error.status ===
              401
          ) {
            setLoginError(
              ""
            );

          } else {
            setLoginError(
              error instanceof Error
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
    name: string,
    password: string
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


      /*
       * 비밀번호가 맞은 경우에만
       * 사진 화면을 다시 보여줍니다.
       */
      showLaunchSplash();


      /*
       * 사진을 보는 동안
       * 홈/달력 데이터를 준비합니다.
       */
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

    } catch (
      error
    ) {
      /*
       * 로그인 오류가 난 경우
       * 사진 화면이 남아 있지 않도록 합니다.
       */
      hideLaunchSplashNow();


      setLoginError(
        error instanceof Error
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


  /*
   * 실제로는 index.html의 사진 스플래시가
   * 이 화면 위를 덮고 있습니다.
   *
   * 혹시 정적 스플래시를 지원하지 않는 환경에서도
   * 기존 checking 화면이 안전망으로 남습니다.
   */
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
      {
        pageContent
      }
    </AppShell>
  );
}
