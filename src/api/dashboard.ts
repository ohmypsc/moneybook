import {
  apiRequest
} from "./client";

import type {
  DashboardResponse
} from "../types/dashboard";


export async function getDashboard(
  month?: string
): Promise<DashboardResponse> {

  const params =
    new URLSearchParams();

  if (month) {
    params.set(
      "month",
      month
    );
  }


  const query =
    params.toString();

  const url =
    query
      ? `/api/dashboard?${query}`
      : "/api/dashboard";


  return apiRequest<DashboardResponse>(
    url
  );
}
