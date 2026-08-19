import { apiRequest } from "./client";
import type { DashboardData } from "../types/dashboard";
import { unwrapEnvelope } from "./envelope";
import type { ApiEnvelope } from "./envelope";

export async function getDashboard(month?: string) {
  const query = month
    ? `?month=${encodeURIComponent(month)}`
    : "";

  const raw = await apiRequest<
    ApiEnvelope<DashboardData> | DashboardData
  >(`/api/dashboard${query}`);

  return unwrapEnvelope<DashboardData>(raw);
}
