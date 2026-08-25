import {
  apiRequest
} from "./client";

import type {
  DashboardData
} from "../types/dashboard";

import {
  unwrapEnvelope
} from "./envelope";

import type {
  ApiEnvelope
} from "./envelope";


export async function getDashboard(
  month?: string
) {
  const searchParams =
    new URLSearchParams();

  if (month) {
    searchParams.set(
      "month",
      month
    );
  }

  /*
   * 거래 저장 직후 홈으로 돌아왔을 때
   * 브라우저나 중간 캐시가 이전 대시보드 응답을
   * 재사용하지 않도록 요청마다 값을 바꿉니다.
   *
   * Worker는 _ts를 사용하지 않으므로
   * Apps Script의 기존 dashboard 로직에는
   * 아무 영향이 없습니다.
   */
  searchParams.set(
    "_ts",
    String(
      Date.now()
    )
  );

  const raw =
    await apiRequest<
      | ApiEnvelope<
          DashboardData
        >
      | DashboardData
    >(
      `/api/dashboard?${searchParams.toString()}`,
      {
        cache:
          "no-store"
      }
    );

  return unwrapEnvelope<
    DashboardData
  >(
    raw
  );
}
