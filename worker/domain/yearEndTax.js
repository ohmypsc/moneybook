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
  tuition: { label: "학교 수업료·어린이집 (카드공제 제외)", cardBucket: "excluded", item: "education" },
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
