// 부동산 자산 API 래퍼
import { deleteRealEstateAsset, listRealEstateAssets, realEstateSummary, refreshRealEstateAsset, saveRealEstateAsset } from "../realEstate.js";
import { MB_D1_HOUSEHOLD_ID, mbD1CurrentDateSeoul, mbD1Fail, mbD1InsertChange, mbD1Now, mbD1Text } from "./core.js";

export async function mbD1GetRealEstateData(env) {
  const items = await listRealEstateAssets(env, MB_D1_HOUSEHOLD_ID, false);
  return realEstateSummary(items);
}

export async function mbD1SaveRealEstate(body, session, env) {
  let result;
  try {
    result = await saveRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, body, session.name, mbD1Now());
  } catch (error) {
    mbD1Fail(error?.code || "REAL_ESTATE_SAVE_FAILED", error instanceof Error ? error.message : "부동산 자산을 저장하지 못했습니다.");
  }
  const change = await mbD1InsertChange(env, "real_estate", result.item.propertyId, result.created ? "created" : "updated", null, session, {
    name: result.item.name,
    currentValueKrw: result.item.currentValueKrw
  });
  await env.DB.batch([change]);
  return result;
}

export async function mbD1DeleteRealEstate(body, session, env) {
  const propertyId = mbD1Text(body.propertyId);
  if (!propertyId) mbD1Fail("REAL_ESTATE_ID_REQUIRED", "부동산 자산 ID가 필요합니다.");
  const result = await deleteRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, propertyId, session.name, mbD1Now());
  const change = await mbD1InsertChange(env, "real_estate", propertyId, "deleted", null, session, {});
  await env.DB.batch([change]);
  return result;
}

export async function mbD1RefreshRealEstate(body, session, env) {
  const propertyId = mbD1Text(body.propertyId);
  if (!propertyId) mbD1Fail("REAL_ESTATE_ID_REQUIRED", "부동산 자산 ID가 필요합니다.");
  let item;
  try {
    item = await refreshRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, propertyId, session.name, mbD1Now(), mbD1CurrentDateSeoul());
  } catch (error) {
    mbD1Fail(error?.code || "REAL_ESTATE_REFRESH_FAILED", error instanceof Error ? error.message : "아파트 실거래 시세를 갱신하지 못했습니다.", 400);
  }
  try {
    const change = await mbD1InsertChange(env, "real_estate", propertyId, "updated", null, session, {
      refresh: true,
      estimatedValueKrw: item.estimatedValueKrw,
      tradeCount: item.estimateTradeCount
    });
    await env.DB.batch([change]);
  } catch (error) {
    console.error("real estate refresh change-log failed", propertyId, error);
    mbD1Fail(
      "REAL_ESTATE_CHANGE_LOG_FAILED",
      error instanceof Error
        ? `시세는 갱신됐지만 변경 이력 저장에 실패했습니다: ${error.message}`
        : "시세는 갱신됐지만 변경 이력 저장에 실패했습니다.",
      500
    );
  }
  return { refreshed: true, item };
}
