import type { User } from "../types/api";

/*
 * 마지막으로 로그인한 사용자를 이 기기에 기억합니다.
 * 오프라인으로 앱을 열어 세션 확인이 실패해도 바로 사용할 수 있게 합니다.
 */
const LAST_AUTHENTICATED_USER_KEY = "moneybook:last-authenticated-user:v1";

export function readLastAuthenticatedUser(): User | null {
  try {
    const raw = window.localStorage.getItem(LAST_AUTHENTICATED_USER_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<User>;
    return typeof parsed.name === "string" && parsed.name ? { name: parsed.name } : null;
  } catch {
    return null;
  }
}

export function saveLastAuthenticatedUser(user: User | null) {
  try {
    if (user) {
      window.localStorage.setItem(LAST_AUTHENTICATED_USER_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(LAST_AUTHENTICATED_USER_KEY);
    }
  } catch {
    /* 저장소 사용 불가 환경에서는 세션만 사용합니다. */
  }
}
