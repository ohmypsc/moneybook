import { useEffect, useMemo, useState } from "react";

import {
  deleteRealEstateAsset,
  getRealEstateAssets,
  refreshRealEstateAsset,
  saveRealEstateAsset,
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
    name: item.name || "우리집",
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
  if (!value) return "아직 갱신 전";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

function formatArea(value: number) {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function RealEstatePanel({ userName, owners, onChanged }: RealEstatePanelProps) {
  const [items, setItems] = useState<RealEstateAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState("");
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
      setError(nextError instanceof Error ? nextError.message : "우리집 정보를 불러오지 못했습니다.");
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

  async function handleSave() {
    if (!form) return;
    if (!form.apartmentName.trim() || !form.address.trim()) {
      setMessage("아파트명과 지역을 입력해주세요.");
      return;
    }

    const area = toNumber(form.exclusiveAreaSqm);
    if (area <= 0) {
      setMessage("전용면적을 입력해주세요.");
      return;
    }

    if (form.valuationMode === "auto" && !/^\d{5}$/.test(form.lawdCode)) {
      setMessage("자동 시세 조회를 위해 국토부 지역코드 5자리를 입력해주세요.");
      return;
    }

    if (form.valuationMode === "manual" && toNumber(form.manualValueKrw) <= 0) {
      setMessage("직접 평가액을 입력해주세요.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");
      const saved = await saveRealEstateAsset({
        propertyId: form.propertyId,
        name: "우리집",
        address: form.address.trim(),
        lawdCode: form.valuationMode === "auto" ? form.lawdCode : form.lawdCode.trim(),
        apartmentName: form.apartmentName.trim(),
        exclusiveAreaSqm: area,
        floor: form.floor.trim() ? Math.trunc(toNumber(form.floor)) : null,
        owner: form.owner || "공동",
        purchasePriceKrw: toNumber(form.purchasePriceKrw),
        valuationMode: form.valuationMode,
        manualValueKrw: form.valuationMode === "manual" ? toNumber(form.manualValueKrw) : null
      });

      setForm(null);
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
          setMessage(refreshError instanceof Error ? refreshError.message : "등록은 완료됐지만 실거래 시세 갱신에 실패했습니다.");
        } finally {
          setRefreshingId("");
        }
      }
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "우리집 정보를 저장하지 못했습니다.");
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
      setMessage(nextError instanceof Error ? nextError.message : "실거래 시세를 갱신하지 못했습니다.");
    } finally {
      setRefreshingId("");
    }
  }

  async function handleDelete(item: RealEstateAsset) {
    const okay = await confirmAction({
      title: "우리집 정보 삭제",
      message: `‘${item.apartmentName}’ 정보를 삭제할까요?`,
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
      setMessage(nextError instanceof Error ? nextError.message : "우리집 정보를 삭제하지 못했습니다.");
    }
  }

  const editingItem = form?.propertyId ? items.find(item => item.propertyId === form.propertyId) : undefined;

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <div>
          <h2>우리집</h2>
          <p>한 번 등록하면 최근 실거래를 바탕으로 자산가치를 갱신합니다.</p>
        </div>
      </div>

      {message && <p className={styles.message}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.muted}>불러오는 중입니다.</p>}

      {!loading && items.length === 0 && !form && (
        <Card as="section" padding="lg" tone="soft" className={styles.emptyCard}>
          <div className={styles.homeIcon} aria-hidden="true">⌂</div>
          <div className={styles.emptyCopy}>
            <strong>내 집 한 채만 등록해두세요.</strong>
            <p>아파트명과 전용면적을 저장하면 이후에는 이 화면에서 시세만 확인하면 됩니다.</p>
          </div>
          <Button onClick={() => { setForm(emptyForm(userName)); setMessage(""); }}>
            내 집 등록
          </Button>
        </Card>
      )}

      <div className={styles.list}>
        {items.map(item => {
          const purchaseDelta = item.purchasePriceKrw > 0 && item.currentValueKrw > 0
            ? item.currentValueKrw - item.purchasePriceKrw
            : null;

          return (
            <Card key={item.propertyId} padding="lg" className={styles.assetCard}>
              <div className={styles.assetHeader}>
                <div className={styles.assetIdentity}>
                  <span className={styles.homeBadge}>우리집</span>
                  <strong className={styles.assetName}>{item.apartmentName}</strong>
                  <span className={styles.assetMeta}>
                    {item.address} · {formatArea(item.exclusiveAreaSqm)}㎡{item.floor !== null ? ` · ${item.floor}층` : ""}
                  </span>
                </div>
                <div className={styles.priceBlock}>
                  <span>현재 {item.valuationMode === "manual" ? "평가액" : "추정가"}</span>
                  <strong className={styles.value}><Money amount={item.currentValueKrw} absolute /></strong>
                </div>
              </div>

              <div className={styles.summaryGrid}>
                <div>
                  <span className={styles.summaryLabel}>평가 기준</span>
                  <strong>{item.valuationMode === "manual" ? "직접 입력" : `최근 실거래 ${item.estimateTradeCount}건`}</strong>
                </div>
                {item.valuationMode === "auto" && item.estimateTradeCount > 0 && (
                  <div>
                    <span className={styles.summaryLabel}>최근 거래 범위</span>
                    <strong>{formatMoney(item.estimateLowKrw)} ~ {formatMoney(item.estimateHighKrw)}</strong>
                  </div>
                )}
                {purchaseDelta !== null && (
                  <div>
                    <span className={styles.summaryLabel}>취득가 대비</span>
                    <strong className={purchaseDelta >= 0 ? styles.positive : styles.negative}>
                      {formatMoney(purchaseDelta, { showPlus: true })}
                    </strong>
                  </div>
                )}
                <div>
                  <span className={styles.summaryLabel}>마지막 갱신</span>
                  <strong>{formatUpdated(item.estimateUpdatedAt)}</strong>
                </div>
              </div>

              {item.recentTrades?.length > 0 && (
                <div className={styles.trades}>
                  <span className={styles.tradeTitle}>최근 실거래</span>
                  {item.recentTrades.slice(0, 3).map((trade, index) => (
                    <div key={`${trade.date}-${trade.amountKrw}-${index}`} className={styles.tradeRow}>
                      <span>{trade.date}</span>
                      <strong>{formatMoney(trade.amountKrw)}</strong>
                      <span>{trade.floor ?? "-"}층</span>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.actions}>
                {item.valuationMode === "auto" && (
                  <Button variant="secondary" size="sm" loading={refreshingId === item.propertyId} onClick={() => void handleRefresh(item)}>
                    시세 새로고침
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => { setForm(toForm(item)); setMessage(""); }}>
                  정보 수정
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {form && (
        <Card as="section" padding="lg" className={styles.formCard}>
          <div className={styles.formHeading}>
            <div>
              <h3>{form.propertyId ? "우리집 정보 수정" : "내 집 등록"}</h3>
              <p>처음 한 번만 입력하면 됩니다.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setForm(null)}>닫기</Button>
          </div>

          <div className={styles.coreFields}>
            <label>
              <span>아파트명</span>
              <input
                autoFocus={!form.propertyId}
                value={form.apartmentName}
                onChange={event => setForm({ ...form, apartmentName: event.target.value })}
                placeholder="예: 두루마을 1단지"
              />
            </label>
            <div className={styles.splitFields}>
              <label>
                <span>지역(시·군·구)</span>
                <input
                  value={form.address}
                  onChange={event => setForm({ ...form, address: event.target.value })}
                  placeholder="예: 세종특별자치시"
                />
              </label>
              <label>
                <span>전용면적(㎡)</span>
                <input
                  inputMode="decimal"
                  value={form.exclusiveAreaSqm}
                  onChange={event => setForm({ ...form, exclusiveAreaSqm: event.target.value })}
                  placeholder="예: 84.95"
                />
              </label>
            </div>

            {form.valuationMode === "auto" && (
              <label>
                <span>국토부 지역코드</span>
                <input
                  inputMode="numeric"
                  maxLength={5}
                  value={form.lawdCode}
                  onChange={event => setForm({ ...form, lawdCode: event.target.value.replace(/\D/g, "").slice(0, 5) })}
                  placeholder="5자리"
                />
                <small>실거래 조회에 필요한 시·군·구 코드입니다. 한 번 저장하면 다시 입력하지 않습니다.</small>
              </label>
            )}
          </div>

          <details className={styles.optionalDetails}>
            <summary>추가 정보 <span>선택</span></summary>
            <div className={styles.formGrid}>
              <label>
                <span>층</span>
                <input inputMode="numeric" value={form.floor} onChange={event => setForm({ ...form, floor: event.target.value })} />
              </label>
              <label>
                <span>명의</span>
                <select value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })}>
                  {ownerOptions.map(owner => <option key={owner} value={owner}>{owner}</option>)}
                </select>
              </label>
              <label>
                <span>취득가(원)</span>
                <input inputMode="numeric" value={form.purchasePriceKrw} onChange={event => setForm({ ...form, purchasePriceKrw: event.target.value.replace(/[^0-9]/g, "") })} />
              </label>
              <label>
                <span>평가 방식</span>
                <select value={form.valuationMode} onChange={event => setForm({ ...form, valuationMode: event.target.value as "auto" | "manual" })}>
                  <option value="auto">실거래 자동 추정</option>
                  <option value="manual">직접 평가액 입력</option>
                </select>
              </label>
              {form.valuationMode === "manual" && (
                <label className={styles.full}>
                  <span>현재 평가액(원)</span>
                  <input inputMode="numeric" value={form.manualValueKrw} onChange={event => setForm({ ...form, manualValueKrw: event.target.value.replace(/[^0-9]/g, "") })} />
                </label>
              )}
            </div>
          </details>

          <div className={styles.formActions}>
            {editingItem && (
              <Button variant="dangerSoft" onClick={() => void handleDelete(editingItem)}>
                삭제
              </Button>
            )}
            <span className={styles.actionSpacer} />
            <Button variant="secondary" onClick={() => setForm(null)}>취소</Button>
            <Button loading={saving} onClick={() => void handleSave()}>저장</Button>
          </div>
        </Card>
      )}
    </section>
  );
}
