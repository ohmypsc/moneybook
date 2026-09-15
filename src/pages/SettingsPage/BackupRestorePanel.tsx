import { useRef, useState } from "react";

import { createMoneybookBackup } from "../../api/dataBackup";
import type { MoneybookBackupDocument } from "../../api/dataBackupFormat";
import {
  parseMoneybookBackupText,
  previewMoneybookBackup,
  restoreMoneybookBackup,
  type BackupRestorePreview
} from "../../api/dataRestore";
import { clearBootstrapMemoryCache } from "../../api/bootstrapCache";
import {
  clearDashboardPersistentSnapshot,
  invalidateDashboardCache
} from "../../api/dashboard";
import { clearInvestmentPrefetchCache } from "../../api/investments";
import { clearManagedSettingsCache } from "../../api/settingsManagement";
import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import { confirmAction } from "../../utils/confirmAction";
import { getSeoulFileDate } from "../../utils/dateTime";
import { markLedgerChanged } from "../../utils/ledgerEvents";
import styles from "./SettingsPage.module.css";

const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function downloadBackup(
  backup: MoneybookBackupDocument,
  filenamePrefix: string
) {
  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json;charset=utf-8" }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenamePrefix}_${getSeoulFileDate()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatExportedAt(value: string | null) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function invalidateAfterRestoreAttempt() {
  clearBootstrapMemoryCache();
  clearManagedSettingsCache();
  clearInvestmentPrefetchCache();
  invalidateDashboardCache();
  clearDashboardPersistentSnapshot();
  markLedgerChanged();
}

const COUNT_ROWS: Array<{
  key: keyof BackupRestorePreview["summary"];
  label: string;
  previewKey?: string;
}> = [
  { key: "categories", label: "카테고리", previewKey: "categories" },
  { key: "accounts", label: "계좌·카드", previewKey: "accounts" },
  { key: "transactions", label: "거래", previewKey: "transactions" },
  { key: "investmentHoldings", label: "투자 보유종목", previewKey: "investmentHoldings" },
  { key: "investmentTrades", label: "투자 거래", previewKey: "investmentTrades" },
  { key: "assetSnapshots", label: "순자산 기록", previewKey: "assetSnapshots" },
  { key: "benefitRewardUsage", label: "카드 혜택 사용 누계", previewKey: "benefitRewardUsage" },
  { key: "realEstateAssets", label: "부동산 자산", previewKey: "realEstateAssets" }
];

export function BackupRestorePanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [selectedBackup, setSelectedBackup] = useState<MoneybookBackupDocument | null>(null);
  const [preview, setPreview] = useState<BackupRestorePreview | null>(null);

  async function handleBackup() {
    setBusyKey("backup");
    setError("");
    setFeedback("");
    try {
      const backup = await createMoneybookBackup();
      downloadBackup(backup, "우리_가계부_전체백업");
      setFeedback(
        `전체 백업을 저장했습니다. 거래 ${backup.payload.transactions.length.toLocaleString("ko-KR")}건이 포함되었습니다.`
      );
    } catch (backupError) {
      setError(getErrorMessage(backupError, "전체 백업을 만들지 못했습니다."));
    } finally {
      setBusyKey("");
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setBusyKey("preview");
    setError("");
    setFeedback("");
    setPreview(null);
    setSelectedBackup(null);
    setSelectedName(file.name);

    try {
      if (file.size > MAX_BACKUP_FILE_BYTES) {
        throw new Error("백업 파일이 너무 큽니다. 25MB 이하 파일을 선택해주세요.");
      }
      const text = await file.text();
      const backup = parseMoneybookBackupText(text);
      const nextPreview = await previewMoneybookBackup(backup);
      setSelectedBackup(backup);
      setPreview(nextPreview);
      setFeedback("백업 파일 검증이 끝났습니다. 아래 내용을 확인한 뒤 복원할 수 있습니다.");
    } catch (fileError) {
      setError(getErrorMessage(fileError, "백업 파일을 확인하지 못했습니다."));
      setSelectedName("");
    } finally {
      setBusyKey("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRestore() {
    if (!selectedBackup || !preview || busyKey) return;

    const confirmed = await confirmAction({
      title: "전체 데이터 병합 복원",
      message:
        `백업의 거래 ${preview.summary.transactions.toLocaleString("ko-KR")}건과 계좌 ${preview.summary.accounts.toLocaleString("ko-KR")}개를 현재 가계부에 병합합니다. ` +
        "같은 ID는 백업 값으로 갱신되고, 백업에 없는 현재 데이터는 삭제하지 않습니다. 계속할까요?",
      confirmLabel: "안전백업 후 복원",
      tone: "danger"
    });
    if (!confirmed) return;

    setBusyKey("restore");
    setError("");
    setFeedback("현재 상태의 안전백업을 만드는 중입니다.");

    try {
      const safetyBackup = await createMoneybookBackup();
      downloadBackup(safetyBackup, "우리_가계부_복원전_안전백업");

      setFeedback("안전백업을 만들었습니다. 선택한 백업을 복원하는 중입니다.");
      const result = await restoreMoneybookBackup(selectedBackup);

      invalidateAfterRestoreAttempt();

      setSelectedBackup(null);
      setPreview(null);
      setSelectedName("");
      setFeedback(
        `복원이 완료되었습니다. 거래 ${result.summary.transactions.toLocaleString("ko-KR")}건을 포함한 백업 데이터를 병합했습니다. 최신 상태로 다시 불러옵니다.`
      );
      window.setTimeout(() => window.location.reload(), 600);
    } catch (restoreError) {
      invalidateAfterRestoreAttempt();
      setError(
        `${getErrorMessage(restoreError, "백업을 복원하지 못했습니다.")} 안전백업을 보관한 채 현재 데이터를 다시 확인해주세요.`
      );
      setFeedback("");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <Card as="section">
      <div className={styles.sectionHeading}>
        <h2>전체 백업 · 복원</h2>
        <p>
          JSON 백업은 계좌·카테고리·거래·투자·부동산·설정·카드 혜택 사용 누계까지 보관합니다.
          복원은 현재 데이터에 안전하게 병합합니다.
        </p>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {feedback && <p className={styles.feedback}>{feedback}</p>}

      <div className={styles.backupActions}>
        <Button
          fullWidth
          disabled={Boolean(busyKey)}
          loading={busyKey === "backup"}
          loadingLabel="백업 만드는 중"
          onClick={() => void handleBackup()}
        >
          전체 데이터 JSON 백업
        </Button>

        <Button
          variant="secondary"
          fullWidth
          disabled={Boolean(busyKey)}
          loading={busyKey === "preview"}
          loadingLabel="파일 검증 중"
          onClick={() => fileInputRef.current?.click()}
        >
          JSON 백업 파일 선택
        </Button>
      </div>

      <input
        ref={fileInputRef}
        className={styles.hiddenFileInput}
        type="file"
        accept="application/json,.json"
        onChange={event => void handleFile(event.currentTarget.files?.[0] ?? null)}
      />

      {preview && selectedBackup && (
        <div className={styles.restorePreview}>
          <div className={styles.restorePreviewHeader}>
            <strong>{selectedName}</strong>
            <span>
              백업 v{preview.version} · {formatExportedAt(preview.exportedAt)}
            </span>
          </div>

          <div className={styles.restoreCountGrid}>
            {COUNT_ROWS.map(({ key, label, previewKey }) => {
              const total = preview.summary[key];
              const existing = previewKey ? (preview.existing[previewKey] ?? 0) : 0;
              const additions = previewKey ? (preview.additions[previewKey] ?? 0) : 0;
              return (
                <div key={key} className={styles.restoreCountItem}>
                  <span>{label}</span>
                  <strong>{total.toLocaleString("ko-KR")}</strong>
                  {previewKey && total > 0 && (
                    <small>
                      기존 {existing.toLocaleString("ko-KR")} · 신규 {additions.toLocaleString("ko-KR")}
                    </small>
                  )}
                </div>
              );
            })}
          </div>

          {preview.warnings.length > 0 && (
            <div className={styles.restoreWarning}>
              {preview.warnings.map(warning => <p key={warning}>{warning}</p>)}
            </div>
          )}

          <ul className={styles.restoreNotes}>
            {preview.notes.map(note => <li key={note}>{note}</li>)}
          </ul>

          <Button
            variant="danger"
            fullWidth
            disabled={Boolean(busyKey)}
            loading={busyKey === "restore"}
            loadingLabel="복원 중"
            onClick={() => void handleRestore()}
          >
            안전백업 후 병합 복원 실행
          </Button>
        </div>
      )}
    </Card>
  );
}
