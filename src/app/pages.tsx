import { createElement, lazy, useState } from "react";
import type { ComponentType } from "react";

/*
 * 홈을 뺀 화면은 처음 앱을 열 때 내려받지 않고, 필요할 때 따로 받습니다.
 * 홈이 뜬 직후 prefetchSecondaryPages()로 미리 받아 둡니다.
 *
 * React.lazy는 이미 받은 코드여도 처음 그릴 때 한 번 Suspense 대기(React 19는 최소 약 300ms)를
 * 거칩니다. 미리 받아 둔 화면은 이 대기 없이 바로 그리도록 받은 컴포넌트를 직접 사용합니다.
 */
function lazyPage<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;

  function preload() {
    pending ??= load().then(
      module => {
        loaded = module.default;
      },
      error => {
        pending = null;
        throw error;
      }
    );
    return pending;
  }

  const LazyComponent = lazy(() => preload().then(() => ({ default: loaded! })));

  function Page(props: P) {
    // 화면이 떠 있는 동안 컴포넌트 종류가 바뀌면 React가 화면을 새로 만들어 입력 중인 내용이 사라집니다.
    // 그래서 처음 그릴 때 고른 것(이미 받았으면 실제 화면, 아니면 lazy)을 계속 씁니다.
    const [Component] = useState<ComponentType<P>>(() => loaded ?? LazyComponent);
    return createElement(Component, props);
  }

  return Object.assign(Page, { preload });
}

export const HistoryPage = lazyPage(() => import("../pages/HistoryPage/HistoryPage"));
export const InputPage = lazyPage(() => import("../pages/InputPage/InputPage"));
export const AssetsPage = lazyPage(() => import("../pages/AssetsPage/AssetsPage"));
export const SettingsPage = lazyPage(() => import("../pages/SettingsPage/SettingsPage"));

/** 다른 화면 코드를 백그라운드에서 미리 받아 둡니다. 실패해도 탭을 열 때 다시 받습니다. */
export function prefetchSecondaryPages() {
  for (const page of [InputPage, HistoryPage, AssetsPage, SettingsPage]) {
    void page.preload().catch(() => {});
  }
}
