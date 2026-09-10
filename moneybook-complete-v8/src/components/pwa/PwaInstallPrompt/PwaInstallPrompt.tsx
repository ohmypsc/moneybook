import {
  useEffect,
  useState
} from "react";

import {
  getPwaInstallState,
  requestPwaInstall,
  subscribePwaInstall
} from "../../../utils/pwaInstall";

import type {
  PwaInstallState
} from "../../../utils/pwaInstall";

import styles
  from "./PwaInstallPrompt.module.css";


export default function PwaInstallPrompt() {
  const [
    installState,
    setInstallState
  ] = useState<PwaInstallState>(
    () => getPwaInstallState()
  );

  const [
    installing,
    setInstalling
  ] = useState(false);

  const [
    showInstructions,
    setShowInstructions
  ] = useState(false);

  useEffect(
    () =>
      subscribePwaInstall(
        setInstallState
      ),
    []
  );

  if (installState.installed) {
    return null;
  }

  async function handleInstall() {
    if (installing) return;

    if (
      installState.iosSafari ||
      !installState.nativeAvailable
    ) {
      setShowInstructions(
        value => !value
      );
      return;
    }

    setInstalling(true);

    try {
      const result =
        await requestPwaInstall();

      if (result === "unavailable") {
        setShowInstructions(true);
      }
    } finally {
      setInstalling(false);
    }
  }

  const buttonLabel =
    installing
      ? "설치 중..."
      : installState.nativeAvailable
        ? "홈 화면에 설치"
        : showInstructions
          ? "설치 방법 닫기"
          : "설치 방법 보기";

  return (
    <section
      className={styles.panel}
      aria-labelledby="pwa-install-title"
    >
      <div className={styles.headingRow}>
        <div
          className={styles.icon}
          aria-hidden="true"
        >
          ♡
        </div>

        <div className={styles.content}>
          <strong
            id="pwa-install-title"
            className={styles.title}
          >
            홈 화면에 설치
          </strong>

          <p className={styles.message}>
            우리 가계부를 휴대폰에서 앱처럼 바로 열 수 있습니다.
          </p>
        </div>
      </div>

      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => void handleInstall()}
        disabled={installing}
      >
        {buttonLabel}
      </button>

      {showInstructions && (
        <div
          className={styles.instructions}
          aria-live="polite"
        >
          {installState.iosSafari ? (
            <>
              <strong>iPhone / iPad</strong>
              <span>
                Safari 아래쪽의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하세요.
              </span>
            </>
          ) : (
            <>
              <strong>설치 메뉴가 바로 뜨지 않을 때</strong>
              <span>
                브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요.
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
