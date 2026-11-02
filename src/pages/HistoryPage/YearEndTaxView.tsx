import { useEffect, useState } from "react";

import {
  getTaxSummary,
  saveCategoryTaxCode,
  saveTaxProfile,
  type TaxItemKey,
  type TaxMemberSummary,
  type TaxSummary
} from "../../api/tax";
import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import { formatMoney } from "../../components/common/Money/Money";
import { getSeoulMonthString } from "../../utils/dateTime";
import { subscribeLedgerChanges } from "../../utils/ledgerEvents";

import historyStyles from "./HistoryPage.module.css";
import styles from "./YearEndTaxView.module.css";

const ITEM_LABELS: Record<TaxItemKey, string> = {
  medical: "의료비",
  education: "교육비",
  insurance: "보장성 보험료",
  donation: "기부금",
  rent: "월세"
};

const ITEM_ORDER: TaxItemKey[] = ["medical", "education", "insurance", "donation", "rent"];

function won(value: number) {
  return formatMoney(Math.round(Number(value) || 0));
}

function stageLabel(member: TaxMemberSummary) {
  switch (member.card.stage) {
    case "no-salary":
      return "총급여 입력 필요";
    case "below-threshold":
      return "문턱 전";
    case "deducting":
      return "공제 중";
    case "basic-limit-reached":
      return "기본 한도 도달";
  }
}

function MemberCard({
  member,
  year,
  onSaved
}: {
  member: TaxMemberSummary;
  year: number;
  onSaved: () => void;
}) {
  const [salaryManwon, setSalaryManwon] = useState(
    member.grossSalary > 0 ? String(Math.round(member.grossSalary / 10_000)) : ""
  );
  const [children, setChildren] = useState(String(member.children || 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSalaryManwon(member.grossSalary > 0 ? String(Math.round(member.grossSalary / 10_000)) : "");
    setChildren(String(member.children || 0));
  }, [member.grossSalary, member.children]);

  const dirty =
    (member.grossSalary > 0 ? String(Math.round(member.grossSalary / 10_000)) : "") !== salaryManwon ||
    String(member.children || 0) !== children;

  async function handleSave() {
    const value = Number(salaryManwon.replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 0) {
      setError("총급여를 만 원 단위 숫자로 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveTaxProfile({
        year,
        memberName: member.name,
        grossSalary: Math.round(value) * 10_000,
        children: Number(children)
      });
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const card = member.card;
  const salaryBasis = member.salaryUsed;
  const progress = card.threshold > 0 ? Math.min(100, (card.usage.total / card.threshold) * 100) : 0;
  const limitProgress = card.basicLimit > 0 ? Math.min(100, (card.basicDeduction / card.basicLimit) * 100) : 0;

  const usageRows: [string, number, string?][] = [
    ["신용카드", card.usage.credit, "15%"],
    ["체크카드·선불·지역화폐", card.usage.debit, "30%"],
    ["전통시장", card.usage.market, "40%"],
    ["대중교통", card.usage.transit, "40%"],
    ...(card.cultureSeparate ? [["도서·공연·헬스장 등", card.usage.culture, "30%"] as [string, number, string]] : []),
    ["카드공제 제외 항목", card.usage.excluded, "제외"],
    ["현금·계좌이체", card.usage.notCounted, "미포함"]
  ];

  return (
    <Card as="section" className={styles.memberCard}>
      <div className={styles.memberHeader}>
        <h2>{member.name}</h2>
        <span className={styles.stageBadge} data-stage={card.stage}>{stageLabel(member)}</span>
      </div>

      <div className={styles.profileRow}>
        <label>
          <span>{year}년 총급여 (만 원)</span>
          <input
            inputMode="numeric"
            value={salaryManwon}
            placeholder="예: 5200"
            onChange={event => setSalaryManwon(event.target.value.replace(/[^\d]/g, ""))}
          />
        </label>
        <label>
          <span>자녀 수</span>
          <select value={children} onChange={event => setChildren(event.target.value)}>
            <option value="0">없음</option>
            <option value="1">1명</option>
            <option value="2">2명 이상</option>
          </select>
        </label>
        <Button size="sm" disabled={!dirty || saving} loading={saving} loadingLabel="저장 중" onClick={() => void handleSave()}>
          저장
        </Button>
      </div>
      {member.salaryIncome && member.salaryIncome.netTotal > 0 ? (
        <div className={styles.estimateBox}>
          <p>
            가계부 급여 수입: {member.salaryIncome.months}개월 실수령 {won(member.salaryIncome.netTotal)}
            {member.salaryIncome.annualized ? ` → 1년 환산 ${won(member.salaryIncome.annualizedNet)}` : ""}
            <br />
            <strong>총급여 약 {Math.round(member.salaryIncome.estimatedGross / 10_000).toLocaleString("ko-KR")}만 원</strong>으로 추정돼요.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSalaryManwon(String(Math.round(member.salaryIncome!.estimatedGross / 10_000)))}
          >
            추정값 넣기
          </Button>
        </div>
      ) : (
        <p className={styles.hint}>
          수입에 '급여'·'월급' 카테고리로 기록하면 총급여를 추정해 드려요.
        </p>
      )}
      {member.salarySource === "estimate" && (
        <p className={styles.estimateNotice}>
          총급여를 입력하지 않아 추정값으로 계산했어요. 실수령액으로 거꾸로 추정한 값이라 실제와 5~10% 다를 수 있어요.
        </p>
      )}
      <p className={styles.hint}>총급여는 비과세 수당을 뺀 세전 연봉이에요. 급여명세서나 원천징수영수증의 '총급여' 칸을 넣으면 가장 정확해요.</p>
      {error && <p className={historyStyles.error}>{error}</p>}

      {salaryBasis > 0 && (
        <>
          <div className={styles.meter}>
            <div className={styles.meterLabel}>
              <span>카드 사용 {won(card.usage.total)}</span>
              <span>문턱(총급여 25%) {won(card.threshold)}</span>
            </div>
            <div className={styles.meterTrack}>
              <div className={styles.meterFill} style={{ width: `${progress}%` }} />
            </div>
            <p className={styles.meterNote}>
              {card.remainingToThreshold > 0
                ? `문턱까지 ${won(card.remainingToThreshold)} 남았어요.`
                : "문턱을 넘었어요. 이후 사용분이 공제돼요."}
            </p>
          </div>

          <div className={styles.meter}>
            <div className={styles.meterLabel}>
              <span>예상 소득공제 <strong>{won(card.total)}</strong></span>
              <span>기본 한도 {won(card.basicLimit)}</span>
            </div>
            <div className={styles.meterTrack}>
              <div className={`${styles.meterFill} ${styles.meterFillDeduction}`} style={{ width: `${limitProgress}%` }} />
            </div>
            {card.additionalDeduction > 0 && (
              <p className={styles.meterNote}>
                기본 {won(card.basicDeduction)} + 전통시장·대중교통 등 추가 {won(card.additionalDeduction)}
              </p>
            )}
          </div>
        </>
      )}

      <dl className={styles.usageList}>
        {usageRows.map(([label, amount, rate]) => (
          <div key={label}>
            <dt>{label}{rate ? <small>{rate}</small> : null}</dt>
            <dd>{won(amount)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function YearEndTaxView() {
  const [year, setYear] = useState(Number(getSeoulMonthString().slice(0, 4)));
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCategories, setShowCategories] = useState(false);
  const [savingCategoryId, setSavingCategoryId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => subscribeLedgerChanges(() => setReloadKey(value => value + 1)), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getTaxSummary(year)
      .then(data => {
        if (active) setSummary(data);
      })
      .catch(loadError => {
        if (active) setError(loadError instanceof Error ? loadError.message : "불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [year, reloadKey]);

  async function handleCategoryChange(categoryId: string, taxCode: string) {
    setSavingCategoryId(categoryId);
    try {
      await saveCategoryTaxCode(categoryId, taxCode);
      setReloadKey(value => value + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "저장하지 못했습니다.");
    } finally {
      setSavingCategoryId("");
    }
  }

  const currentYear = Number(getSeoulMonthString().slice(0, 4));
  const unassignedTotal = summary?.unassigned
    ? Object.entries(summary.unassigned.usage)
        .filter(([key]) => key !== "notCounted" && key !== "excluded")
        .reduce((sum, [, value]) => sum + (Number(value) || 0), 0)
    : 0;

  const itemRows = ITEM_ORDER.map(key => ({
    key,
    byMember: (summary?.members || []).map(member => member.items[key]?.total || 0),
    unassigned: summary?.unassigned?.items[key]?.total || 0
  })).filter(row => row.byMember.some(Boolean) || row.unassigned > 0);

  const mappedCount = (summary?.categories || []).filter(category => category.taxCode).length;

  return (
    <main className={historyStyles.page}>
      <header className={historyStyles.header}>
        <h1>연말정산 도우미</h1>
        <p>가계부 기록으로 계산한 예상치예요. 실제 공제액은 다음 해 1월 홈택스 간소화 자료가 기준이에요.</p>
      </header>

      <div className={historyStyles.monthControl}>
        <Button variant="ghost" size="sm" iconOnly aria-label="이전 해" onClick={() => setYear(value => value - 1)}>‹</Button>
        <strong>{year}년 사용분</strong>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="다음 해"
          disabled={year >= currentYear}
          onClick={() => setYear(value => value + 1)}
        >›</Button>
      </div>

      {summary?.rules.estimated && (
        <p className={styles.notice}>
          {year}년 세법은 아직 반영되지 않아 {summary.rules.basedOnYear}년 기준으로 계산했어요.
        </p>
      )}

      {loading && !summary && <p className={historyStyles.state}>불러오는 중입니다.</p>}
      {error && <p className={historyStyles.error}>{error}</p>}

      {summary && (
        <>
          {summary.recommendations.length > 0 && (
            <Card as="section" className={styles.tipsCard}>
              <h2>💡 이렇게 쓰면 유리해요</h2>
              <ul>
                {summary.recommendations.map(tip => (
                  <li key={tip.text}>{tip.text}</li>
                ))}
              </ul>
            </Card>
          )}

          {mappedCount === 0 && (
            <p className={styles.notice}>
              아래 '카테고리 연결'에서 병원·약국은 의료비, 교통은 대중교통처럼 연결하면 더 정확해져요.
            </p>
          )}

          {unassignedTotal > 0 && (
            <p className={styles.notice}>
              명의가 '공동'이거나 비어 있는 카드로 쓴 {won(unassignedTotal)}은 누구의 공제인지 알 수 없어 계산에서 빠졌어요.
              설정 → 자산 관리에서 카드 명의를 지정해 주세요.
            </p>
          )}

          {summary.members.map(member => (
            <MemberCard
              key={`${member.name}-${year}`}
              member={member}
              year={year}
              onSaved={() => setReloadKey(value => value + 1)}
            />
          ))}

          <Card as="section">
            <h2 className={styles.sectionTitle}>공제 항목별 지출</h2>
            <p className={styles.hint}>결제한 사람(카드·계좌 명의) 기준이에요. 영수증·간소화 자료와 비교해 빠진 게 없는지 확인하세요.</p>
            {itemRows.length === 0 ? (
              <p className={historyStyles.empty}>아직 연결된 공제 항목 지출이 없어요.</p>
            ) : (
              <table className={styles.itemTable}>
                <thead>
                  <tr>
                    <th>항목</th>
                    {summary.members.map(member => <th key={member.name}>{member.name}</th>)}
                    {itemRows.some(row => row.unassigned > 0) && <th>명의 미지정</th>}
                  </tr>
                </thead>
                <tbody>
                  {itemRows.map(row => (
                    <tr key={row.key}>
                      <th>{ITEM_LABELS[row.key]}</th>
                      {row.byMember.map((amount, index) => <td key={index}>{amount ? won(amount) : "-"}</td>)}
                      {itemRows.some(item => item.unassigned > 0) && <td>{row.unassigned ? won(row.unassigned) : "-"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {summary.members.some(member => member.salaryUsed > 0) && itemRows.some(row => row.key === "medical") && (
              <p className={styles.hint}>
                의료비 공제 문턱(총급여 3%):{" "}
                {summary.members
                  .filter(member => member.salaryUsed > 0)
                  .map(member => `${member.name} ${won(member.medicalThreshold)}${member.salarySource === "estimate" ? "(추정)" : ""}`)
                  .join(" · ")}
              </p>
            )}
          </Card>

          <Card as="section">
            <button
              type="button"
              className={styles.collapseToggle}
              aria-expanded={showCategories}
              onClick={() => setShowCategories(value => !value)}
            >
              <span>
                <strong>카테고리 연결</strong>
                <small>{mappedCount}개 연결됨 · 부부 공통 설정</small>
              </span>
              <span aria-hidden="true">{showCategories ? "⌃" : "⌄"}</span>
            </button>
            {showCategories && summary.incomeCategories.length > 0 && (
              <>
                <h3 className={styles.categoryGroupTitle}>수입 · 급여로 볼 카테고리</h3>
                <p className={styles.hint}>'자동'은 이름에 급여·월급·상여·보너스·성과급이 들어가면 급여로 봐요.</p>
                <ul className={styles.categoryList}>
                  {summary.incomeCategories.map(category => (
                    <li key={category.categoryId}>
                      <span>
                        {category.name}
                        {category.countedAsSalary && <small className={styles.salaryTag}>급여</small>}
                      </span>
                      <select
                        value={category.taxCode}
                        disabled={savingCategoryId === category.categoryId}
                        onChange={event => void handleCategoryChange(category.categoryId, event.target.value)}
                      >
                        {summary.incomeTaxCodes.map(option => (
                          <option key={option.code} value={option.code}>{option.label}</option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
                <h3 className={styles.categoryGroupTitle}>지출 · 공제 분류</h3>
              </>
            )}
            {showCategories && (
              <ul className={styles.categoryList}>
                {summary.categories.map(category => (
                  <li key={category.categoryId}>
                    <span>{category.name}</span>
                    <select
                      value={category.taxCode}
                      disabled={savingCategoryId === category.categoryId}
                      onChange={event => void handleCategoryChange(category.categoryId, event.target.value)}
                    >
                      {summary.taxCodes.map(option => (
                        <option key={option.code} value={option.code}>{option.label}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className={styles.footnote}>
            계산 기준: 총급여 25% 초과 사용분에 신용카드 15%, 체크카드·선불·지역화폐 30%, 전통시장·대중교통 40%,
            도서·공연·헬스장 등 30%(총급여 7천만 원 이하). 현금·계좌이체는 현금영수증 여부를 알 수 없어 넣지 않았어요.
            해외 사용, 신차 구입, 공과금·통신비 등은 '카드공제 제외'로 연결하세요.
          </p>
        </>
      )}
    </main>
  );
}
