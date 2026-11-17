/*
 * index.html의 #launch-splash(앱 시작 화면) 제어.
 * 너무 빨리 깜빡이지 않도록 최소 표시 시간을 지킵니다.
 */

type SplashWindow = Window & {
  __moneybookSplashStartedAt?: number;
};

const SPLASH_MINIMUM_MS = 250;

export function wait(milliseconds: number) {
  return new Promise<void>(resolve => {
    window.setTimeout(resolve, milliseconds);
  });
}

function getSplashElement() {
  return document.getElementById("launch-splash");
}

export function showLaunchSplash() {
  const splash = getSplashElement();
  if (!splash) {
    return;
  }

  (window as SplashWindow).__moneybookSplashStartedAt = Date.now();
  splash.classList.remove("is-hidden");
}

export function hideLaunchSplashNow() {
  const splash = getSplashElement();
  if (!splash) {
    return;
  }

  splash.classList.add("is-hidden");
}

export async function waitForMinimumSplash() {
  const startedAt =
    (window as SplashWindow).__moneybookSplashStartedAt ?? Date.now();
  const remaining = SPLASH_MINIMUM_MS - (Date.now() - startedAt);

  if (remaining > 0) {
    await wait(remaining);
  }
}

/** 첫 화면이 실제로 그려진 다음 프레임에 스플래시를 숨깁니다. */
export function hideSplashAfterPaint() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      hideLaunchSplashNow();
    });
  });
}
