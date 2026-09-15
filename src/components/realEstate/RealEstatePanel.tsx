import { useEffect, useMemo, useState } from "react";

import {
  deleteRealEstateAsset,
  getRealEstateAssets,
  refreshRealEstateAsset,
  saveRealEstateAsset,
  searchLegalRegions,
  type LegalRegionCandidate,
  type RealEstateAsset
} from "../../api/realEstate";
import { Button } from "../common/Button/Button";
import { Card } from "../common/Card/Card";
import { Money, formatMoney } from "../common/Money/Money";
import { confirmAction } from "../../utils/confirmAction";
import { markLedgerChanged, subscribeLedgerChanges } from "../../utils/ledgerEvents";

import styles from "./RealEstatePanel.module.css";

interface RealEstatePanelProps {
  userName: string;
  owners: string[];
  onChanged?: () => void;
}

type FormState = {
  propertyId?: string;
  name: string;
  address: string;
  lawdCode: string;
  apartmentName: string;
  exclusiveAreaSqm: string;
  floor: string;
  owner: string;
  purchasePriceKrw: string;
  valuationMode: "auto" | "manual";
  manualValueKrw: string;
};

function emptyForm(userName: string): FormState {
  return {
    name: "우리집",
    address: "",
    lawdCode: "",
    apartmentName: "",
    exclusiveAreaSqm: "",
    floor: "",
    owner: userName || "공동",
    purchasePriceKrw: "",
    valuationMode: "auto",
    manualValueKrw: ""
  };
}

function toNumber(value: string) {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toForm(item: RealEstateAsset): FormState {
  return {
    propertyId: item.propertyId,
    name: item.name,
    address: item.address,
    lawdCode: item.lawdCode,
    apartmentName: item.apartmentName,
    exclusiveAreaSqm: String(item.exclusiveAreaSqm || ""),
    floor: item.floor === null ? "" : String(item.floor),
    owner: item.owner || "공동",
    purchasePriceKrw: item.purchasePriceKrw ? String(item.purchasePriceKrw) : "",
    valuationMode: item.valuationMode,
    manualValueKrw: item.manualValueKrw ? String(item.manualValueKrw) : ""
  };
}

function formatUpdated(value: string | null) {
  if (!value) return "아직 갱신되지 않음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

export function RealEstatePanel({ userName, owners, onChanged }: RealEstatePanelProps) {
  const [items, setItems] = useState<RealEstateAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState("");
  const [regionResults, setRegionResults] = useState<LegalRegionCandidate[]>([]);
  const [regionLoading, setRegionLoading] = useState(false);
  const [message, setMessage] = useState("");

  const ownerOptions = useMemo(() => {
    const values = new Set([userName, "공동", ...owners].filter(Boolean));
    return Array.from(values);
  }, [owners, userName]);

  async function load() {
    try {
      setLoading(true);
      setError("");
      const data = await getRealEstateAssets();
      setItems(data.items || []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "부동산 자산을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return subscribeLedgerChanges(() => {
      void load();
    });
  }, []);

  async function handleSearchRegion() {
    if (!form?.address.trim()) {
      setMessage("주소를 먼저 입력해주세요.");
      return;
    }
    try {
      setRegionLoading(true);
      setMessage("");
      const results = await searchLegalRegions(form.address.trim());
      setRegionResults(results);
      if (results.length === 1) {
        setForm(current => current ? { ...current, lawdCode: results[0].lawdCode } : current);
      }
      if (results.length === 0) setMessage("일치하는 법정동을 찾지 못했습니다.");
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "주소 검색에 실패했습니다.");
    } finally {
      setRegionLoading(false);
    }
  }

  async function handleSave() {
    if (!form) return;
    if (!form.name.trim() || !form.address.trim() || !form.apartmentName.trim()) {
      setMessage("자산명, 주소, 아파트명을 입력해주세요.");
      return;
    }
    if (form.valuationMode === "auto" && !/^\d{5}$/.test(form.lawdCode)) {
      setMessage("자동 시세를 사용하려면 주소 검색으로 지역코드 5자리를 선택해주세요.");
      return;
    }
    const area = toNumber(form.exclusiveAreaSqm);
    if (area <= 0) {
      setMessage("전용면적을 입력해주세요.");
      return;
    }
    if (form.valuationMode === "manual" && toNumber(form.manualValueKrw) <= 0) {
      setMessage("수동 평가액을 입력해주세요.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");
      const saved = await saveRealEstateAsset({
        propertyId: form.propertyId,
        name: form.name.trim(),
        address: form.address.trim(),
        lawdCode: form.lawdCode,
        apartmentName: form.apartmentName.trim(),
        exclusiveAreaSqm: area,
        floor: form.floor.trim() ? Math.trunc(toNumber(form.floor)) : null,
        owner: form.owner || "공동",
        purchasePriceKrw: toNumber(form.purchasePriceKrw),
        valuationMode: form.valuationMode,
        manualValueKrw: form.valuationMode === "manual" ? toNumber(form.manualValueKrw) : null
      });
      setForm(null);
      setRegionResults([]);
      await load();
      markLedgerChanged();
      onChanged?.();

      if (saved.item.valuationMode === "auto") {
        try {
          setRefreshingId(saved.item.propertyId);
          await refreshRealEstateAsset(saved.item.propertyId);
          await load();
          markLedgerChanged();
          onChanged?.();
        } catch (refreshError) {
          setMessage(refreshError instanceof Error ? refreshError.message : "저장은 완료됐지만 자동 시세 갱신에 실패했습니다.");
        } finally {
          setRefreshingId("");
        }
      }
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "부동산 자산을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh(item: RealEstateAsset) {
    try {
      setRefreshingId(item.propertyId);
      setMessage("");
      await refreshRealEstateAsset(item.propertyId);
      await load();
      markLedgerChanged();
      onChanged?.();
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "시세 갱신에 실패했습니다.");
    } finally {
      setRefreshingId("");
    }
  }

  async function handleDelete(item: RealEstateAsset) {
    const okay = await confirmAction({
      title: "부동산 자산 삭제",
      message: `‘${item.name}’을 삭제할까요?`,
      confirmLabel: "삭제",
      tone: "danger"
    });
    if (!okay) return;
    try {
      await deleteRealEstateAsset(item.propertyId);
      await load();
      markLedgerChanged();
      onChanged?.();
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "삭제하지 못했습니다.");
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <div>
          <h2>부동산</h2>
          <p>아파트 평가액을 순자산에 포함합니다.</p>
        </div>
        <Button size="sm" onClick={() => { setForm(emptyForm(userName)); setRegionResults([]); setMessage(""); }}>
          아파트 추가
        </Button>
      </div>

      {message && <p className={styles.message}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.muted}>불러오는 중입니다.</p>}
      {!loading && items.length === 0 && <p className={styles.muted}>등록된 부동산 자산이 없습니다.</p>}

      <div className={styles.list}>
        {items.map(item => (
          <Card key={item.propertyId} padding="md" className={styles.assetCard}>
            <div className={styles.assetTop}>
              <div>
                <strong className={styles.assetName}>{item.name}</strong>
                <span className={styles.assetMeta}>{item.apartmentName} · {item.exclusiveAreaSqm}㎡{item.floor !== null ? ` · ${item.floor}층` : ""}</span>
              </div>
              <strong className={styles.value}><Money amount={item.currentValueKrw} absolute /></strong>
            </div>
            <div className={styles.details}>
              <span>{item.valuationMode === "manual" ? "수동 평가액" : `자동 추정 · ${item.estimateTradeCount}건 기준`}</span>
              {item.valuationMode === "auto" && item.estimateTradeCount > 0 && (
                <span>최근 범위 {formatMoney(item.estimateLowKrw)} ~ {formatMoney(item.estimateHighKrw)}</span>
              )}
              <span>{item.owner || "공동"} · {item.address}</span>
              <span>시세 갱신 {formatUpdated(item.estimateUpdatedAt)}</span>
            </div>
            {item.recentTrades?.length > 0 && (
              <div className={styles.trades}>
                {item.recentTrades.slice(0, 3).map((trade, index) => (
                  <span key={`${trade.date}-${trade.amountKrw}-${index}`}>{trade.date} · {formatMoney(trade.amountKrw)} · {trade.floor ?? "-"}층</span>
                ))}
              </div>
            )}
            <div className={styles.actions}>
              {item.valuationMode === "auto" && (
                <Button variant="secondary" size="sm" loading={refreshingId === item.propertyId} onClick={() => void handleRefresh(item)}>시세 갱신</Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => { setForm(toForm(item)); setRegionResults([]); setMessage(""); }}>수정</Button>
              <Button variant="danger" size="sm" onClick={() => void handleDelete(item)}>삭제</Button>
            </div>
          </Card>
        ))}
      </div>

      {form && (
        <Card as="section" padding="md" className={styles.formCard}>
          <div className={styles.formHeading}>
            <h3>{form.propertyId ? "아파트 수정" : "아파트 등록"}</h3>
            <Button variant="ghost" size="sm" onClick={() => setForm(null)}>닫기</Button>
          </div>
          <div className={styles.formGrid}>
            <label><span>자산명</span><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
            <label><span>아파트명</span><input value={form.apartmentName} onChange={event => setForm({ ...form, apartmentName: event.target.value })} /></label>
            <label className={styles.full}><span>주소</span><div className={styles.inline}><input value={form.address} onChange={event => setForm({ ...form, address: event.target.value, lawdCode: "" })} placeholder="예: 세종특별자치시 ..." /><Button variant="secondary" size="sm" loading={regionLoading} onClick={() => void handleSearchRegion()}>주소 찾기</Button></div></label>
            {regionResults.length > 0 && <div className={`${styles.regionResults} ${styles.full}`}>{regionResults.slice(0, 12).map(region => <button type="button" key={region.fullCode} onClick={() => { setForm({ ...form, lawdCode: region.lawdCode }); setRegionResults([]); }}>{region.name}<small>{region.lawdCode}</small></button>)}</div>}
            <label><span>지역코드</span><input inputMode="numeric" maxLength={5} value={form.lawdCode} onChange={event => setForm({ ...form, lawdCode: event.target.value.replace(/\D/g, "").slice(0,5) })} /></label>
            <label><span>전용면적(㎡)</span><input inputMode="decimal" value={form.exclusiveAreaSqm} onChange={event => setForm({ ...form, exclusiveAreaSqm: event.target.value })} /></label>
            <label><span>층</span><input inputMode="numeric" value={form.floor} onChange={event => setForm({ ...form, floor: event.target.value })} /></label>
            <label><span>명의</span><select value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })}>{ownerOptions.map(owner => <option key={owner} value={owner}>{owner}</option>)}</select></label>
            <label><span>취득가(원)</span><input inputMode="numeric" value={form.purchasePriceKrw} onChange={event => setForm({ ...form, purchasePriceKrw: event.target.value.replace(/[^0-9]/g, "") })} /></label>
            <label><span>평가 방식</span><select value={form.valuationMode} onChange={event => setForm({ ...form, valuationMode: event.target.value as "auto" | "manual" })}><option value="auto">실거래 자동 추정</option><option value="manual">직접 평가액</option></select></label>
            {form.valuationMode === "manual" && <label><span>평가액(원)</span><input inputMode="numeric" value={form.manualValueKrw} onChange={event => setForm({ ...form, manualValueKrw: event.target.value.replace(/[^0-9]/g, "") })} /></label>}
          </div>
          <div className={styles.formActions}>
            <Button variant="secondary" onClick={() => setForm(null)}>취소</Button>
            <Button loading={saving} onClick={() => void handleSave()}>저장</Button>
          </div>
        </Card>
      )}
    </section>
  );
}
