/**
 * 화면 테마(라이트/다크) 설정
 *
 * - "system"이면 기기 설정을 따르고, <html>에 data-theme을 두지 않습니다.
 * - 첫 화면이 깜빡이지 않도록 index.html의 인라인 스크립트도 같은 저장 키를 읽습니다.
 */

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "moneybook.theme";

const THEME_COLORS = { light: "#f8f7f6", dark: "#171615" } as const;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): "light" | "dark" {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

/** <html data-theme>과 브라우저 상단 색(theme-color)을 현재 설정에 맞춥니다. */
export function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement;

  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }

  const color = THEME_COLORS[resolveTheme(preference, systemPrefersDark())];
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.setAttribute("content", color);
  });
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    /* 저장이 막힌 환경에서도 이번 화면에는 적용합니다. */
  }

  applyThemePreference(preference);
}

/** 앱 시작 시 한 번 호출합니다. 기기 테마가 바뀌면 상단 색도 따라 바꿉니다. */
export function initTheme() {
  applyThemePreference(readThemePreference());

  if (typeof window.matchMedia !== "function") return;

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readThemePreference() === "system") applyThemePreference("system");
  });
}
