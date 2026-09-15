import { apiRequest } from "./client";
import type { ApiEnvelope } from "./envelope";

export interface RealEstateTrade {
  date: string;
  amountKrw: number;
  floor: number | null;
  exclusiveAreaSqm: number;
}

export interface RealEstateAsset {
  propertyId: string;
  name: string;
  propertyType: "아파트";
  address: string;
  lawdCode: string;
  apartmentName: string;
  exclusiveAreaSqm: number;
  floor: number | null;
  owner: string;
  purchasePriceKrw: number;
  valuationMode: "auto" | "manual";
  manualValueKrw: number | null;
  estimatedValueKrw: number;
  currentValueKrw: number;
  estimateLowKrw: number;
  estimateHighKrw: number;
  estimateTradeCount: number;
  estimateUpdatedAt: string | null;
  lastTradeDate: string | null;
  recentTrades: RealEstateTrade[];
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string;
  updatedBy: string;
  isDeleted: boolean;
}

export interface RealEstateSummary {
  totalValueKrw: number;
  count: number;
  items: RealEstateAsset[];
}

export interface LegalRegionCandidate {
  lawdCode: string;
  name: string;
  fullCode: string;
}

export interface SaveRealEstateInput {
  propertyId?: string;
  name: string;
  address: string;
  lawdCode: string;
  apartmentName: string;
  exclusiveAreaSqm: number;
  floor?: number | null;
  owner?: string;
  purchasePriceKrw?: number;
  valuationMode: "auto" | "manual";
  manualValueKrw?: number | null;
}

function unwrap<T>(raw: ApiEnvelope<T>, fallback: string): T {
  if (!raw.success || raw.data === undefined) {
    throw new Error(raw.error?.message || fallback);
  }
  return raw.data;
}

export async function getRealEstateAssets() {
  return unwrap(
    await apiRequest<ApiEnvelope<RealEstateSummary>>("/api/real-estate"),
    "부동산 자산을 불러오지 못했습니다."
  );
}

export async function searchLegalRegions(query: string) {
  const params = new URLSearchParams({ q: query });
  return unwrap(
    await apiRequest<ApiEnvelope<{ items: LegalRegionCandidate[] }>>(`/api/real-estate/regions?${params}`),
    "주소의 지역코드를 찾지 못했습니다."
  ).items;
}

export async function saveRealEstateAsset(input: SaveRealEstateInput) {
  return unwrap(
    await apiRequest<ApiEnvelope<{ created: boolean; item: RealEstateAsset }>>(
      "/api/real-estate/save",
      { method: "POST", body: JSON.stringify(input), timeoutMs: 60_000 }
    ),
    "부동산 자산을 저장하지 못했습니다."
  );
}

export async function deleteRealEstateAsset(propertyId: string) {
  return unwrap(
    await apiRequest<ApiEnvelope<{ deleted: boolean; propertyId: string }>>(
      "/api/real-estate/delete",
      { method: "POST", body: JSON.stringify({ propertyId }) }
    ),
    "부동산 자산을 삭제하지 못했습니다."
  );
}

export async function refreshRealEstateAsset(propertyId: string) {
  return unwrap(
    await apiRequest<ApiEnvelope<{ refreshed: true; item: RealEstateAsset }>>(
      "/api/real-estate/refresh",
      { method: "POST", body: JSON.stringify({ propertyId }), timeoutMs: 120_000 }
    ),
    "아파트 실거래 시세를 갱신하지 못했습니다."
  );
}
