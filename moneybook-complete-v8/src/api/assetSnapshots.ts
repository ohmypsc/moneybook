import {
  apiRequest
} from "./client";

import {
  unwrapEnvelope
} from "./envelope";

import type {
  ApiEnvelope
} from "./envelope";

export interface AssetSnapshot {
  month: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  investmentValue: number;
  cashLikeValue: number;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string;
  updatedBy: string;
  row: number;
}

interface AssetSnapshotList {
  total: number;
  items: AssetSnapshot[];
}

interface SaveAssetSnapshotResult {
  saved: boolean;
  updated: boolean;
  snapshot: AssetSnapshot | null;
}

export async function getAssetSnapshots(
  options: {
    month?: string;
    limit?: number;
  } = {}
) {
  const params = new URLSearchParams();

  if (options.month) {
    params.set("month", options.month);
  }

  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  const raw = await apiRequest<
    ApiEnvelope<AssetSnapshotList> | AssetSnapshotList
  >(
    query
      ? `/api/asset-snapshots?${query}`
      : "/api/asset-snapshots"
  );

  return unwrapEnvelope<AssetSnapshotList>(raw);
}

export async function saveAssetSnapshot(month: string) {
  const raw = await apiRequest<
    ApiEnvelope<SaveAssetSnapshotResult> | SaveAssetSnapshotResult
  >(
    "/api/asset-snapshots",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ month })
    }
  );

  return unwrapEnvelope<SaveAssetSnapshotResult>(raw);
}
