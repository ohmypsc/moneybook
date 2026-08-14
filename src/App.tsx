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

import type {
  User
} from "./types/api";

import LoginPage
  from "./pages/LoginPage/LoginPage";

import HomePage
  from "./pages/HomePage/HomePage";

import InputPage
  from "./pages/InputPage/InputPage";

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
    useState<NavigationKey>(
      "home"
    );


  useEffect(
    () => {
      let cancelled =
        false;


      async function restoreSession() {
        try {
          const sessionUser =
            await getSession();


          if (
            cancelled
          ) {
            return;
          }


          setUser(
            sessionUser
          );

          setStatus(
            "authenticated"
          );

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
            error.status === 401
          ) {
            setLoginError(
              ""
            );

            return;
          }


          setLoginError(
            error instanceof Error
              ? error.message
              : "로그인 상태를 확인하지 못했습니다."
          );
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
    name: string
  ) {
    setLoginLoading(
      true
    );

    setLoginError(
      ""
    );


    try {
      const nextUser =
        await login(
          name
        );


      setUser(
        nextUser
      );

      setStatus(
        "authenticated"
      );

      setActiveNavigation(
        "home"
      );

    } catch (
      error
    ) {
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
    status === "guest" ||
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
            거래 내역
          </h1>

          <p>
            거래 내역 화면은 다음 단계에서 연결합니다.
          </p>
        </section>
      </main>
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
            자산
          </h1>

          <p>
            자산 화면은 다음 단계에서 연결합니다.
          </p>
        </section>
      </main>
    );

  } else {
    pageContent = (
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
            설정
          </h1>

          <p>
            설정 화면은 다음 단계에서 연결합니다.
          </p>
        </section>
      </main>
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
