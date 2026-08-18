import { apiRequest } from "./client";
import type { DashboardData } from "../types/dashboard";

export function getDashboard(month?: string) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";

  return apiRequest<DashboardData>(`/api/dashboard${query}`);
}
