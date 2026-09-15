const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function normalizeMerchant(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^0-9a-z가-힣]/g, "")
    .slice(0, 120);
}

export function normalizeCardLabel(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "")
    .replace(/카드$/g, "")
    .slice(0, 80);
}

function toPositiveAmount(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function normalizeTransactionTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (TIME_RE.test(text)) return text;

  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeImportedCandidate(raw, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const date = String(source.date || "").trim();
  const time = normalizeTransactionTime(source.time || source.transactionTime || source.approvalTime);
  const amount = toPositiveAmount(source.amount);
  const merchant = String(source.merchant || source.description || "").trim().slice(0, 160);
  const status = String(source.status || source.kind || "expense").toLowerCase();
  const kind = /refund|cancel|취소|환불/.test(status) ? "refund" : "expense";
  const confidenceRaw = String(source.confidence || "medium").toLowerCase();
  const confidence = ["high", "medium", "low"].includes(confidenceRaw)
    ? confidenceRaw
    : "medium";

  return {
    candidateId: `IMP_${index + 1}`,
    date: DATE_RE.test(date) ? date : "",
    time,
    merchant,
    amount,
    cardName: String(source.cardName || source.card || "").trim().slice(0, 100),
    suggestedCategoryName: String(source.category || source.suggestedCategoryName || "").trim().slice(0, 80),
    kind,
    confidence,
    memo: String(source.memo || "").trim().slice(0, 240),
    sourceText: String(source.sourceText || source.rawText || "").trim().slice(0, 300)
  };
}

export function extractJsonValue(value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.transactions)) return value.transactions;
    if (value.response && typeof value.response === "object") return extractJsonValue(value.response);
    if (typeof value.response === "string") return extractJsonValue(value.response);
    if (typeof value.result === "string") return extractJsonValue(value.result);
    if (typeof value.answer === "string") return extractJsonValue(value.answer);
    if (typeof value.text === "string") return extractJsonValue(value.text);
    const choiceContent = value.choices?.[0]?.message?.content;
    if (typeof choiceContent === "string") return extractJsonValue(choiceContent);
    if (Array.isArray(choiceContent)) {
      const joined = choiceContent
        .map((part) => typeof part === "string" ? part : part?.text)
        .filter((part) => typeof part === "string")
        .join("\n");
      if (joined) return extractJsonValue(joined);
    }
  }

  const text = String(value || "").trim();
  if (!text) return [];

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [unfenced];
  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(unfenced.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = unfenced.indexOf("[");
  const arrayEnd = unfenced.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(unfenced.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.transactions)) return parsed.transactions;
    } catch {
      // Try the next possible JSON slice.
    }
  }

  return [];
}

export function choosePaymentMethod(cardName, accounts) {
  const target = normalizeCardLabel(cardName);
  const active = (accounts || []).filter((account) => account && account.active && !account.isDeleted);
  if (!target) return null;

  let best = null;
  let bestScore = 0;
  for (const account of active) {
    const labels = [account.displayName, account.accountName, account.name]
      .map(normalizeCardLabel)
      .filter(Boolean);
    for (const label of labels) {
      let score = 0;
      if (label === target) score = 100;
      else if (label.includes(target) || target.includes(label)) score = 80;
      else {
        const shortTarget = target.replace(/(신용|체크|법인|개인)/g, "");
        const shortLabel = label.replace(/(신용|체크|법인|개인)/g, "");
        if (shortTarget && shortLabel && (shortLabel.includes(shortTarget) || shortTarget.includes(shortLabel))) score = 65;
      }
      if (score > bestScore) {
        best = account;
        bestScore = score;
      }
    }
  }
  return bestScore >= 65 ? best : null;
}

export function chooseCategory(candidate, categories, recentTransactions = []) {
  const merchant = normalizeMerchant(candidate?.merchant);
  if (merchant) {
    for (const transaction of recentTransactions || []) {
      if (!transaction?.categoryId || transaction?.type !== "지출") continue;
      const prior = normalizeMerchant(transaction.description);
      if (!prior) continue;
      if (merchant === prior || (merchant.length >= 4 && (merchant.includes(prior) || prior.includes(merchant)))) {
        const category = (categories || []).find((item) => item.categoryId === transaction.categoryId && item.active && !item.isDeleted);
        if (category) return { category, source: "history" };
      }
    }
  }

  const suggested = String(candidate?.suggestedCategoryName || "").trim();
  if (suggested) {
    const exact = (categories || []).find((item) => item.type === "지출" && item.active && !item.isDeleted && item.name === suggested);
    if (exact) return { category: exact, source: "ai" };
    const normalized = normalizeMerchant(suggested);
    const fuzzy = (categories || []).find((item) => item.type === "지출" && item.active && !item.isDeleted && normalizeMerchant(item.name) === normalized);
    if (fuzzy) return { category: fuzzy, source: "ai" };
  }
  return { category: null, source: null };
}

function dateDistanceDays(a, b) {
  if (!DATE_RE.test(a || "") || !DATE_RE.test(b || "")) return Infinity;
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  return Math.abs(left - right) / 86400000;
}

export function findDuplicateTransaction(candidate, transactions, paymentMethodId = null) {
  const merchant = normalizeMerchant(candidate?.merchant);
  const amount = Number(candidate?.amount || 0);
  if (!amount || !candidate?.date) return null;

  let best = null;
  let bestScore = -1;
  for (const transaction of transactions || []) {
    if (!transaction || transaction.isDeleted || transaction.type !== "지출") continue;
    if (Math.abs(Number(transaction.amount || 0) - amount) > 0.01) continue;
    const days = dateDistanceDays(candidate.date, transaction.date);
    if (days > 1) continue;

    let score = days === 0 ? 50 : 35;
    if (paymentMethodId && transaction.paymentMethodId === paymentMethodId) score += 30;
    const priorMerchant = normalizeMerchant(transaction.description);
    if (merchant && priorMerchant) {
      if (merchant === priorMerchant) score += 30;
      else if (merchant.length >= 4 && (merchant.includes(priorMerchant) || priorMerchant.includes(merchant))) score += 20;
    }
    if (score > bestScore) {
      best = transaction;
      bestScore = score;
    }
  }
  return bestScore >= 60 ? best : null;
}

export function dedupeImportedCandidates(items) {
  const seenSource = new Set();
  const result = [];
  for (const item of items || []) {
    const merchant = normalizeMerchant(item?.merchant);
    const coreFieldCount = [Boolean(item?.date), Number(item?.amount || 0) > 0, Boolean(merchant)]
      .filter(Boolean).length;

    // Keep incomplete but recognizable transactions so the review UI can repair them.
    // A single isolated field is too weak and is more likely to be a balance/summary value.
    if (coreFieldCount < 2) continue;

    const sourceText = String(item?.sourceText || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const baseKey = [item?.date || "", item?.amount || 0, merchant, item?.kind || "expense"].join("|");
    const time = String(item?.time || "").trim();

    if (sourceText) {
      // Only collapse rows when the recognized source row itself also matches. Even a
      // matching approval time is not enough by itself: two legitimate card approvals can
      // occur in the same minute for the same amount.
      const sourceKey = `${baseKey}|${time}|${sourceText}`;
      if (seenSource.has(sourceKey)) continue;
      seenSource.add(sourceKey);
    }

    result.push(item);
  }
  return result;
}
