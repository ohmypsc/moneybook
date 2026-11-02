import { apiRequest } from "./client";
import type { ApiEnvelope } from "./envelope";

export interface PushConfig {
  publicKey: string;
  myDeviceCount: number;
}

function unwrap<T>(raw: ApiEnvelope<T>, fallback: string): T {
  if (!raw.success || raw.data === undefined) {
    throw new Error(raw.error?.message || fallback);
  }
  return raw.data;
}

export async function getPushConfig() {
  return unwrap(
    await apiRequest<ApiEnvelope<PushConfig>>("/api/push/config"),
    "알림 설정을 불러오지 못했습니다."
  );
}

export async function registerPushSubscription(subscription: PushSubscriptionJSON) {
  return unwrap(
    await apiRequest<ApiEnvelope<{ subscribed: true }>>(
      "/api/push/subscribe",
      { method: "POST", body: JSON.stringify({ subscription }) }
    ),
    "알림을 켜지 못했습니다."
  );
}

export async function unregisterPushSubscription(endpoint: string) {
  return unwrap(
    await apiRequest<ApiEnvelope<{ unsubscribed: true }>>(
      "/api/push/unsubscribe",
      { method: "POST", body: JSON.stringify({ endpoint }) }
    ),
    "알림을 끄지 못했습니다."
  );
}

export async function requestTestPush() {
  return unwrap(
    await apiRequest<ApiEnvelope<{ sent: number; failed: number; removed: number }>>(
      "/api/push/test",
      { method: "POST", body: "{}" }
    ),
    "테스트 알림을 보내지 못했습니다."
  );
}
