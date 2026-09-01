import {
  useEffect,
  useState
} from "react";

import styles
  from "./PwaInstallPrompt.module.css";


type InstallMode =
  | "hidden"
  | "native"
  | "ios";


type InstallChoice = {
  outcome:
    | "accepted"
    | "dismissed";

  platform: string;
};


interface BeforeInstallPromptEvent
  extends Event {
  prompt:
    () => Promise<void>;

  userChoice:
    Promise<InstallChoice>;
}


const DISMISSED_AT_KEY =
  "moneybook:pwa-install-dismissed-at";

const DISMISS_FOR_MS =
  7 *
  24 *
  60 *
  60 *
  1000;


function isStandalone() {
  const displayModeStandalone =
    window.matchMedia(
      "(display-mode: standalone)"
    ).matches;


  const navigatorStandalone =
    Boolean(
      (
        navigator as
          Navigator & {
            standalone?: boolean;
          }
      ).standalone
    );


  return (
    displayModeStandalone ||
    navigatorStandalone
  );
}


function isIosSafariInstallCandidate() {
  const userAgent =
    navigator.userAgent;


  const isIos =
    /iPad|iPhone|iPod/i.test(
      userAgent
    ) ||
    (
      navigator.platform ===
        "MacIntel" &&
      navigator.maxTouchPoints >
        1
    );


  if (!isIos) {
    return false;
  }


  const isWebKit =
    /WebKit/i.test(
      userAgent
    );


  const isOtherIosBrowser =
    /CriOS|FxiOS|EdgiOS|OPiOS/i.test(
      userAgent
    );


  return (
    isWebKit &&
    !isOtherIosBrowser
  );
}


function wasRecentlyDismissed() {
  try {
    const saved =
      window.localStorage.getItem(
        DISMISSED_AT_KEY
      );


    if (!saved) {
      return false;
    }


    const dismissedAt =
      Number(
        saved
      );


    if (
      !Number.isFinite(
        dismissedAt
      )
    ) {
      return false;
    }


    return (
      Date.now() -
        dismissedAt <
      DISMISS_FOR_MS
    );

  } catch {
    return false;
  }
}


function rememberDismissed() {
  try {
    window.localStorage.setItem(
      DISMISSED_AT_KEY,
      String(
        Date.now()
      )
    );

  } catch {
    /*
     * 저장소 접근에 실패해도
     * 설치 기능 자체에는 영향이 없습니다.
     */
  }
}


export default function PwaInstallPrompt() {
  const [
    mode,
    setMode
  ] =
    useState<InstallMode>(
      "hidden"
    );


  const [
    deferredPrompt,
    setDeferredPrompt
  ] =
    useState<
      BeforeInstallPromptEvent |
      null
    >(
      null
    );


  const [
    installing,
    setInstalling
  ] =
    useState(
      false
    );


  useEffect(
    () => {
      if (
        isStandalone() ||
        wasRecentlyDismissed()
      ) {
        return;
      }


      function handleBeforeInstallPrompt(
        event: Event
      ) {
        event.preventDefault();


        setDeferredPrompt(
          event as
            BeforeInstallPromptEvent
        );


        setMode(
          "native"
        );
      }


      function handleAppInstalled() {
        setDeferredPrompt(
          null
        );


        setMode(
          "hidden"
        );


        try {
          window.localStorage.removeItem(
            DISMISSED_AT_KEY
          );

        } catch {
          /*
           * 저장소 접근 실패는
           * 무시합니다.
           */
        }
      }


      window.addEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );


      window.addEventListener(
        "appinstalled",
        handleAppInstalled
      );


      if (
        isIosSafariInstallCandidate()
      ) {
        setMode(
          "ios"
        );
      }


      return () => {
        window.removeEventListener(
          "beforeinstallprompt",
          handleBeforeInstallPrompt
        );


        window.removeEventListener(
          "appinstalled",
          handleAppInstalled
        );
      };
    },
    []
  );


  function handleDismiss() {
    rememberDismissed();


    setDeferredPrompt(
      null
    );


    setMode(
      "hidden"
    );
  }


  async function handleInstall() {
    if (
      !deferredPrompt ||
      installing
    ) {
      return;
    }


    setInstalling(
      true
    );


    try {
      await deferredPrompt.prompt();


      const choice =
        await deferredPrompt.userChoice;


      setDeferredPrompt(
        null
      );


      if (
        choice.outcome ===
        "dismissed"
      ) {
        rememberDismissed();
      }


      setMode(
        "hidden"
      );

    } finally {
      setInstalling(
        false
      );
    }
  }


  if (
    mode ===
    "hidden"
  ) {
    return null;
  }


  return (
    <aside
      className={
        styles.prompt
      }
      aria-live="polite"
    >
      <div
        className={
          styles.icon
        }
        aria-hidden="true"
      >
        ₩
      </div>

      <div
        className={
          styles.content
        }
      >
        <strong
          className={
            styles.title
          }
        >
          우리 가계부를 앱처럼 사용하기
        </strong>

        <p
          className={
            styles.message
          }
        >
          {
            mode ===
              "ios"
              ? "Safari의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하세요."
              : "홈 화면에 설치하면 주소창 없이 바로 열 수 있습니다."
          }
        </p>
      </div>

      <div
        className={
          styles.actions
        }
      >
        {
          mode ===
            "native" && (
            <button
              type="button"
              className={
                styles.primaryButton
              }
              onClick={
                () =>
                  void handleInstall()
              }
              disabled={
                installing
              }
            >
              {
                installing
                  ? "설치 중..."
                  : "설치"
              }
            </button>
          )
        }

        <button
          type="button"
          className={
            styles.secondaryButton
          }
          onClick={
            handleDismiss
          }
        >
          {
            mode ===
              "ios"
              ? "확인"
              : "나중에"
          }
        </button>
      </div>
    </aside>
  );
}
