import {
  getPushConfig,
  registerPushSubscription,
  unregisterPushSubscription
} from "../api/push";

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: "ios-not-installed" | "unsupported" | "dev" };

function isIos() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function getPushSupport(): PushSupport {
  if (!import.meta.env.PROD) {
    return { supported: false, reason: "dev" };
  }

  // 아이폰은 '홈 화면에 추가'한 앱(iOS 16.4 이상)에서만 웹 알림을 받을 수 있습니다.
  if (isIos() && !isStandalone()) {
    return { supported: false, reason: "ios-not-installed" };
  }

  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return { supported: false, reason: "unsupported" };
  }

  return { supported: true };
}

function base64UrlToUint8Array(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

// 서비스 워커 등록이 실패한 기기에서는 ready가 끝나지 않으므로 시간제한을 둡니다.
async function getRegistration(timeoutMs = 5000) {
  let timer: number | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("앱 준비가 끝나지 않았어요. 앱을 완전히 닫았다가 다시 열어 주세요.")),
          timeoutMs
        );
      })
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getCurrentPushSubscription() {
  if (!getPushSupport().supported) return null;
  const registration = await getRegistration();
  return registration.pushManager.getSubscription();
}

/**
 * 이 기기에서 배우자 입력 알림을 켭니다. 반드시 버튼을 누른 직후에 호출해야
 * 브라우저가 알림 권한을 물어볼 수 있습니다.
 */
export async function enablePushOnThisDevice() {
  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "알림이 차단되어 있습니다. 휴대폰 설정에서 이 앱의 알림을 허용해주세요."
        : "알림 권한을 허용해야 켤 수 있습니다."
    );
  }

  const { publicKey } = await getPushConfig();
  const registration = await getRegistration();
  const applicationServerKey = base64UrlToUint8Array(publicKey);

  let subscription = await registration.pushManager.getSubscription();

  // 서버 키가 바뀐 예전 구독이면 새로 만듭니다.
  const currentKey = subscription?.options?.applicationServerKey;
  if (subscription && currentKey) {
    const existing = new Uint8Array(currentKey);
    const same = existing.length === applicationServerKey.length &&
      existing.every((byte, index) => byte === applicationServerKey[index]);
    if (!same) {
      await subscription.unsubscribe().catch(() => undefined);
      subscription = null;
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
  }

  await registerPushSubscription(subscription.toJSON());
  return subscription;
}

export async function disablePushOnThisDevice() {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) return;

  try {
    await unregisterPushSubscription(subscription.endpoint);
  } finally {
    await subscription.unsubscribe().catch(() => undefined);
  }
}
