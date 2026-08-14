import {
  type ComponentType,
  useCallback,
  useEffect,
  useState
} from "react";

import HomePage from "./pages/HomePage/HomePage";
import InputPage from "./pages/InputPage/InputPage";
import LoginPage from "./pages/LoginPage/LoginPage";

import styles from "./App.module.css";


type AppPage =
  | "home"
  | "input";


interface SessionUser {
  name: string;
}


interface SessionResponse {
  success?: boolean;

  loggedIn?: boolean;

  user?: {
    name?: string;
  };

  error?: {
    code?: string;
    message?: string;
  };
}


type AppStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";


interface LoginPageBridgeProps {
  onLogin?: () => void;
  onLoggedIn?: () => void;
  onLoginSuccess?: () => void;
}


const LoginPageView =
  LoginPage as unknown as
    ComponentType<LoginPageBridgeProps>;


export default function App() {
  const [
    status,
    setStatus
  ] =
    useState<AppStatus>(
      "loading"
    );


  const [
    user,
    setUser
  ] =
    useState<SessionUser | null>(
      null
    );


  const [
    page,
    setPage
  ] =
    useState<AppPage>(
      "home"
    );


  const [
    errorMessage,
    setErrorMessage
  ] =
    useState("");


  const loadSession =
    useCallback(
      async () => {
        setStatus(
          "loading"
        );

        setErrorMessage(
          ""
        );


        try {
          const response =
            await fetch(
              "/api/auth/session",
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
            );


          if (
            response.status ===
            401
          ) {
            setUser(
              null
            );

            setStatus(
              "unauthenticated"
            );

            return;
          }


          let data:
            SessionResponse;


          try {
            data =
              await response
                .json() as
                SessionResponse;

          } catch {
            throw new Error(
              "로그인 상태 응답을 읽지 못했습니다."
            );
          }


          if (
            response.ok &&
            data.loggedIn ===
              true &&
            data.user?.name
          ) {
            setUser({
              name:
                data.user.name
            });

            setStatus(
              "authenticated"
            );

            return;
          }


          if (
            response.ok &&
            data.loggedIn !==
              true
          ) {
            setUser(
              null
            );

            setStatus(
              "unauthenticated"
            );

            return;
          }


          throw new Error(
            data.error?.message ||
            "로그인 상태를 확인하지 못했습니다."
          );

        } catch (
          error
        ) {
          setUser(
            null
          );

          setStatus(
            "error"
          );

          setErrorMessage(
            error instanceof Error
              ? error.message
              : "로그인 상태를 확인하지 못했습니다."
          );
        }
      },
      []
    );


  useEffect(
    () => {
      void loadSession();
    },
    [
      loadSession
    ]
  );


  function handleLoginSuccess() {
    void loadSession();
  }


  function openInput() {
    setPage(
      "input"
    );

    window.scrollTo({
      top: 0,
      behavior: "auto"
    });
  }


  function openHome() {
    setPage(
      "home"
    );

    window.scrollTo({
      top: 0,
      behavior: "auto"
    });
  }


  if (
    status ===
    "loading"
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
          <p
            className={
              styles.loadingLabel
            }
          >
            우리 가계부
          </p>

          <h1>
            불러오는 중
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
    "error"
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
          <p
            className={
              styles.loadingLabel
            }
          >
            우리 가계부
          </p>

          <h1>
            연결을 확인해주세요
          </h1>

          <p
            className={
              styles.error
            }
          >
            {
              errorMessage
            }
          </p>

          <button
            type="button"
            className={
              styles.retry
            }
            onClick={
              () =>
                void loadSession()
            }
          >
            다시 시도
          </button>
        </section>
      </main>
    );
  }


  if (
    status ===
    "unauthenticated"
  ) {
    return (
      <LoginPageView
        onLogin={
          handleLoginSuccess
        }
        onLoggedIn={
          handleLoginSuccess
        }
        onLoginSuccess={
          handleLoginSuccess
        }
      />
    );
  }


  if (
    page ===
    "input"
  ) {
    return (
      <div
        className={
          styles.inputShell
        }
      >
        <div
          className={
            styles.inputToolbar
          }
        >
          <div
            className={
              styles.inputToolbarInner
            }
          >
            <button
              type="button"
              className={
                styles.backButton
              }
              onClick={
                openHome
              }
            >
              <span
                aria-hidden="true"
              >
                ←
              </span>

              홈
            </button>
          </div>
        </div>

        <InputPage />
      </div>
    );
  }


  return (
    <div
      className={
        styles.homeShell
      }
    >
      <HomePage />


      <div
        className={
          styles.homeActionBar
        }
      >
        <div
          className={
            styles.homeActionInner
          }
        >
          <button
            type="button"
            className={
              styles.openInputButton
            }
            onClick={
              openInput
            }
            aria-label={
              `${user?.name ?? ""} 거래 입력`
            }
          >
            <span
              className={
                styles.openInputIcon
              }
              aria-hidden="true"
            >
              +
            </span>

            <span>
              거래 입력
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
