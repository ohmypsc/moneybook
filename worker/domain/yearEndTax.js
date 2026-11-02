// 연말정산 도우미: 카드 소득공제 현황, 공제 항목별 지출, 부부 몰아주기 추천.
//
// 세법 숫자는 TAX_RULES 한 곳에만 둡니다. 해마다 바뀌면 여기만 고치세요.
// 이 계산은 가계부에 기록된 지출로 낸 "예상치"이며, 실제 공제액은 국세청 간소화 자료가 기준입니다.

const MILLION = 1_000_000;

/**
 * 귀속연도별 규칙.
 * 2026년: 조세특례제한법 제126조의2 (2025년 세법개정, 2026년 사용분부터)
 *  - 기본한도 자녀 1명당 +50만 원(최대 +100만 원), 총급여 7천만 원 초과는 +25만 원(최대 +50만 원)
 *  - 체육시설(헬스장·수영장) 이용료는 2025.7.1.부터 문화비 공제 대상
 */
export const TAX_RULES = {
  2025: {
    year: 2025,
    thresholdRate: 0.25,
    rates: { credit: 0.15, debit: 0.3, culture: 0.3, market: 0.4, transit: 0.4 },
    cultureSalaryCap: 70 * MILLION,
    basicLimits: [
      { maxSalary: 70 * MILLION, base: 3 * MILLION, perChild: 0, maxChildBonus: 0 },
      { maxSalary: Infinity, base: 2.5 * MILLION, perChild: 0, maxChildBonus: 0 }
    ],
    additionalLimits: [
      { maxSalary: 70 * MILLION, amount: 3 * MILLION },
      { maxSalary: Infinity, amount: 2 * MILLION }
    ],
    medicalThresholdRate: 0.03
  },
  2026: {
    year: 2026,
    thresholdRate: 0.25,
    rates: { credit: 0.15, debit: 0.3, culture: 0.3, market: 0.4, transit: 0.4 },
    cultureSalaryCap: 70 * MILLION,
    basicLimits: [
      { maxSalary: 70 * MILLION, base: 3 * MILLION, perChild: 0.5 * MILLION, maxChildBonus: 1 * MILLION },
      { maxSalary: Infinity, base: 2.5 * MILLION, perChild: 0.25 * MILLION, maxChildBonus: 0.5 * MILLION }
    ],
    additionalLimits: [
      { maxSalary: 70 * MILLION, amount: 3 * MILLION },
      { maxSalary: Infinity, amount: 2 * MILLION }
    ],
    medicalThresholdRate: 0.03
  }
};

/**
 * 해당 연도 규칙. 아직 정리되지 않은 연도는 가장 가까운 이전 연도 규칙을 쓰고 estimated=true로 알립니다.
 */
export function getTaxRules(year) {
  const target = Number(year);
  if (TAX_RULES[target]) return { ...TAX_RULES[target], estimated: false };
  const known = Object.keys(TAX_RULES).map(Number).sort((a, b) => a - b);
  const fallback = known.filter(value => value <= target).pop() ?? known[0];
  return { ...TAX_RULES[fallback], year: target, basedOnYear: fallback, estimated: true };
}

/** 카테고리에 붙이는 연말정산 분류 */
export const TAX_CODES = {
  "": { label: "일반", cardBucket: "general", item: null },
  excluded: { label: "카드공제 제외 (공과금·통신비·세금·상품권 등)", cardBucket: "excluded", item: null },
  market: { label: "전통시장 (40%)", cardBucket: "market", item: null },
  transit: { label: "대중교통 (40%)", cardBucket: "transit", item: null },
  culture: { label: "도서·공연·영화·헬스장·수영장 (30%)", cardBucket: "culture", item: null },
  medical: { label: "의료비", cardBucket: "general", item: "medical" },
  education: { label: "교육비 (학원 등)", cardBucket: "general", item: "education" },
  tuition: { label: "학교·대학원 등록금·어린이집 (카드공제 제외)", cardBucket: "excluded", item: "education" },
  insurance: { label: "보장성 보험료", cardBucket: "excluded", item: "insurance" },
  donation: { label: "기부금", cardBucket: "excluded", item: "donation" },
  rent: { label: "월세", cardBucket: "excluded", item: "rent" }
};

export const TAX_ITEM_LABELS = {
  medical: "의료비",
  education: "교육비",
  insurance: "보장성 보험료",
  donation: "기부금",
  rent: "월세"
};

export function isValidTaxCode(code) {
  return Object.prototype.hasOwnProperty.call(TAX_CODES, String(code ?? ""));
}

/** 결제수단 종류 → 카드공제 결제 구분. 현금·계좌이체는 현금영수증 여부를 알 수 없어 제외합니다. */
export function paymentKindOf(account) {
  const subType = String(account?.subType || "");
  if (subType === "신용카드") return "credit";
  if (subType === "체크카드" || subType === "선불/지역화폐") return "debit";
  return "none";
}

function emptyUsage() {
  return {
    credit: 0,
    debit: 0,
    cultureCredit: 0,
    cultureDebit: 0,
    marketCredit: 0,
    marketDebit: 0,
    transitCredit: 0,
    transitDebit: 0,
    excluded: 0,
    notCounted: 0
  };
}

/**
 * 한 해의 지출을 사람(결제수단 명의자)별 카드 사용 구분과 공제 항목으로 모읍니다.
 *
 * transactions: 지출 거래(환불 거래 자체는 제외) — { date, type, amount, refundAmount, categoryId, paymentMethodId, fromAccountId, spendingTarget }
 * accounts: { accountId, subType, owner }
 * categoryTaxCodes: Map(categoryId → code)
 */
export function aggregateYearSpending({ transactions, accounts, categoryTaxCodes, members, year }) {
  const accountMap = new Map((accounts || []).map(account => [account.accountId, account]));
  const memberSet = new Set(members || []);
  const prefix = `${year}-`;
  const people = new Map();
  const ensure = name => {
    if (!people.has(name)) people.set(name, { usage: emptyUsage(), items: {} });
    return people.get(name);
  };
  for (const name of memberSet) ensure(name);

  for (const tx of transactions || []) {
    if (tx?.type !== "지출" || tx?.reversalOf || !String(tx?.date || "").startsWith(prefix)) continue;
    const amount = Math.max(0, (Number(tx.amount) || 0) - (Number(tx.refundAmount) || 0));
    if (amount <= 0) continue;

    const payment = accountMap.get(tx.paymentMethodId) || accountMap.get(tx.fromAccountId) || null;
    const ownerRaw = String(payment?.owner || "").trim();
    const payer = memberSet.has(ownerRaw) ? ownerRaw : "명의 미지정";
    const person = ensure(payer);

    const code = categoryTaxCodes?.get?.(tx.categoryId) || "";
    const meta = TAX_CODES[code] || TAX_CODES[""];
    const kind = paymentKindOf(payment);

    if (kind === "none") {
      person.usage.notCounted += amount;
    } else if (meta.cardBucket === "excluded") {
      person.usage.excluded += amount;
    } else if (meta.cardBucket === "culture") {
      person.usage[kind === "credit" ? "cultureCredit" : "cultureDebit"] += amount;
    } else if (meta.cardBucket === "market") {
      person.usage[kind === "credit" ? "marketCredit" : "marketDebit"] += amount;
    } else if (meta.cardBucket === "transit") {
      person.usage[kind === "credit" ? "transitCredit" : "transitDebit"] += amount;
    } else {
      person.usage[kind] += amount;
    }

    if (meta.item) {
      const items = person.items;
      if (!items[meta.item]) items[meta.item] = { total: 0, byTarget: {} };
      items[meta.item].total += amount;
      const target = String(tx.spendingTarget || "공동");
      items[meta.item].byTarget[target] = (items[meta.item].byTarget[target] || 0) + amount;
    }
  }

  return people;
}

function pickLimit(list, salary) {
  return list.find(item => salary <= item.maxSalary) || list[list.length - 1];
}

function round(value) {
  return Math.round(Number(value) || 0);
}

/**
 * 신용카드 등 소득공제 예상액(조특법 126의2 구조).
 * 문턱(총급여 25%)은 공제율이 낮은 신용카드 사용분부터 채운 것으로 봅니다.
 */
export function computeCardDeduction({ salary, children = 0, usage }, rules) {
  const gross = Math.max(0, Number(salary) || 0);
  const u = { ...emptyUsage(), ...(usage || {}) };
  const cultureSeparate = gross > 0 && gross <= rules.cultureSalaryCap;

  // 총급여 7천만 원 초과면 문화체육 사용분은 결제수단 공제율을 따릅니다.
  const credit = u.credit + (cultureSeparate ? 0 : u.cultureCredit);
  const debit = u.debit + (cultureSeparate ? 0 : u.cultureDebit);
  const culture = cultureSeparate ? u.cultureCredit + u.cultureDebit : 0;
  const market = u.marketCredit + u.marketDebit;
  const transit = u.transitCredit + u.transitDebit;
  const totalUsage = credit + debit + culture + market + transit;

  const { rates } = rules;
  const threshold = gross * rules.thresholdRate;
  const special = market * rates.market + transit * rates.transit;
  const grossDeduction = credit * rates.credit + debit * rates.debit + culture * rates.culture + special;

  let thresholdDeduction;
  if (threshold <= credit) {
    thresholdDeduction = threshold * rates.credit;
  } else if (threshold <= credit + debit + culture) {
    thresholdDeduction = credit * rates.credit + (threshold - credit) * rates.debit;
  } else {
    const rest = Math.min(threshold - credit - debit - culture, market + transit);
    thresholdDeduction = credit * rates.credit + (debit + culture) * rates.debit + rest * rates.market;
  }

  const deductible = gross > 0 ? Math.max(0, grossDeduction - thresholdDeduction) : 0;
  const basicRule = pickLimit(rules.basicLimits, gross);
  const childCount = Math.max(0, Math.trunc(Number(children) || 0));
  const basicLimit = basicRule.base + Math.min(basicRule.maxChildBonus, childCount * basicRule.perChild);
  const additionalLimit = pickLimit(rules.additionalLimits, gross).amount;

  const basicDeduction = Math.min(deductible, basicLimit);
  const specialPool = special + culture * rates.culture;
  const additionalDeduction = Math.min(Math.max(0, deductible - basicLimit), specialPool, additionalLimit);
  const total = basicDeduction + additionalDeduction;

  const remainingToThreshold = Math.max(0, threshold - totalUsage);
  const remainingBasic = Math.max(0, basicLimit - deductible);

  let stage;
  if (gross <= 0) stage = "no-salary";
  else if (remainingToThreshold > 0) stage = "below-threshold";
  else if (remainingBasic > 0) stage = "deducting";
  else stage = "basic-limit-reached";

  return {
    salary: gross,
    children: childCount,
    usage: { credit, debit, culture, market, transit, excluded: u.excluded, notCounted: u.notCounted, total: totalUsage },
    cultureSeparate,
    threshold: round(threshold),
    remainingToThreshold: round(remainingToThreshold),
    deductible: round(deductible),
    basicLimit,
    additionalLimit,
    basicDeduction: round(basicDeduction),
    additionalDeduction: round(additionalDeduction),
    total: round(total),
    remainingBasic: round(remainingBasic),
    // 기본한도를 체크카드(30%)로 채우려면 더 써야 하는 금액
    debitSpendToFillBasic: round(remainingBasic / rates.debit),
    stage
  };
}

function formatWon(value) {
  const amount = Math.round(Number(value) || 0);
  if (Math.abs(amount) >= 10_000) {
    const man = Math.round(amount / 10_000);
    return `${man.toLocaleString("ko-KR")}만 원`;
  }
  return `${amount.toLocaleString("ko-KR")}원`;
}

/**
 * 사람별 결과와 의료비를 보고 "누구 카드로 쓰면 좋은지" 안내 문장을 만듭니다.
 * people: [{ name, card: computeCardDeduction 결과, items }]
 */
export function buildRecommendations(people, rules) {
  const tips = [];
  const withSalary = (people || []).filter(person => person.card?.salary > 0);

  for (const person of withSalary) {
    const card = person.card;
    if (card.stage === "below-threshold") {
      tips.push({
        kind: "card",
        member: person.name,
        text: `${person.name}님은 카드 사용액이 총급여의 25%(${formatWon(card.threshold)})까지 ${formatWon(card.remainingToThreshold)} 남았어요. 문턱 전까지는 공제가 없으니 혜택·포인트가 좋은 신용카드를 써도 괜찮아요.`
      });
    } else if (card.stage === "deducting") {
      tips.push({
        kind: "card",
        member: person.name,
        text: `${person.name}님은 문턱을 넘었어요. 이제부터는 체크카드·현금영수증(30%)이 신용카드(15%)보다 공제가 2배예요. 기본 한도까지 체크카드로 약 ${formatWon(card.debitSpendToFillBasic)} 더 쓸 수 있어요.`
      });
    } else if (card.stage === "basic-limit-reached") {
      tips.push({
        kind: "card",
        member: person.name,
        text: `${person.name}님은 카드 기본 공제 한도(${formatWon(card.basicLimit)})를 채웠어요. 이제는 전통시장·대중교통${card.cultureSeparate ? "·문화체육" : ""} 사용분만 추가로 공제돼요. 일반 지출은 혜택 좋은 카드로 쓰세요.`
      });
    }
  }

  if (withSalary.length === 2) {
    const [a, b] = withSalary;
    const reachedA = a.card.remainingToThreshold <= 0;
    const reachedB = b.card.remainingToThreshold <= 0;
    if (reachedA !== reachedB) {
      const done = reachedA ? a : b;
      const notYet = reachedA ? b : a;
      if (done.card.stage !== "basic-limit-reached") {
        tips.push({
          kind: "couple",
          text: `공동 지출은 이미 문턱을 넘은 ${done.name}님 카드로 결제하세요. ${notYet.name}님은 문턱까지 ${formatWon(notYet.card.remainingToThreshold)}이 남아 지금 쓰는 금액은 공제되지 않아요.`
        });
      }
    } else if (!reachedA && !reachedB) {
      const lower = a.card.threshold <= b.card.threshold ? a : b;
      tips.push({
        kind: "couple",
        text: `두 분 모두 아직 문턱 전이에요. 총급여가 낮은 ${lower.name}님 카드로 공동 지출을 몰면 문턱(${formatWon(lower.card.threshold)})을 먼저 넘길 수 있어요.`
      });
    } else {
      const open = withSalary.filter(person => person.card.stage === "deducting");
      if (open.length === 2) {
        const higher = a.card.salary >= b.card.salary ? a : b;
        tips.push({
          kind: "couple",
          text: `두 분 모두 문턱을 넘었어요. 남은 공동 지출은 세율이 더 높은(총급여가 많은) ${higher.name}님 체크카드로 쓰면 같은 공제액으로 돌려받는 세금이 더 커요.`
        });
      } else if (open.length === 1) {
        tips.push({
          kind: "couple",
          text: `공동 지출은 아직 공제 한도가 남은 ${open[0].name}님 체크카드로 결제하세요.`
        });
      }
    }

    // 의료비: 총급여의 3%를 넘는 부분부터 세액공제 → 총급여가 낮은 쪽이 유리
    const medicalTotal = withSalary.reduce((sum, person) => sum + (person.items?.medical?.total || 0), 0);
    if (medicalTotal > 0) {
      const lower = a.card.salary <= b.card.salary ? a : b;
      const higher = lower === a ? b : a;
      const lowerThreshold = lower.card.salary * rules.medicalThresholdRate;
      const higherThreshold = higher.card.salary * rules.medicalThresholdRate;
      tips.push({
        kind: "medical",
        text: `의료비는 총급여의 3%를 넘는 부분부터 공제돼요(${lower.name}님 ${formatWon(lowerThreshold)}, ${higher.name}님 ${formatWon(higherThreshold)}). 올해 두 분 의료비 ${formatWon(medicalTotal)}은 ${lower.name}님 카드로 모아 결제하는 게 유리해요.`
      });
    }
  }

  return tips;
}

// ── 급여 수입으로 총급여 추정 ────────────────────────────────────
// 가계부에는 세금·4대보험을 뗀 '실수령액'이 기록되므로, 연봉 구간별 대략적인
// 실수령 비율로 총급여를 거꾸로 추정합니다(부양가족·비과세 수당에 따라 5~10% 차이 날 수 있음).

/** [연 총급여, 실수령 비율] — 2026년 4대보험·간이세액표 기준 대략치 */
export const NET_PAY_RATIOS = [
  [20 * MILLION, 0.91],
  [30 * MILLION, 0.89],
  [40 * MILLION, 0.87],
  [50 * MILLION, 0.85],
  [60 * MILLION, 0.835],
  [70 * MILLION, 0.82],
  [80 * MILLION, 0.80],
  [100 * MILLION, 0.77],
  [150 * MILLION, 0.72],
  [200 * MILLION, 0.68]
];

export function netPayRatio(gross) {
  const table = NET_PAY_RATIOS;
  if (gross <= table[0][0]) return table[0][1];
  for (let index = 1; index < table.length; index += 1) {
    const [upper, upperRatio] = table[index];
    const [lower, lowerRatio] = table[index - 1];
    if (gross <= upper) {
      return lowerRatio + ((gross - lower) / (upper - lower)) * (upperRatio - lowerRatio);
    }
  }
  return table[table.length - 1][1];
}

/** 연 실수령액 → 연 총급여 추정(만 원 단위 반올림) */
export function estimateGrossFromNet(annualNet) {
  const net = Math.max(0, Number(annualNet) || 0);
  if (net <= 0) return 0;
  let low = net;
  let high = net * 2;
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    if (mid * netPayRatio(mid) < net) low = mid;
    else high = mid;
  }
  return Math.round(high / 10_000) * 10_000;
}

const SALARY_NAME_PATTERN = /급여|월급|상여|보너스|성과급|인센티브|연봉/;

/**
 * 수입 카테고리가 급여인지 판단합니다.
 * 코드: "salary"(급여로 계산), "not-salary"(급여 아님), ""(이름으로 자동 판단)
 */
export function isSalaryCategory(name, code) {
  if (code === "salary") return true;
  if (code === "not-salary") return false;
  return SALARY_NAME_PATTERN.test(String(name || ""));
}

export const INCOME_TAX_CODES = {
  "": "자동",
  salary: "급여로 계산",
  "not-salary": "급여 아님"
};

/**
 * 사람별(받은 통장 명의자) 한 해 급여 실수령액과 총급여 추정치.
 * currentMonth(YYYY-MM)가 같은 해면 받은 달 수로 1년치를 환산합니다.
 */
export function summarizeSalaryIncome({ transactions, accounts, salaryCategoryIds, members, year, currentMonth }) {
  const accountMap = new Map((accounts || []).map(account => [account.accountId, account]));
  const memberSet = new Set(members || []);
  const result = new Map();
  for (const name of memberSet) result.set(name, { netTotal: 0, months: new Set() });

  for (const tx of transactions || []) {
    if (tx?.type !== "수입" || tx?.reversalOf) continue;
    if (!String(tx?.date || "").startsWith(`${year}-`)) continue;
    if (!salaryCategoryIds.has(tx.categoryId)) continue;
    const requestId = String(tx.requestId || "");
    if (requestId.startsWith("BENEFIT_") || requestId.startsWith("SETTLEMENT_")) continue;
    const owner = String(accountMap.get(tx.toAccountId)?.owner || "").trim();
    if (!memberSet.has(owner)) continue;
    const entry = result.get(owner);
    entry.netTotal += Math.max(0, (Number(tx.amount) || 0) - (Number(tx.refundAmount) || 0));
    entry.months.add(String(tx.date).slice(0, 7));
  }

  const inProgress = String(currentMonth || "").startsWith(`${year}-`);
  const summaries = new Map();
  for (const [name, entry] of result) {
    const monthCount = entry.months.size;
    const annualizedNet = inProgress && monthCount > 0 && monthCount < 12
      ? (entry.netTotal / monthCount) * 12
      : entry.netTotal;
    summaries.set(name, {
      netTotal: Math.round(entry.netTotal),
      months: monthCount,
      annualized: inProgress && monthCount > 0 && monthCount < 12,
      annualizedNet: Math.round(annualizedNet),
      estimatedGross: estimateGrossFromNet(annualizedNet)
    });
  }
  return summaries;
}


// ── 추천 카테고리 정리 ─────────────────────────────────────────
// 이 가계부의 지출 카테고리에 맞춘 연말정산용 정리안입니다.
// 기존 거래는 건드리지 않고, (1) 분류가 비어 있는 기존 카테고리에 분류를 연결하고
// (2) 없는 카테고리를 새로 만듭니다.
export const CATEGORY_PRESET = {
  link: [
    { name: "대중교통", taxCode: "transit", note: "버스·지하철·기차·고속버스 (택시 제외)" },
    { name: "공과금", taxCode: "excluded", note: "전기·가스·수도·통신비·관리비" },
    { name: "교육비", taxCode: "tuition", note: "대학원 등록금 — 본인 교육비 세액공제" },
    { name: "의료", taxCode: "medical", note: "병원·약국·안경" },
    { name: "보험", taxCode: "insurance", note: "실손·암보험 등 보장성" }
  ],
  create: [
    { name: "기부금", taxCode: "donation", note: "경조사(축의·조의)와 구분" },
    { name: "저축성 보험", taxCode: "excluded", note: "연금·저축보험 (보험료 공제 아님)" },
    { name: "도서·공연·운동", taxCode: "culture", note: "책·공연·영화·헬스장·수영장" },
    { name: "건강식품·영양제", taxCode: "", note: "의료비 공제가 안 되는 건강 관련 지출" },
    { name: "전통시장", taxCode: "market", note: "전통시장 결제 (40%)" }
  ]
};

/**
 * 추천 정리안을 지금 카테고리에 맞춰 실제로 바꿀 목록으로 만듭니다.
 * categories: [{ categoryId, name, type, taxCode, deleted }]
 * 이미 다른 분류로 연결된 카테고리는 덮어쓰지 않습니다.
 */
export function planCategoryPreset(categories, preset = CATEGORY_PRESET) {
  const expense = (categories || []).filter(category => category.type === "지출");
  const active = expense.filter(category => !category.deleted);
  const byName = new Map(active.map(category => [category.name, category]));
  const deletedNames = new Set(expense.filter(category => category.deleted).map(category => category.name));

  const links = [];
  const creates = [];
  const skipped = [];

  for (const rule of preset.link) {
    const category = byName.get(rule.name);
    if (!category) {
      skipped.push({ name: rule.name, reason: "카테고리가 없어요" });
    } else if (category.taxCode === rule.taxCode) {
      skipped.push({ name: rule.name, reason: "이미 연결돼 있어요" });
    } else if (category.taxCode) {
      skipped.push({ name: rule.name, reason: "다른 분류로 직접 연결해 둬서 그대로 둬요" });
    } else {
      links.push({ categoryId: category.categoryId, name: rule.name, taxCode: rule.taxCode, note: rule.note });
    }
  }

  for (const rule of preset.create) {
    const existing = byName.get(rule.name);
    if (existing) {
      if (!existing.taxCode && rule.taxCode) {
        links.push({ categoryId: existing.categoryId, name: rule.name, taxCode: rule.taxCode, note: rule.note });
      } else {
        skipped.push({ name: rule.name, reason: "이미 있어요" });
      }
    } else if (deletedNames.has(rule.name)) {
      skipped.push({ name: rule.name, reason: "삭제된 같은 이름 카테고리가 있어요 (설정에서 복원하세요)" });
    } else {
      creates.push({ name: rule.name, taxCode: rule.taxCode, note: rule.note });
    }
  }

  return { links, creates, skipped };
}
