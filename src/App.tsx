import {
  useEffect,
  useState
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
  | "loggedOut"
  | "loading"
  | "ready"
  | "error";


function App() {

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
    errorMessage,
    setErrorMessage
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


      async function start() {

        try {

          const session =
            await getSession();


          if (cancelled) {
            return;
          }


          setUser(
            session.user
          );

          setActiveNavigation(
            "home"
          );

          setStatus(
            "ready"
          );

        } catch (error) {

          if (cancelled) {
            return;
          }


          if (
            error instanceof
              ApiError &&
            error.status === 401
          ) {
            setStatus(
              "loggedOut"
            );

            return;
          }


          setErrorMessage(
            error instanceof Error
              ? error.message
              : "가계부를 불러오지 못했습니다."
          );

          setStatus(
            "error"
          );
        }
      }


      void start();


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

    setStatus(
      "loading"
    );

    setErrorMessage(
      ""
    );


    try {

      const loginResponse =
        await login(
          name,
          password
        );


      setUser(
        loginResponse.user
      );

      setActiveNavigation(
        "home"
      );

      setStatus(
        "ready"
      );

    } catch (error) {

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "로그인하지 못했습니다."
      );

      setStatus(
        "loggedOut"
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

      setActiveNavigation(
        "home"
      );

      setErrorMessage(
        ""
      );

      setStatus(
        "loggedOut"
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
            로그인 상태를
            확인하는 중입니다.
          </p>
        </section>
      </main>
    );
  }


  if (
    status ===
      "loggedOut" ||
    status ===
      "loading"
  ) {
    return (
      <LoginPage
        loading={
          status ===
            "loading"
        }

        errorMessage={
          errorMessage
        }

        onLogin={
          handleLogin
        }
      />
    );
  }


  if (
    status ===
      "error" ||
    !user
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

          <p
            className={
              styles.error
            }
          >
            {
              errorMessage ||
              "가계부를 불러오지 못했습니다."
            }
          </p>

          <button
            type="button"

            className={
              styles.retry
            }

            onClick={
              () =>
                window
                  .location
                  .reload()
            }
          >
            다시 시도
          </button>
        </section>
      </main>
    );
  }


  let pageContent;


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
      <div
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
            달력
          </h1>

          <p>
            날짜별 수입과 지출을
            한눈에 볼 수 있는
            월간 달력을 만들 예정입니다.
          </p>
        </section>
      </div>
    );

  } else if (
    activeNavigation ===
      "input"
  ) {

    pageContent = (
      <div
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
            거래 입력
          </h1>

          <p>
            지출을 기본으로
            수입 및 이체를 빠르게
            입력할 수 있는 화면을
            만들 예정입니다.
          </p>
        </section>
      </div>
    );

  } else if (
    activeNavigation ===
      "assets"
  ) {

    pageContent = (
      <div
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
            계좌와 투자자산 및 부채를
            한곳에서 확인하는 화면을
            만들 예정입니다.
          </p>
        </section>
      </div>
    );

  } else {

    pageContent = (
      <div
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
            계좌와 카테고리 및
            가계부 설정을 관리하는
            화면을 만들 예정입니다.
          </p>
        </section>
      </div>
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


export default App;
