import {
  estimateApartmentValue,
  getRealEstateCurrentValue,
  parseApartmentTradeXml
} from "./domain/realEstate.js";

const REGION_API = "https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList";
const TRADE_API = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";

function cleanText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function positiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function id() {
  return `RE_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function ensureRealEstateSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS real_estate_assets (
      property_id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      property_type TEXT NOT NULL DEFAULT '아파트',
      address TEXT,
      lawd_code TEXT,
      apartment_name TEXT,
      exclusive_area_sqm REAL,
      floor INTEGER,
      owner_label TEXT,
      purchase_price_krw REAL,
      valuation_mode TEXT NOT NULL DEFAULT 'auto',
      manual_value_krw REAL,
      estimated_value_krw REAL,
      estimate_low_krw REAL,
      estimate_high_krw REAL,
      estimate_trade_count INTEGER NOT NULL DEFAULT 0,
      estimate_updated_at TEXT,
      last_trade_date TEXT,
      recent_trades_json TEXT,
      created_at TEXT,
      updated_at TEXT,
      created_by TEXT,
      updated_by TEXT,
      deleted_at TEXT,
      deleted_by TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_real_estate_household ON real_estate_assets(household_id, deleted_at)")
  ]);
}

function mapRow(row) {
  let recentTrades = [];
  try {
    const parsed = JSON.parse(row?.recent_trades_json || "[]");
    if (Array.isArray(parsed)) recentTrades = parsed;
  } catch {
    recentTrades = [];
  }
  const item = {
    propertyId: cleanText(row?.property_id, 120),
    name: cleanText(row?.name),
    propertyType: cleanText(row?.property_type) || "아파트",
    address: cleanText(row?.address, 300),
    lawdCode: cleanText(row?.lawd_code, 10),
    apartmentName: cleanText(row?.apartment_name),
    exclusiveAreaSqm: Number(row?.exclusive_area_sqm || 0),
    floor: row?.floor === null || row?.floor === undefined ? null : Number(row.floor),
    owner: cleanText(row?.owner_label, 80),
    purchasePriceKrw: Number(row?.purchase_price_krw || 0),
    valuationMode: row?.valuation_mode === "manual" ? "manual" : "auto",
    manualValueKrw: row?.manual_value_krw === null || row?.manual_value_krw === undefined ? null : Number(row.manual_value_krw),
    estimatedValueKrw: Number(row?.estimated_value_krw || 0),
    estimateLowKrw: Number(row?.estimate_low_krw || 0),
    estimateHighKrw: Number(row?.estimate_high_krw || 0),
    estimateTradeCount: Number(row?.estimate_trade_count || 0),
    estimateUpdatedAt: row?.estimate_updated_at || null,
    lastTradeDate: row?.last_trade_date || null,
    recentTrades,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    createdBy: cleanText(row?.created_by, 80),
    updatedBy: cleanText(row?.updated_by, 80),
    deletedAt: row?.deleted_at || null,
    deletedBy: cleanText(row?.deleted_by, 80),
    isDeleted: Boolean(row?.deleted_at)
  };
  return { ...item, currentValueKrw: getRealEstateCurrentValue(item) };
}

export async function listRealEstateAssets(env, householdId, includeDeleted = false) {
  await ensureRealEstateSchema(env);
  const result = await env.DB.prepare(
    `SELECT * FROM real_estate_assets WHERE household_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"} ORDER BY created_at, property_id`
  ).bind(householdId).all();
  return (result.results || []).map(mapRow);
}

export async function saveRealEstateAsset(env, householdId, input, actor, now) {
  await ensureRealEstateSchema(env);
  const propertyId = cleanText(input?.propertyId, 120) || id();
  const existing = await env.DB.prepare("SELECT property_id FROM real_estate_assets WHERE household_id=? AND property_id=? LIMIT 1")
    .bind(householdId, propertyId).first();
  const name = cleanText(input?.name || input?.apartmentName);
  const address = cleanText(input?.address, 300);
  const apartmentName = cleanText(input?.apartmentName || name);
  const exclusiveAreaSqm = positiveNumber(input?.exclusiveAreaSqm);
  const floor = nullableNumber(input?.floor);
  const lawdCode = cleanText(input?.lawdCode, 5);
  const owner = cleanText(input?.owner, 80);
  const purchasePriceKrw = Math.round(positiveNumber(input?.purchasePriceKrw));
  const valuationMode = input?.valuationMode === "manual" ? "manual" : "auto";
  const manualValueKrw = valuationMode === "manual" ? Math.round(positiveNumber(input?.manualValueKrw)) : nullableNumber(input?.manualValueKrw);
  if (!name || !apartmentName) throw Object.assign(new Error("아파트 이름을 입력해주세요."), { code: "REAL_ESTATE_NAME_REQUIRED" });
  if (!address) throw Object.assign(new Error("지역을 입력해주세요."), { code: "REAL_ESTATE_ADDRESS_REQUIRED" });
  if (valuationMode === "auto" && !/^\d{5}$/.test(lawdCode)) throw Object.assign(new Error("자동 시세를 사용하려면 국토부 지역코드 5자리를 입력해주세요."), { code: "REAL_ESTATE_LAWD_REQUIRED" });
  if (!exclusiveAreaSqm) throw Object.assign(new Error("전용면적을 입력해주세요."), { code: "REAL_ESTATE_AREA_REQUIRED" });
  if (valuationMode === "manual" && !manualValueKrw) throw Object.assign(new Error("수동 평가액을 입력해주세요."), { code: "REAL_ESTATE_MANUAL_VALUE_REQUIRED" });

  await env.DB.prepare(`INSERT INTO real_estate_assets (
      property_id,household_id,name,property_type,address,lawd_code,apartment_name,exclusive_area_sqm,floor,owner_label,purchase_price_krw,
      valuation_mode,manual_value_krw,estimated_value_krw,estimate_low_krw,estimate_high_krw,estimate_trade_count,estimate_updated_at,last_trade_date,recent_trades_json,
      created_at,updated_at,created_by,updated_by,deleted_at,deleted_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(property_id) DO UPDATE SET
      name=excluded.name,address=excluded.address,lawd_code=excluded.lawd_code,apartment_name=excluded.apartment_name,
      exclusive_area_sqm=excluded.exclusive_area_sqm,floor=excluded.floor,owner_label=excluded.owner_label,purchase_price_krw=excluded.purchase_price_krw,
      valuation_mode=excluded.valuation_mode,manual_value_krw=excluded.manual_value_krw,updated_at=excluded.updated_at,updated_by=excluded.updated_by,
      deleted_at=NULL,deleted_by=NULL`)
    .bind(
      propertyId, householdId, name, "아파트", address, lawdCode, apartmentName, exclusiveAreaSqm, floor, owner, purchasePriceKrw,
      valuationMode, manualValueKrw, 0, 0, 0, 0, null, null, "[]",
      now, now, actor, actor, null, null
    ).run();
  const row = await env.DB.prepare("SELECT * FROM real_estate_assets WHERE household_id=? AND property_id=?").bind(householdId, propertyId).first();
  return { created: !existing, item: mapRow(row) };
}

export async function deleteRealEstateAsset(env, householdId, propertyId, actor, now) {
  await ensureRealEstateSchema(env);
  const result = await env.DB.prepare("UPDATE real_estate_assets SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=? WHERE household_id=? AND property_id=? AND deleted_at IS NULL")
    .bind(now, actor, now, actor, householdId, propertyId).run();
  return { deleted: Number(result.meta?.changes || 0) > 0, propertyId };
}

function getDataServiceKey(env) {
  return cleanText(env.DATA_GO_KR_SERVICE_KEY || env.MOLIT_API_KEY, 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeServiceKeyOnce(value) {
  const key = cleanText(value, 1000);
  if (!key) return "";
  // Encoding 키를 저장한 경우에는 %를 다시 인코딩하지 않고 그대로 사용한다.
  // Decoding 키를 저장한 경우에는 여기서 정확히 한 번 URL encode 한다.
  return /%[0-9a-f]{2}/i.test(key) ? key : encodeURIComponent(key);
}

function xmlValue(text, name) {
  const match = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, "i").exec(String(text || ""));
  return cleanText(match?.[1], 300);
}

function compactResponseText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function dataGoErrorDetails(text, httpStatus) {
  const authMessage = xmlValue(text, "returnAuthMsg");
  const reasonCode = xmlValue(text, "returnReasonCode");
  const resultMessage = xmlValue(text, "resultMsg");
  const resultCode = xmlValue(text, "resultCode");
  const errMessage = xmlValue(text, "errMsg");
  const message = authMessage || resultMessage || errMessage || compactResponseText(text);
  const code = reasonCode || resultCode || "";
  const looksLikeError = Boolean(
    httpStatus >= 400 ||
    authMessage ||
    errMessage ||
    (resultCode && !["0", "00", "000"].includes(resultCode)) ||
    /SERVICE[_ ]?KEY|PERMISSION[_ ]?DENIED|ACCESS[_ ]?DENIED|LIMITED[_ ]?NUMBER|BLACKLIST[_ ]?IP|UNREGISTERED[_ ]?IP|DEADLINE[_ ]?HAS[_ ]?EXPIRED|APPLICATION[_ ]?ERROR/i.test(String(text || ""))
  );
  return { looksLikeError, code, message };
}

function describeDataGoError(details, status, ymd) {
  const code = details.code ? ` / 코드 ${details.code}` : "";
  const message = details.message ? `: ${details.message}` : "";
  return `국토부 실거래가 API 오류 [${ymd}] (HTTP ${status}${code})${message}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) {
    const details = dataGoErrorDetails(text, response.status);
    throw new Error(`공공데이터 API 응답 오류 (HTTP ${response.status})${details.message ? `: ${details.message}` : ""}`);
  }
  return JSON.parse(text);
}

export async function resolveLegalRegion(env, query) {
  const key = getDataServiceKey(env);
  if (!key) throw Object.assign(new Error("공공데이터포털 서비스키가 설정되어 있지 않습니다."), { code: "DATA_GO_KR_KEY_MISSING" });
  const clean = cleanText(query, 200);
  if (!clean) return [];
  const tokens = clean.split(/\s+/).filter(Boolean);
  const searches = [clean, tokens.slice(0, 3).join(" "), tokens.slice(0, 2).join(" ")].filter((value, index, array) => value && array.indexOf(value) === index);
  for (const search of searches) {
    const params = new URLSearchParams({
      type: "json",
      pageNo: "1",
      numOfRows: "20",
      flag: "Y",
      locatadd_nm: search
    });
    const url = `${REGION_API}?serviceKey=${encodeServiceKeyOnce(key)}&${params.toString()}`;
    const payload = await fetchJson(url);
    const rows = payload?.StanReginCd?.[1]?.row || [];
    const mapped = rows
      .map((row) => ({
        lawdCode: cleanText(row.region_cd, 10).slice(0, 5),
        name: cleanText(row.locatadd_nm, 200),
        fullCode: cleanText(row.region_cd, 10)
      }))
      .filter((row) => /^\d{5}$/.test(row.lawdCode) && row.name);
    if (mapped.length) {
      const unique = [];
      const seen = new Set();
      for (const item of mapped) {
        const keyValue = `${item.lawdCode}|${item.name}`;
        if (!seen.has(keyValue)) {
          seen.add(keyValue);
          unique.push(item);
        }
      }
      return unique.slice(0, 12);
    }
  }
  return [];
}

function monthKeys(today, count = 12) {
  const [year, month] = String(today).slice(0, 7).split("-").map(Number);
  const items = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    items.push(`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return items;
}

async function fetchTradesForMonth(key, lawdCode, ymd, attempt = 0) {
  const params = new URLSearchParams({
    LAWD_CD: lawdCode,
    DEAL_YMD: ymd,
    pageNo: "1",
    numOfRows: "999"
  });
  const url = `${TRADE_API}?serviceKey=${encodeServiceKeyOnce(key)}&${params.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8"
    }
  });
  // HTTP 오류일 때도 본문을 먼저 읽어 공공데이터포털의 실제 오류코드를 보존한다.
  const text = await response.text();
  const details = dataGoErrorDetails(text, response.status);
  if (details.looksLikeError) {
    // 오류코드 23: 초당 호출량 제한. 짧게 기다렸다가 최대 두 번 자동 재시도한다.
    const perSecondLimited = details.code === "23" || /PER_SECOND/i.test(details.message);
    if (perSecondLimited && attempt < 2) {
      await sleep(800 * (attempt + 1));
      return fetchTradesForMonth(key, lawdCode, ymd, attempt + 1);
    }
    const error = new Error(describeDataGoError(details, response.status, ymd));
    error.code = details.code === "23" ? "DATA_GO_KR_RATE_LIMIT" : "DATA_GO_KR_REQUEST_FAILED";
    throw error;
  }
  return parseApartmentTradeXml(text);
}

export async function refreshRealEstateAsset(env, householdId, propertyId, actor, now, today) {
  await ensureRealEstateSchema(env);
  const row = await env.DB.prepare("SELECT * FROM real_estate_assets WHERE household_id=? AND property_id=? AND deleted_at IS NULL LIMIT 1")
    .bind(householdId, propertyId).first();
  if (!row) throw Object.assign(new Error("부동산 자산을 찾을 수 없습니다."), { code: "REAL_ESTATE_NOT_FOUND" });
  const asset = mapRow(row);
  const key = getDataServiceKey(env);
  if (!key) throw Object.assign(new Error("공공데이터포털 서비스키가 설정되어 있지 않습니다."), { code: "DATA_GO_KR_KEY_MISSING" });

  const allTrades = [];
  const months = monthKeys(today, 12);
  let estimate = estimateApartmentValue(allTrades, asset);
  for (let index = 0; index < months.length; index += 1) {
    // 개발계정의 초당 호출 제한을 피하기 위해 연속 호출 사이에 짧은 간격을 둔다.
    if (index > 0) await sleep(350);
    allTrades.push(...await fetchTradesForMonth(key, asset.lawdCode, months[index]));
    estimate = estimateApartmentValue(allTrades, asset);
    // 최근 거래가 충분하면 불필요하게 12개월 전체를 조회하지 않는다.
    if (estimate.tradeCount >= 5 && index >= 2) break;
  }
  await env.DB.prepare(`UPDATE real_estate_assets SET estimated_value_krw=?,estimate_low_krw=?,estimate_high_krw=?,estimate_trade_count=?,estimate_updated_at=?,last_trade_date=?,recent_trades_json=?,updated_at=?,updated_by=? WHERE household_id=? AND property_id=?`)
    .bind(
      estimate.estimatedValueKrw,
      estimate.lowKrw,
      estimate.highKrw,
      estimate.tradeCount,
      now,
      estimate.lastTradeDate,
      JSON.stringify(estimate.recentTrades),
      now,
      actor,
      householdId,
      propertyId
    ).run();
  const updated = await env.DB.prepare("SELECT * FROM real_estate_assets WHERE household_id=? AND property_id=?").bind(householdId, propertyId).first();
  return mapRow(updated);
}

export async function refreshAllRealEstateAssets(env, householdId, actor, now, today) {
  if (!getDataServiceKey(env)) return [];
  const items = await listRealEstateAssets(env, householdId, false);
  const refreshed = [];
  for (const item of items) {
    if (item.valuationMode !== "auto") continue;
    try {
      refreshed.push(await refreshRealEstateAsset(env, householdId, item.propertyId, actor, now, today));
    } catch (error) {
      console.error("real estate refresh failed", item.propertyId, error instanceof Error ? error.message : error);
    }
  }
  return refreshed;
}

export function realEstateSummary(items) {
  const active = (items || []).filter((item) => !item.isDeleted);
  return {
    totalValueKrw: active.reduce((sum, item) => sum + getRealEstateCurrentValue(item), 0),
    count: active.length,
    items: active
  };
}
