export function normalizeApartmentName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/아파트/g, "")
    .replace(/[^0-9a-z가-힣]/g, "")
    .slice(0, 120);
}

export function parseKrwTenThousands(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 10000) : 0;
}

function parseNumber(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function xmlTag(block, names) {
  for (const name of names) {
    const re = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i");
    const match = re.exec(block);
    if (match) return xmlDecode(match[1].trim());
  }
  return "";
}

export function parseApartmentTradeXml(xml) {
  const text = String(xml || "");
  const rows = [];
  for (const match of text.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const year = xmlTag(block, ["dealYear", "년"]);
    const month = xmlTag(block, ["dealMonth", "월"]);
    const day = xmlTag(block, ["dealDay", "일"]);
    const amountKrw = parseKrwTenThousands(xmlTag(block, ["dealAmount", "거래금액"]));
    const area = parseNumber(xmlTag(block, ["excluUseAr", "전용면적"]));
    const floor = parseNumber(xmlTag(block, ["floor", "층"]));
    const canceledAt = xmlTag(block, ["cdealDay", "해제사유발생일"]);
    const apartmentName = xmlTag(block, ["aptNm", "아파트"]);
    if (!year || !month || !day || !amountKrw || !area || !apartmentName) continue;
    rows.push({
      apartmentName,
      normalizedName: normalizeApartmentName(apartmentName),
      date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      amountKrw,
      exclusiveAreaSqm: area,
      floor,
      canceled: Boolean(canceledAt),
      legalDong: xmlTag(block, ["umdNm", "법정동"]),
      jibun: xmlTag(block, ["jibun", "지번"])
    });
  }
  return rows;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function estimateApartmentValue(trades, asset) {
  const targetName = normalizeApartmentName(asset?.apartmentName || asset?.name);
  const area = Number(asset?.exclusiveAreaSqm || 0);
  const floor = Number(asset?.floor || 0);
  const same = (trades || [])
    .filter((trade) => !trade.canceled)
    .filter((trade) => {
      if (!targetName || !trade.normalizedName) return false;
      if (!(trade.normalizedName === targetName || trade.normalizedName.includes(targetName) || targetName.includes(trade.normalizedName))) return false;
      return Math.abs(Number(trade.exclusiveAreaSqm || 0) - area) <= 0.6;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const floorMatched = floor
    ? same.filter((trade) => trade.floor !== null && Math.abs(Number(trade.floor) - floor) <= 5)
    : [];
  const chosen = (floorMatched.length >= 3 ? floorMatched : same).slice(0, 12);
  if (!chosen.length) {
    return {
      estimatedValueKrw: 0,
      lowKrw: 0,
      highKrw: 0,
      tradeCount: 0,
      lastTradeDate: null,
      recentTrades: []
    };
  }
  const amounts = chosen.map((trade) => trade.amountKrw).filter((value) => value > 0);
  return {
    estimatedValueKrw: median(amounts),
    lowKrw: Math.min(...amounts),
    highKrw: Math.max(...amounts),
    tradeCount: chosen.length,
    lastTradeDate: chosen[0]?.date || null,
    recentTrades: chosen.map((trade) => ({
      date: trade.date,
      amountKrw: trade.amountKrw,
      floor: trade.floor,
      exclusiveAreaSqm: trade.exclusiveAreaSqm
    }))
  };
}

export function getRealEstateCurrentValue(asset) {
  if (asset?.valuationMode === "manual" && Number(asset?.manualValueKrw) > 0) {
    return Number(asset.manualValueKrw);
  }
  return Math.max(0, Number(asset?.estimatedValueKrw || 0));
}
