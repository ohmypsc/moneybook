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
  getBootstrap
} from "./api/ledger";

import {
  ApiError
} from "./api/client";

import type {
  BootstrapData,
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
    bootstrap,
    setBootstrap
  ] =
    useState<
      BootstrapData | null
    >(
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

          const bootstrapResponse =
            await getBootstrap();


          if (cancelled) {
            return;
          }


          setUser(
            session.user
          );

          setBootstrap(
            bootstrapResponse.data
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

      const bootstrapResponse =
        await getBootstrap();


      setUser(
        loginResponse.user
      );

      setBootstrap(
        bootstrapResponse.data
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

      setBootstrap(
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
            가계부를 불러오는
            중입니다.
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
    !user ||
    !bootstrap
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

        bootstrap={
          bootstrap
        }

        onLogout={
          handleLogout
        }
      />
    );

  } else if (
    activeNavigation ===
      "transactions"
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
            거래 내역
          </h1>

          <p>
            거래 내역 화면을
            준비하고 있습니다.
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
            자산 현황 화면을
            준비하고 있습니다.
          </p>
        </section>
      </div>
    );

  } else if (
    activeNavigation ===
      "investments"
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
            투자
          </h1>

          <p>
            투자 현황 화면을
            준비하고 있습니다.
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
            가계부 설정 화면을
            준비하고 있습니다.
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
