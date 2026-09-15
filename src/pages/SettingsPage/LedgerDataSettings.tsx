import { useEffect, useState } from "react";

import { getTransactions } from "../../api/transactions";
import { createMoneybookBackup } from "../../api/dataBackup";
import type { Transaction } from "../../api/transactions";
import { restoreTransaction } from "../../api/transactionMutations";
import {
  clearLedgerStartDate,
  getLedgerConfig,
  setLedgerStartDate
} from "../../api/settingsManagement";
import { markLedgerChanged } from "../../utils/ledgerEvents";
import { getSeoulFileDate } from "../../utils/dateTime";
import { confirmAction } from "../../utils/confirmAction";
import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import { formatMoney } from "../../components/common/Money/Money";
import styles from "./SettingsPage.module.css";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function csvCell(value: unknown) {
  const rawText = value === null || value === undefined ? "" : String(value);
  const text = typeof value === "number" || !/^[=+@-]/.test(rawText)
    ? rawText
    : `'${rawText}`;

  return `"${text.replace(/"/g, '""')}"`;
}

export function LedgerDataSettings() {
    const [
        ledgerStartDateValue,
        setLedgerStartDateValue
    ] =
        useState("");

    const [
        loading,
        setLoading
    ] =
        useState(
            true
        );

    const [
        busyKey,
        setBusyKey
    ] =
        useState("");

    const [
        error,
        setError
    ] =
        useState("");

    const [
        feedback,
        setFeedback
    ] =
        useState("");

    const [
        deletedTransactions,
        setDeletedTransactions
    ] =
        useState<Transaction[]>([]);

    const [
        trashLoaded,
        setTrashLoaded
    ] =
        useState(false);

    const [
        trashLoading,
        setTrashLoading
    ] =
        useState(false);

    const [
        restoringTransactionId,
        setRestoringTransactionId
    ] =
        useState("");


    useEffect(
        () => {
            let active =
                true;

            async function load() {
                setLoading(
                    true
                );

                try {
                    const result =
                        await getLedgerConfig();

                    if (
                        active
                    ) {
                        setLedgerStartDateValue(
                            result.ledgerStartDate ||
                                ""
                        );
                    }
                } catch (
                    loadError
                ) {
                    if (
                        active
                    ) {
                        setError(
                            getErrorMessage(
                                loadError,
                                "가계부 설정을 불러오지 못했습니다."
                            )
                        );
                    }
                } finally {
                    if (
                        active
                    ) {
                        setLoading(
                            false
                        );
                    }
                }
            }

            void load();

            return () => {
                active =
                    false;
            };
        },
        []
    );


    async function handleSaveStartDate() {
        if (
            !ledgerStartDateValue
        ) {
            setError(
                "가계부 시작일을 선택해주세요."
            );

            return;
        }

        setBusyKey(
            "start-date"
        );

        try {
            const result =
                await setLedgerStartDate(
                    ledgerStartDateValue
                );

            setLedgerStartDateValue(
                result.ledgerStartDate ||
                ledgerStartDateValue
            );

            setFeedback(
                "가계부 시작일을 저장했습니다."
            );
        } catch (
            saveError
        ) {
            setError(
                getErrorMessage(
                    saveError,
                    "가계부 시작일을 저장하지 못했습니다."
                )
            );
        } finally {
            setBusyKey(
                ""
            );
        }
    }


    async function handleClearStartDate() {
        if (
            !(await confirmAction({
                title:
                    "가계부 시작일 해제",
                message:
                    "가계부 시작일 제한을 해제할까요?",
                confirmLabel:
                    "해제"
            }))
        ) {
            return;
        }

        setBusyKey(
            "clear-date"
        );

        try {
            await clearLedgerStartDate();

            setLedgerStartDateValue(
                ""
            );

            setFeedback(
                "가계부 시작일 제한을 해제했습니다."
            );
        } catch (
            clearError
        ) {
            setError(
                getErrorMessage(
                    clearError,
                    "가계부 시작일을 해제하지 못했습니다."
                )
            );
        } finally {
            setBusyKey(
                ""
            );
        }
    }


    async function loadDeletedTransactions(
        force = false
    ) {
        if (
            trashLoading ||
            (trashLoaded && !force)
        ) {
            return;
        }

        setTrashLoading(true);
        setError("");

        try {
            const items: Transaction[] = [];
            let offset = 0;
            const limit = 1000;
            let total = 0;

            do {
                const response =
                    await getTransactions({
                        includeDeleted: true,
                        limit,
                        offset
                    });

                total =
                    response.data.total;

                items.push(
                    ...response.data.items
                );

                offset +=
                    response.data.items.length;

                if (
                    response.data.items.length === 0
                ) {
                    break;
                }
            } while (
                offset < total
            );

            setDeletedTransactions(
                items
                    .filter(
                        transaction =>
                            transaction.isDeleted
                    )
                    .sort(
                        (first, second) =>
                            String(
                                second.deletedAt ||
                                second.updatedAt ||
                                second.date
                            ).localeCompare(
                                String(
                                    first.deletedAt ||
                                    first.updatedAt ||
                                    first.date
                                )
                            )
                    )
            );

            setTrashLoaded(true);
        } catch (
            loadError
        ) {
            setError(
                getErrorMessage(
                    loadError,
                    "삭제한 거래를 불러오지 못했습니다."
                )
            );
        } finally {
            setTrashLoading(false);
        }
    }


    async function handleRestoreDeletedTransaction(
        transaction: Transaction
    ) {
        if (
            restoringTransactionId
        ) {
            return;
        }

        const title =
            transaction.description ||
            transaction.category ||
            transaction.type;

        if (
            !(await confirmAction({
                title:
                    "거래 복원",
                message:
                    `${transaction.date} ${title} ${formatMoney(transaction.amount)} 거래를 복원할까요?`,
                confirmLabel:
                    "복원"
            }))
        ) {
            return;
        }

        setRestoringTransactionId(
            transaction.transactionId
        );
        setError("");
        setFeedback("");

        try {
            await restoreTransaction(
                transaction.transactionId
            );

            setDeletedTransactions(
                current =>
                    current.filter(
                        item =>
                            item.transactionId !==
                            transaction.transactionId
                    )
            );

            setFeedback(
                "삭제한 거래를 복원했습니다."
            );

            markLedgerChanged();
        } catch (
            restoreError
        ) {
            setError(
                getErrorMessage(
                    restoreError,
                    "거래를 복원하지 못했습니다."
                )
            );
        } finally {
            setRestoringTransactionId("");
        }
    }


    async function handleExport() {
        setBusyKey(
            "export"
        );

        try {
            const items:
                Transaction[] = [];

            let offset =
                0;

            const limit =
                1000;

            let total =
                0;

            do {
                const response =
                    await getTransactions({
                        limit,
                        offset
                    });

                total =
                    response.data.total;

                items.push(
                    ...response
                        .data
                        .items
                );

                offset +=
                    response
                        .data
                        .items
                        .length;

                if (
                    response
                        .data
                        .items
                        .length ===
                    0
                ) {
                    break;
                }
            } while (
                offset <
                total
            );

            const headers = [
                "거래ID",
                "날짜",
                "유형",
                "카테고리",
                "금액",
                "출금계좌",
                "입금계좌",
                "결제수단",
                "지출대상",
                "메모",
                "청구월",
                "입력자",
                "수정자",
                "입력시각",
                "수정시각"
            ];

            const rows =
                items.map(
                    transaction => [
                        transaction.transactionId,
                        transaction.date,
                        transaction.type,
                        transaction.category,
                        transaction.amount,
                        transaction.fromAccount ||
                            "",
                        transaction.toAccount ||
                            "",
                        transaction.paymentMethod ||
                            "",
                        transaction.spendingTarget ||
                            "",
                        transaction.memo,
                        transaction.billingMonth ||
                            "",
                        transaction.createdBy,
                        transaction.updatedBy,
                        transaction.createdAt ||
                            "",
                        transaction.updatedAt ||
                            ""
                    ]
                );

            const csv =
                [
                    headers,
                    ...rows
                ]
                    .map(
                        row =>
                            row
                                .map(
                                    csvCell
                                )
                                .join(
                                    ","
                                )
                    )
                    .join(
                        "\r\n"
                    );

            const blob =
                new Blob(
                    [
                        "\uFEFF",
                        csv
                    ],
                    {
                        type:
                            "text/csv;charset=utf-8"
                    }
                );

            const url =
                URL.createObjectURL(
                    blob
                );

            const link =
                document.createElement(
                    "a"
                );

            link.href =
                url;

            link.download =
                `우리_가계부_거래_${getSeoulFileDate()}.csv`;

            document.body.appendChild(
                link
            );

            link.click();

            link.remove();

            URL.revokeObjectURL(
                url
            );

            setFeedback(
                `거래 ${items.length.toLocaleString(
                    "ko-KR"
                )}건을 내보냈습니다.`
            );
        } catch (
            exportError
        ) {
            setError(
                getErrorMessage(
                    exportError,
                    "거래를 내보내지 못했습니다."
                )
            );
        } finally {
            setBusyKey(
                ""
            );
        }
    }


    async function handleJsonBackup() {
        setBusyKey("backup");
        setError("");
        setFeedback("");

        try {
            const backup = await createMoneybookBackup();
            const blob = new Blob(
                [JSON.stringify(backup, null, 2)],
                { type: "application/json;charset=utf-8" }
            );
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `우리_가계부_전체백업_${getSeoulFileDate()}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            setFeedback(
                `전체 백업을 저장했습니다. 거래 ${backup.payload.transactions.length.toLocaleString("ko-KR")}건이 포함되었습니다.`
            );
        } catch (backupError) {
            setError(
                getErrorMessage(backupError, "전체 백업을 만들지 못했습니다.")
            );
        } finally {
            setBusyKey("");
        }
    }


    return (
        <div
            className={
                styles.settingsBody
            }
        >
            {
                error && (
                    <p
                        className={
                            styles.error
                        }
                    >
                        {error}
                    </p>
                )
            }

            {
                feedback && (
                    <p
                        className={
                            styles.feedback
                        }
                    >
                        {feedback}
                    </p>
                )
            }

            <Card as="section">
                <div
                    className={
                        styles.sectionHeading
                    }
                >
                    <h2>
                        가계부 시작일
                    </h2>

                    <p>
                        이 날짜보다 이전의 거래 입력을 막아
                        실수를 방지합니다.
                    </p>
                </div>

                {
                    loading
                        ? (
                            <p
                                className={
                                    styles.state
                                }
                            >
                                가계부 설정을 불러오는 중입니다.
                            </p>
                        )
                        : (
                            <div
                                className={
                                    styles.dateSettingRow
                                }
                            >
                                <label
                                    className={
                                        styles.field
                                    }
                                >
                                    <span>
                                        시작일
                                    </span>

                                    <input
                                        type="date"
                                        value={
                                            ledgerStartDateValue
                                        }
                                        onChange={
                                            event =>
                                                setLedgerStartDateValue(
                                                    event.target.value
                                                )
                                        }
                                    />
                                </label>

                                <div
                                    className={
                                        styles.rowActions
                                    }
                                >
                                    <Button
                                        variant="secondary"
                                        disabled={
                                            Boolean(
                                                busyKey
                                            )
                                        }
                                        onClick={
                                            () =>
                                                void handleClearStartDate()
                                        }
                                    >
                                        제한 해제
                                    </Button>

                                    <Button
                                        
                                        disabled={
                                            Boolean(
                                                busyKey
                                            )
                                        }
                                        onClick={
                                            () =>
                                                void handleSaveStartDate()
                                        }
                                    >
                                        시작일 저장
                                    </Button>
                                </div>
                            </div>
                        )
                }
            </Card>

            <Card as="section">
                <div
                    className={
                        styles.sectionHeading
                    }
                >
                    <h2>
                        데이터 관리
                    </h2>

                    <p>
                        삭제한 거래는 일반 내역에서 숨기고,
                        필요할 때만 여기에서 확인하고 복원합니다.
                    </p>
                </div>

                <details
                    className={
                        styles.deletedSection
                    }
                    onToggle={
                        event => {
                            if (
                                event.currentTarget.open
                            ) {
                                void loadDeletedTransactions();
                            }
                        }
                    }
                >
                    <summary>
                        최근 삭제한 내역

                        <span>
                            {
                                trashLoaded
                                    ? deletedTransactions.length
                                    : "…"
                            }
                        </span>
                    </summary>

                    {
                        trashLoading && (
                            <p
                                className={
                                    styles.state
                                }
                            >
                                삭제한 거래를 불러오는 중입니다.
                            </p>
                        )
                    }

                    {
                        !trashLoading &&
                        trashLoaded &&
                        deletedTransactions.length === 0 && (
                            <p
                                className={
                                    styles.emptyState
                                }
                            >
                                복원할 삭제 거래가 없습니다.
                            </p>
                        )
                    }

                    {
                        !trashLoading &&
                        deletedTransactions.length > 0 && (
                            <ul
                                className={
                                    styles.itemList
                                }
                            >
                                {
                                    deletedTransactions.map(
                                        transaction => {
                                            const title =
                                                transaction.description ||
                                                transaction.category ||
                                                transaction.type;

                                            const restoring =
                                                restoringTransactionId ===
                                                transaction.transactionId;

                                            return (
                                                <li
                                                    key={
                                                        transaction.transactionId
                                                    }
                                                    className={
                                                        styles.deletedRow
                                                    }
                                                >
                                                    <span
                                                        className={
                                                            styles.itemTextGroup
                                                        }
                                                    >
                                                        <strong>
                                                            {title}
                                                        </strong>

                                                        <span>
                                                            {transaction.date}
                                                            {" · "}
                                                            {transaction.type}
                                                            {" · "}
                                                            {formatMoney(
                                                                transaction.type === "지출"
                                                                    ? -transaction.amount
                                                                    : transaction.amount,
                                                                { showPlus: transaction.type === "수입" }
                                                            )}
                                                            {
                                                                transaction.deletedBy
                                                                    ? ` · 삭제 ${transaction.deletedBy}`
                                                                    : ""
                                                            }
                                                        </span>
                                                    </span>

                                                    <Button
                                                        variant="soft"
                                                        size="sm"
                                                        disabled={
                                                            Boolean(
                                                                restoringTransactionId
                                                            )
                                                        }
                                                        onClick={
                                                            () =>
                                                                void handleRestoreDeletedTransaction(
                                                                    transaction
                                                                )
                                                        }
                                                    >
                                                        {
                                                            restoring
                                                                ? "복원 중..."
                                                                : "복원"
                                                        }
                                                    </Button>
                                                </li>
                                            );
                                        }
                                    )
                                }
                            </ul>
                        )
                    }
                </details>
            </Card>

            <Card as="section">
                <div className={styles.sectionHeading}>
                    <h2>백업 · 내보내기</h2>
                    <p>CSV는 거래 확인용, JSON은 계좌·설정·투자·삭제내역까지 포함한 전체 보관용입니다.</p>
                </div>

                <div className={styles.backupActions}>
                    <Button
                        variant="secondary"
                        fullWidth
                        disabled={Boolean(busyKey)}
                        onClick={() => void handleExport()}
                    >
                        {busyKey === "export" ? "CSV 만드는 중..." : "전체 거래 CSV"}
                    </Button>

                    <Button
                        fullWidth
                        disabled={Boolean(busyKey)}
                        onClick={() => void handleJsonBackup()}
                    >
                        {busyKey === "backup" ? "백업 만드는 중..." : "전체 데이터 JSON 백업"}
                    </Button>
                </div>
            </Card>

            <Card as="section">
                <Button
                    variant="secondary"
                    fullWidth
                    onClick={
                        () =>
                            window.location.reload()
                    }
                >
                    최신 데이터 다시 불러오기
                </Button>
            </Card>
        </div>
    );
}


