import {
  type ComponentType,
  useCallback,
  useEffect,
  useState
} from "react";

import LoginPage from "./pages/LoginPage/LoginPage";
import InputPage from "./pages/InputPage/InputPage";

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


/*
 * 기존 LoginPage의 인증 로직은 그대로 사용합니다.
 *
 * 이전 대화 백업에 LoginPage.tsx의 최신 props 원문이
 * 남아 있지 않으므로 App이 특정 callback 이름 하나에
 * 강하게 의존하지 않도록 연결부만 얇게 둡니다.
 *
 * 실제 로그인 성공 뒤에는 어떤 callback을 사용하든
 * /api/auth/session을 다시 조회해서 상태를 확정합니다.
 */
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


          /*
           * 세션이 없는 경우
           * Worker가 401을 반환하더라도
           * 오류 화면이 아니라 로그인 화면으로 갑니다.
           */
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


          /*
           * 정상 응답이지만 로그인되지 않은 상태
           */
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
    /*
     * 로그인 성공 여부는
     * 브라우저 상태를 추측하지 않고
     * Worker 세션을 다시 조회하여 확정합니다.
     */
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


  /*
   * 최초 세션 확인
   */
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


  /*
   * 세션 확인 중 실제 오류가 발생한 경우
   */
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


  /*
   * 로그인되지 않은 경우
   *
   * 기존 LoginPage를 그대로 사용합니다.
   */
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


  /*
   * 거래 입력 화면
   */
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


  /*
   * 로그인 후 기본 홈
   *
   * 기존 HomePage는 인증/bootstrap 연결 확인용
   * 임시 화면이었기 때문에 이번 단계부터
   * App의 실제 진입 화면을 사용합니다.
   *
   * 향후 대시보드가 완성되면 이 부분을
   * 정식 HomePage로 분리합니다.
   */
  return (
    <div
      className={
        styles.appShell
      }
    >
      <main
        className={
          styles.home
        }
      >
        <header
          className={
            styles.homeHeader
          }
        >
          <div>
            <p
              className={
                styles.eyebrow
              }
            >
              우리 가계부
            </p>

            <h1>
              {
                user?.name
              }
              님, 안녕하세요.
            </h1>
          </div>
        </header>


        <section
          className={
            styles.heroCard
          }
        >
          <p
            className={
              styles.cardLabel
            }
          >
            빠른 기록
          </p>

          <h2>
            오늘의 거래를
            기록해볼까요?
          </h2>

          <p
            className={
              styles.cardDescription
            }
          >
            지출과 수입,
            계좌 이동 및 카드대금을
            한 곳에서 기록할 수 있습니다.
          </p>


          <div
            className={
              styles.typeChips
            }
            aria-label="입력 가능한 거래"
          >
            <span>
              지출
            </span>

            <span>
              수입
            </span>

            <span>
              이체
            </span>
          </div>


          <button
            type="button"
            className={
              styles.inputButton
            }
            onClick={
              openInput
            }
          >
            <span
              className={
                styles.inputButtonIcon
              }
              aria-hidden="true"
            >
              +
            </span>

            거래 입력
          </button>
        </section>


        <section
          className={
            styles.guideCard
          }
        >
          <p
            className={
              styles.guideTitle
            }
          >
            카드대금도 쉽게
          </p>

          <p
            className={
              styles.guideText
            }
          >
            거래 입력 화면에서
            카드값 결제와 카드 선결제를
            별도 버튼으로 선택할 수 있습니다.
          </p>
        </section>
      </main>
    </div>
  );
}
