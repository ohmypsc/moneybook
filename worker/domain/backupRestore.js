export class BackupValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupValidationError";
    this.code = code;
  }
}

const MAX_TOTAL_RECORDS = 250000;
const TRANSACTION_TYPES = new Set(["수입", "지출", "이체"]);
const TRADE_TYPES = new Set(["매수", "매도"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return String(value ?? "").trim();
}

function fail(code, message) {
  throw new BackupValidationError(code, message);
}

function array(value, label) {
  if (!Array.isArray(value)) fail("BACKUP_INVALID_SHAPE", `${label} 항목이 배열이 아닙니다.`);
  return value;
}

function uniqueIdSet(items, key, label) {
  const ids = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const id = text(items[index]?.[key]);
    if (!id) fail("BACKUP_ID_REQUIRED", `${label} ${index + 1}번째 항목의 ${key}가 비어 있습니다.`);
    if (ids.has(id)) fail("BACKUP_DUPLICATE_ID", `${label}에 중복 ID가 있습니다: ${id}`);
    ids.add(id);
  }
  return ids;
}


function assertUniqueOptional(items, key, label) {
  const values = new Set();
  for (const item of items) {
    const value = text(item?.[key]);
    if (!value) continue;
    if (values.has(value)) fail("BACKUP_DUPLICATE_REQUEST_ID", `${label}에 중복 요청 ID가 있습니다: ${value}`);
    values.add(value);
  }
}

function requireReference(id, ids, label) {
  const clean = text(id);
  if (clean && !ids.has(clean)) fail("BACKUP_REFERENCE_MISSING", `${label} 참조를 찾을 수 없습니다: ${clean}`);
}

function optionalObject(value, label) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) fail("BACKUP_INVALID_SHAPE", `${label} 형식이 올바르지 않습니다.`);
  return value;
}

export function validateBackupDocument(input) {
  if (!isObject(input)) fail("BACKUP_INVALID_DOCUMENT", "백업 파일의 최상위 형식이 올바르지 않습니다.");
  if (input.format !== "moneybook-backup") fail("BACKUP_INVALID_FORMAT", "Moneybook 백업 파일이 아닙니다.");
  const version = Number(input.version);
  if (![1, 2].includes(version)) fail("BACKUP_UNSUPPORTED_VERSION", `지원하지 않는 백업 버전입니다: ${input.version}`);
  if (!isObject(input.payload)) fail("BACKUP_INVALID_PAYLOAD", "백업 데이터가 없습니다.");

  const payload = input.payload;
  const bootstrap = optionalObject(payload.bootstrap, "기본 설정");
  if (!bootstrap) fail("BACKUP_BOOTSTRAP_REQUIRED", "기본 설정 정보가 없습니다.");

  const categories = array(payload.categories, "카테고리");
  const accounts = array(payload.accounts, "계좌");
  const transactions = array(payload.transactions, "거래");
  const assetSnapshots = array(payload.assetSnapshots, "자산 스냅샷");
  const investmentHoldings = array(payload.investmentHoldings, "투자 보유종목");
  const investmentTrades = array(payload.investmentTrades, "투자 거래");
  const benefitRewardUsage = version >= 2
    ? array(payload.benefitRewardUsage ?? [], "혜택 사용내역")
    : [];

  const totalRecords = categories.length + accounts.length + transactions.length + assetSnapshots.length
    + investmentHoldings.length + investmentTrades.length + benefitRewardUsage.length;
  if (totalRecords > MAX_TOTAL_RECORDS) {
    fail("BACKUP_TOO_LARGE", `복원 항목이 너무 많습니다. 최대 ${MAX_TOTAL_RECORDS.toLocaleString("ko-KR")}건까지 지원합니다.`);
  }

  const categoryIds = uniqueIdSet(categories, "categoryId", "카테고리");
  const accountIds = uniqueIdSet(accounts, "accountId", "계좌");
  const transactionIds = uniqueIdSet(transactions, "transactionId", "거래");
  const holdingIds = uniqueIdSet(investmentHoldings, "holdingId", "투자 보유종목");
  uniqueIdSet(investmentTrades, "investmentTradeId", "투자 거래");
  assertUniqueOptional(transactions, "requestId", "거래");
  assertUniqueOptional(investmentTrades, "requestId", "투자 거래");

  for (const category of categories) {
    if (!TRANSACTION_TYPES.has(text(category?.type))) fail("BACKUP_CATEGORY_TYPE_INVALID", `카테고리 유형이 올바르지 않습니다: ${category?.type ?? ""}`);
    if (!text(category?.name)) fail("BACKUP_CATEGORY_NAME_REQUIRED", "이름이 없는 카테고리가 있습니다.");
  }

  for (const account of accounts) {
    if (!text(account?.accountName) && !text(account?.displayName)) fail("BACKUP_ACCOUNT_NAME_REQUIRED", `이름이 없는 계좌가 있습니다: ${account?.accountId ?? ""}`);
    requireReference(account?.paymentAccountId, accountIds, "계좌의 결제계좌");
  }

  for (const transaction of transactions) {
    const type = text(transaction?.type);
    if (!TRANSACTION_TYPES.has(type)) fail("BACKUP_TRANSACTION_TYPE_INVALID", `거래 유형이 올바르지 않습니다: ${type}`);
    const amount = Number(transaction?.amount);
    if (!Number.isFinite(amount) || amount <= 0) fail("BACKUP_TRANSACTION_AMOUNT_INVALID", `거래 금액이 올바르지 않습니다: ${transaction?.transactionId ?? ""}`);
    requireReference(transaction?.categoryId, categoryIds, "거래의 카테고리");
    requireReference(transaction?.fromAccountId, accountIds, "거래의 출금계좌");
    requireReference(transaction?.toAccountId, accountIds, "거래의 입금계좌");
    requireReference(transaction?.paymentMethodId, accountIds, "거래의 결제수단");
    requireReference(transaction?.reversalOf, transactionIds, "거래의 취소 원거래");
  }

  const snapshotMonths = new Set();
  for (const snapshot of assetSnapshots) {
    const month = text(snapshot?.month);
    if (!/^\d{4}-\d{2}$/.test(month)) fail("BACKUP_SNAPSHOT_MONTH_INVALID", `자산 스냅샷 월이 올바르지 않습니다: ${month}`);
    if (snapshotMonths.has(month)) fail("BACKUP_DUPLICATE_SNAPSHOT", `중복된 자산 스냅샷 월이 있습니다: ${month}`);
    snapshotMonths.add(month);
  }

  for (const holding of investmentHoldings) {
    requireReference(holding?.accountId, accountIds, "보유종목의 투자계좌");
    if (!text(holding?.stockCode)) fail("BACKUP_HOLDING_CODE_REQUIRED", `종목코드가 없는 보유종목이 있습니다: ${holding?.holdingId ?? ""}`);
  }

  for (const trade of investmentTrades) {
    if (!TRADE_TYPES.has(text(trade?.tradeType))) fail("BACKUP_TRADE_TYPE_INVALID", `투자 거래 유형이 올바르지 않습니다: ${trade?.tradeType ?? ""}`);
    requireReference(trade?.accountId, accountIds, "투자 거래의 계좌");
    requireReference(trade?.holdingId, holdingIds, "투자 거래의 보유종목");
  }

  for (const usage of benefitRewardUsage) {
    requireReference(usage?.transactionId, transactionIds, "혜택 사용내역의 거래");
    requireReference(usage?.accountId, accountIds, "혜택 사용내역의 계좌");
    if (!text(usage?.ruleId)) fail("BACKUP_BENEFIT_RULE_REQUIRED", "혜택 사용내역에 규칙 ID가 없습니다.");
  }

  const members = Array.isArray(bootstrap.members)
    ? bootstrap.members.map(text).filter(Boolean)
    : [];
  if (new Set(members).size !== members.length) fail("BACKUP_DUPLICATE_MEMBER", "구성원 이름이 중복되어 있습니다.");

  const warnings = [];
  if (version === 1) {
    warnings.push("이 백업은 버전 1이라 카드 혜택 사용 누계가 포함되지 않습니다. 일반 거래·계좌·투자 데이터는 복원할 수 있습니다.");
  }
  if (!bootstrap.inputPreferences) warnings.push("입력 화면 노출/순서 설정이 백업에 없습니다.");
  if (!bootstrap.automationSettings) warnings.push("자동화 설정이 백업에 없습니다.");

  return {
    document: input,
    version,
    exportedAt: text(input.exportedAt) || null,
    payload,
    members,
    warnings,
    summary: {
      members: members.length,
      categories: categories.length,
      accounts: accounts.length,
      transactions: transactions.length,
      assetSnapshots: assetSnapshots.length,
      investmentHoldings: investmentHoldings.length,
      investmentTrades: investmentTrades.length,
      benefitRewardUsage: benefitRewardUsage.length,
      totalRecords
    }
  };
}
export function findRequestIdConflicts(items, idKey, currentRows) {
  const currentByRequestId = new Map();
  for (const row of currentRows || []) {
    const requestId = text(row?.requestId ?? row?.request_id);
    const id = text(row?.id);
    if (!requestId || !id) continue;
    if (!currentByRequestId.has(requestId)) currentByRequestId.set(requestId, new Set());
    currentByRequestId.get(requestId).add(id);
  }

  const conflicts = [];
  for (const item of items || []) {
    const requestId = text(item?.requestId);
    const id = text(item?.[idKey]);
    if (!requestId || !id) continue;
    const currentIds = currentByRequestId.get(requestId);
    if (currentIds && Array.from(currentIds).some((currentId) => currentId !== id)) {
      conflicts.push({ requestId, id });
    }
  }
  return conflicts;
}

