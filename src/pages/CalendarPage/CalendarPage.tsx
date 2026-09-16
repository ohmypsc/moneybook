import {
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";


import {
    apiRequest
} from "../../api/client";

import {
    getBootstrap
} from "../../api/bootstrap";

import {
    getCalendarMonthSnapshot,
    getDeletedCalendarMonthSnapshot,
    invalidateCalendarCache,
    loadCalendarMonth,
    loadDeletedCalendarMonth
} from "../../api/calendarCache";

import {
    deleteTransaction,
    restoreTransaction,
    updateTransaction
} from "../../api/transactionMutations";

import type {
    UpdateTransactionInput
} from "../../api/transactionMutations";

import type {
    CalendarTransaction,
    LedgerTransactionType
} from "../../api/calendar";


import {
    markBackgroundRefreshed,
    shouldBackgroundRefresh
} from "../../utils/backgroundRefresh";

import {
    getSeoulDateString
} from "../../utils/dateTime";

import {
    subscribeLedgerChanges
} from "../../utils/ledgerEvents";

import {
    isPreDiscountBenefitTransaction
} from "../../utils/transactionBenefits";

import {
    confirmAction
} from "../../utils/confirmAction";

import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import { Money, formatMoney } from "../../components/common/Money/Money";
import type { BootstrapData, BootstrapResponse } from "../../types/bootstrap";

import styles
    from "./CalendarPage.module.css";

type CalendarFilter =
    | "전체"
    | LedgerTransactionType;

interface CalendarCell {
    date: string | null;
    day: number | null;
}

interface Account {
    accountId: string;
    accountName?: string;
    displayName: string;
    accountType: string;
    subType: string;
    owner?: string;
    paymentAccountId?: string | null;
}

interface Category {
    categoryId: string;
    type: LedgerTransactionType;
    name: string;
}

interface EditForm {
    date: string;
    categoryId: string;
    amount: string;
    paymentMethodId: string;
    spendingTarget: string;
    fromAccountId: string;
    toAccountId: string;
    billingMonth: string;
    description: string;
    memo: string;
}

type EditableCalendarTransaction =
    CalendarTransaction & {
        categoryId?:
            string | null;

        fromAccountId?:
            string | null;

        toAccountId?:
            string | null;

        paymentMethodId?:
            string | null;
    };

const WEEKDAYS = [
    "일",
    "월",
    "화",
    "수",
    "목",
    "금",
    "토"
];

const FILTERS:
    CalendarFilter[] = [
        "전체",
        "지출",
        "수입",
        "이체"
    ];

const CARD_PAYMENT_CATEGORIES =
    new Set([
        "카드정기결제",
        "카드선결제"
    ]);

function pad(
    value: number
) {
    return String(value)
        .padStart(
            2,
            "0"
        );
}

function getToday() {
    return getSeoulDateString();
}


function getCurrentMonth() {
    return getToday()
        .slice(
            0,
            7
        );
}

function parseMonth(
    month: string
) {
    const [
        yearText,
        monthText
    ] =
        month.split("-");

    return {
        year:
            Number(
                yearText
            ),

        monthIndex:
            Number(
                monthText
            ) - 1
    };
}

function getDaysInMonth(
    month: string
) {
    const {
        year,
        monthIndex
    } =
        parseMonth(
            month
        );

    return new Date(
        year,
        monthIndex + 1,
        0
    ).getDate();
}

function moveMonthValue(
    month: string,
    offset: number
) {
    const {
        year,
        monthIndex
    } =
        parseMonth(
            month
        );

    const date =
        new Date(
            year,
            monthIndex + offset,
            1
        );

    return [
        date.getFullYear(),
        pad(
            date.getMonth() + 1
        )
    ].join("-");
}

function formatMonthLabel(
    month: string
) {
    const {
        year,
        monthIndex
    } =
        parseMonth(
            month
        );

    return `${year}년 ${monthIndex + 1}월`;
}

function formatDateLabel(
    dateText: string
) {
    const [
        year,
        month,
        day
    ] =
        dateText
            .split("-")
            .map(
                Number
            );

    const date =
        new Date(
            year,
            month - 1,
            day
        );

    return new Intl.DateTimeFormat(
        "ko-KR",
        {
            month: "long",
            day: "numeric",
            weekday: "short"
        }
    ).format(
        date
    );
}

function formatCurrency(
    value:
        number |
        null |
        undefined
) {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(value)
    ) {
        return "-";
    }

    return formatMoney(value);
}

function formatCalendarAmount(
    value: number
) {
    return Math.round(
        Math.abs(value)
    ).toLocaleString(
        "ko-KR"
    );
}

function buildCalendarCells(
    month: string
): CalendarCell[] {
    const {
        year,
        monthIndex
    } =
        parseMonth(
            month
        );

    const firstWeekday =
        new Date(
            year,
            monthIndex,
            1
        ).getDay();

    const daysInMonth =
        getDaysInMonth(
            month
        );

    const cells:
        CalendarCell[] = [];

    for (
        let index = 0;
        index < firstWeekday;
        index += 1
    ) {
        cells.push({
            date: null,
            day: null
        });
    }

    for (
        let day = 1;
        day <= daysInMonth;
        day += 1
    ) {
        cells.push({
            date:
                `${month}-${pad(
                    day
                )}`,
            day
        });
    }

    while (
        cells.length % 7 !==
        0
    ) {
        cells.push({
            date: null,
            day: null
        });
    }

    return cells;
}

function sumTransactions(
    items:
        CalendarTransaction[],
    type:
        LedgerTransactionType
) {
    return items.reduce(
        (
            sum,
            item
        ) => {
            if (
                type === "수입"
            ) {
                if (
                    isPreDiscountBenefitTransaction(item)
                ) {
                    return sum;
                }
                if (
                    item.reversalOf &&
                    item.type ===
                        "지출"
                ) {
                    return (
                        sum -
                        item.amount
                    );
                }

                if (
                    !item.reversalOf &&
                    item.type ===
                        "수입"
                ) {
                    return (
                        sum +
                        item.amount
                    );
                }

                return sum;
            }

            if (
                type === "지출"
            ) {
                if (
                    item.reversalOf &&
                    item.type ===
                        "수입"
                ) {
                    return (
                        sum -
                        item.amount
                    );
                }

                if (
                    !item.reversalOf &&
                    item.type ===
                        "지출"
                ) {
                    return (
                        sum +
                        item.amount
                    );
                }

                return sum;
            }

            return (
                item.type ===
                "이체"
                    ? sum +
                      item.amount
                    : sum
            );
        },
        0
    );
}

function getMonthSummary(
    items:
        CalendarTransaction[]
) {
    const monthIncome =
        sumTransactions(
            items,
            "수입"
        );

    const monthExpense =
        sumTransactions(
            items,
            "지출"
        );

    return {
        monthIncome,
        monthExpense,

        monthNetCashFlow:
            monthIncome -
            monthExpense
    };
}

function getTransactionMethod(
    transaction:
        CalendarTransaction
) {
    if (
        isPreDiscountBenefitTransaction(transaction)
    ) {
        return "충전 선할인 혜택 · 수입 합계 제외";
    }

    const recordedBy =
        transaction.createdBy
            ? `기록 ${transaction.createdBy}`
            : "";

    if (
        transaction.type ===
        "지출"
    ) {
        const parts = [
            transaction.paymentMethod ||
                transaction.fromAccount,

            transaction.spendingTarget,

            recordedBy
        ].filter(
            Boolean
        );

        if (
            transaction.billingMonth
        ) {
            parts.push(
                `${transaction.billingMonth} 청구`
            );
        }

        return parts.join(
            " · "
        );
    }

    if (
        transaction.type ===
        "수입"
    ) {
        return [
            transaction.toAccount ||
                "입금수단 미지정",
            recordedBy
        ]
            .filter(Boolean)
            .join(" · ");
    }

    return [
        [
            transaction.fromAccount ||
                "-",
            "→",
            transaction.toAccount ||
                "-"
        ].join(" "),
        recordedBy
    ]
        .filter(Boolean)
        .join(" · ");
}

function getTransactionTitle(
    transaction: CalendarTransaction
) {
    if (
        isPreDiscountBenefitTransaction(transaction)
    ) {
        return "선할인 혜택";
    }

    return (
        transaction.description ||
        transaction.category ||
        transaction.type
    );
}

function getTransactionMetaLabel(
    transaction: CalendarTransaction
) {
    return [
        transaction.description ? transaction.category : "",
        getTransactionMethod(transaction)
    ]
        .filter(Boolean)
        .join(" · ");
}

function getAmountText(
    transaction:
        CalendarTransaction
) {
    const amount =
        formatCurrency(
            transaction.amount
        );

    if (
        transaction.type ===
        "지출"
    ) {
        return `-${amount}`;
    }

    if (
        transaction.type ===
        "수입"
    ) {
        return `+${amount}`;
    }

    return amount;
}

function getAccountLabel(
    account: Account
) {
    return (
        account.displayName ||
        account.accountName ||
        account.accountId
    );
}

function getErrorMessage(
    error: unknown
) {
    if (
        error instanceof Error &&
        error.message
    ) {
        return error.message;
    }

    return "요청을 처리하지 못했습니다.";
}

function formatDeletedAt(
    value:
        string |
        null |
        undefined
) {
    if (!value) {
        return "삭제 시각 미확인";
    }

    const normalized =
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/
            .test(
                value
            )
            ? value.replace(
                  " ",
                  "T"
              )
            : value;

    const date =
        new Date(
            normalized
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return value;
    }

    return new Intl.DateTimeFormat(
        "ko-KR",
        {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }
    ).format(
        date
    );
}

type CalendarPageProps = {
    onAddTransaction?: (date: string) => void;
    openTransaction?: {
        transactionId: string;
        date: string;
    } | null;
};

export default function CalendarPage({
    onAddTransaction,
    openTransaction = null
}: CalendarPageProps) {
    const today =
        getToday();

    const [
        month,
        setMonth
    ] =
        useState(
            getCurrentMonth()
        );

    const [
        selectedDate,
        setSelectedDate
    ] =
        useState(
            today
        );

    const [
        filter,
        setFilter
    ] =
        useState<
            CalendarFilter
        >("전체");

    const [
        transactions,
        setTransactions
    ] =
        useState<
            CalendarTransaction[]
        >([]);

    const [
        deletedMonthTransactions,
        setDeletedMonthTransactions
    ] =
        useState<
            CalendarTransaction[]
        >([]);

    const [
        deletedLoaded,
        setDeletedLoaded
    ] =
        useState(false);

    const [
        deletedLoading,
        setDeletedLoading
    ] =
        useState(false);

    const [
        deletedError,
        setDeletedError
    ] =
        useState("");

    const [
        trashOpen,
        setTrashOpen
    ] = useState(false);

    const [
        loading,
        setLoading
    ] =
        useState(true);

    const [
        error,
        setError
    ] =
        useState("");

    const [
        reloadKey,
        setReloadKey
    ] =
        useState(0);

    const [
        bootstrap,
        setBootstrap
    ] =
        useState<
            BootstrapData | null
        >(null);

    const [
        bootstrapLoadingId,
        setBootstrapLoadingId
    ] =
        useState<
            string | null
        >(null);

    const [
        editingId,
        setEditingId
    ] =
        useState<
            string | null
        >(null);

    const externalEditHandledRef =
        useRef<string | null>(null);

    const [
        editForm,
        setEditForm
    ] =
        useState<
            EditForm | null
        >(null);

    const [
        savingId,
        setSavingId
    ] =
        useState<
            string | null
        >(null);

    const [
        deletingId,
        setDeletingId
    ] =
        useState<
            string | null
        >(null);

    const [
        restoringId,
        setRestoringId
    ] =
        useState<
            string | null
        >(null);

    const [
        actionError,
        setActionError
    ] =
        useState("");

    const [
        actionFeedback,
        setActionFeedback
    ] =
        useState("");

    const [
        undoTransactionId,
        setUndoTransactionId
    ] =
        useState<
            string | null
        >(null);

    const [
        undoLabel,
        setUndoLabel
    ] =
        useState("");

    const [
        undoBusy,
        setUndoBusy
    ] =
        useState(false);

    useEffect(() => {
        if (!trashOpen) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setTrashOpen(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [trashOpen]);

    useEffect(
        () => {
            let cancelled =
                false;

            const cached =
                getCalendarMonthSnapshot(
                    month
                );

            const cachedDeleted =
                getDeletedCalendarMonthSnapshot(
                    month
                );

            if (cached) {
                setTransactions(
                    cached
                );

                setLoading(false);
            } else {
                setTransactions([]);
                setLoading(true);
            }

            setDeletedMonthTransactions(
                cachedDeleted ||
                []
            );

            setDeletedLoaded(
                cachedDeleted !==
                null
            );

            setDeletedLoading(false);
            setDeletedError("");
            setError("");

            async function loadMonth() {
                try {
                    const items =
                        await loadCalendarMonth(
                            month
                        );

                    if (cancelled) {
                        return;
                    }

                    setTransactions(
                        items
                    );

                    markBackgroundRefreshed(
                        `calendar:${month}`
                    );
                } catch (
                    loadError
                ) {
                    if (cancelled) {
                        return;
                    }

                    if (!cached) {
                        setError(
                            loadError instanceof Error
                                ? loadError.message
                                : "거래 내역을 불러오지 못했습니다."
                        );
                    }
                } finally {
                    if (!cancelled) {
                        setLoading(false);
                    }
                }
            }

            void loadMonth();

            return () => {
                cancelled = true;
            };
        },
        [
            month,
            reloadKey
        ]
    );

    useEffect(
        () => {
            if (!openTransaction) {
                externalEditHandledRef.current = null;
                return;
            }

            const targetMonth =
                openTransaction.date.slice(0, 7);

            if (month !== targetMonth) {
                setMonth(targetMonth);
            }

            setSelectedDate(openTransaction.date);
        },
        [
            openTransaction?.transactionId,
            openTransaction?.date,
            month
        ]
    );

    useEffect(
        () => {
            if (
                !openTransaction ||
                month !== openTransaction.date.slice(0, 7) ||
                externalEditHandledRef.current === openTransaction.transactionId
            ) {
                return;
            }

            const transaction = transactions.find(
                item =>
                    item.transactionId === openTransaction.transactionId &&
                    !item.isDeleted
            );

            if (!transaction) {
                return;
            }

            externalEditHandledRef.current =
                openTransaction.transactionId;
            void startEdit(transaction);
        },
        [
            openTransaction?.transactionId,
            openTransaction?.date,
            month,
            transactions
        ]
    );

    useEffect(
        () => {
            return subscribeLedgerChanges(
                () => {
                    setDeletedMonthTransactions([]);
                    setDeletedLoaded(false);
                    setDeletedError("");
                    setReloadKey(
                        value =>
                            value + 1
                    );
                }
            );
        },
        [
            month
        ]
    );

    useEffect(
        () => {
            function refreshWhenVisible() {
                if (
                    document.visibilityState !==
                    "visible" ||
                    !shouldBackgroundRefresh(
                        `calendar:${month}`,
                        60_000
                    )
                ) {
                    return;
                }

                void loadCalendarMonth(
                    month,
                    {
                        forceRefresh: true
                    }
                )
                    .then(
                        items => {
                            setTransactions(
                                items
                            );
                        }
                    )
                    .catch(
                        () => {
                            /* 현재 화면은 유지하고 다음 진입 때 다시 확인합니다. */
                        }
                    );
            }

            document.addEventListener(
                "visibilitychange",
                refreshWhenVisible
            );
            window.addEventListener(
                "focus",
                refreshWhenVisible
            );

            return () => {
                document.removeEventListener(
                    "visibilitychange",
                    refreshWhenVisible
                );
                window.removeEventListener(
                    "focus",
                    refreshWhenVisible
                );
            };
        },
        [
            month
        ]
    );

    useEffect(
        () => {
            if (
                !undoTransactionId
            ) {
                return;
            }

            const timer =
                window.setTimeout(
                    () => {
                        setUndoTransactionId(
                            null
                        );

                        setUndoLabel("");
                    },
                    8000
                );

            return () => {
                window.clearTimeout(
                    timer
                );
            };
        },
        [
            undoTransactionId
        ]
    );

    const activeTransactions =
        useMemo(
            () =>
                transactions.filter(
                    transaction =>
                        !transaction.isDeleted
                ),
            [
                transactions
            ]
        );

    const monthSummary =
        useMemo(
            () =>
                getMonthSummary(
                    activeTransactions
                ),
            [
                activeTransactions
            ]
        );

    const filteredTransactions =
        useMemo(
            () => {
                if (
                    filter ===
                    "전체"
                ) {
                    return activeTransactions;
                }

                return activeTransactions.filter(
                    transaction =>
                        transaction.type ===
                        filter
                );
            },
            [
                activeTransactions,
                filter
            ]
        );

    const deletedTransactions =
        useMemo(
            () =>
                deletedMonthTransactions
                    .filter(
                        transaction =>
                            transaction.isDeleted &&
                            (
                                filter ===
                                    "전체" ||
                                transaction.type ===
                                    filter
                            )
                    )
                    .sort(
                        (
                            left,
                            right
                        ) => {
                            const dateOrder =
                                right.date.localeCompare(
                                    left.date
                                );

                            if (
                                dateOrder !==
                                0
                            ) {
                                return dateOrder;
                            }

                            return String(
                                right.deletedAt ||
                                ""
                            ).localeCompare(
                                String(
                                    left.deletedAt ||
                                    ""
                                )
                            );
                        }
                    ),
            [
                deletedMonthTransactions,
                filter
            ]
        );

    const categoryNameById =
        useMemo(
            () => {
                const map =
                    new Map<
                        string,
                        string
                    >();

                bootstrap
                    ?.categories
                    .forEach(
                        category => {
                            map.set(
                                category.categoryId,
                                category.name
                            );
                        }
                    );

                [
                    ...transactions,
                    ...deletedMonthTransactions
                ].forEach(
                    transaction => {
                        if (
                            transaction.categoryId &&
                            transaction.category
                        ) {
                            map.set(
                                transaction.categoryId,
                                transaction.category
                            );
                        }
                    }
                );

                return map;
            },
            [
                bootstrap,
                transactions,
                deletedMonthTransactions
            ]
        );

    const accountNameById =
        useMemo(
            () => {
                const map =
                    new Map<
                        string,
                        string
                    >();

                bootstrap
                    ?.accounts
                    .forEach(
                        account => {
                            map.set(
                                account.accountId,
                                getAccountLabel(
                                    account
                                )
                            );
                        }
                    );

                [
                    ...transactions,
                    ...deletedMonthTransactions
                ].forEach(
                    transaction => {
                        if (
                            transaction.fromAccountId &&
                            transaction.fromAccount
                        ) {
                            map.set(
                                transaction.fromAccountId,
                                transaction.fromAccount
                            );
                        }

                        if (
                            transaction.toAccountId &&
                            transaction.toAccount
                        ) {
                            map.set(
                                transaction.toAccountId,
                                transaction.toAccount
                            );
                        }

                        if (
                            transaction.paymentMethodId &&
                            transaction.paymentMethod
                        ) {
                            map.set(
                                transaction.paymentMethodId,
                                transaction.paymentMethod
                            );
                        }
                    }
                );

                return map;
            },
            [
                bootstrap,
                transactions,
                deletedMonthTransactions
            ]
        );

    const transactionsByDate =
        useMemo(
            () => {
                const map =
                    new Map<
                        string,
                        CalendarTransaction[]
                    >();

                filteredTransactions
                    .forEach(
                        transaction => {
                            const current =
                                map.get(
                                    transaction.date
                                ) ||
                                [];

                            current.push(
                                transaction
                            );

                            map.set(
                                transaction.date,
                                current
                            );
                        }
                    );

                return map;
            },
            [
                filteredTransactions
            ]
        );

    const calendarCells =
        useMemo(
            () =>
                buildCalendarCells(
                    month
                ),
            [
                month
            ]
        );

    const selectedTransactions =
        useMemo(
            () =>
                transactionsByDate.get(
                    selectedDate
                ) ||
                [],
            [
                transactionsByDate,
                selectedDate
            ]
        );

    const selectedIncome =
        sumTransactions(
            selectedTransactions,
            "수입"
        );

    const selectedExpense =
        sumTransactions(
            selectedTransactions,
            "지출"
        );

    const selectedTransfer =
        sumTransactions(
            selectedTransactions,
            "이체"
        );

    async function openTrash() {
        setTrashOpen(true);

        if (
            deletedLoaded ||
            deletedLoading
        ) {
            return;
        }

        setDeletedLoading(true);
        setDeletedError("");

        try {
            const items =
                await loadDeletedCalendarMonth(
                    month
                );

            setDeletedMonthTransactions(
                items
            );

            setDeletedLoaded(true);
        } catch (
            loadError
        ) {
            setDeletedError(
                loadError instanceof Error
                    ? loadError.message
                    : "삭제 거래를 불러오지 못했습니다."
            );
        } finally {
            setDeletedLoading(false);
        }
    }

    function refreshMonth() {
        invalidateCalendarCache(
            month
        );

        setDeletedMonthTransactions(
            []
        );

        setDeletedLoaded(false);
        setDeletedError("");

        setReloadKey(
            value =>
                value + 1
        );
    }

    function changeMonth(
        offset: number
    ) {
        const nextMonth =
            moveMonthValue(
                month,
                offset
            );

        setMonth(
            nextMonth
        );

        if (
            today.startsWith(
                nextMonth
            )
        ) {
            setSelectedDate(
                today
            );
        } else {
            setSelectedDate(
                `${nextMonth}-01`
            );
        }
    }

    function goToday() {
        setMonth(
            today.slice(
                0,
                7
            )
        );

        setSelectedDate(
            today
        );
    }

    const editingTransaction =
        useMemo<
            EditableCalendarTransaction |
            null
        >(
            () =>
                (
                    transactions.find(
                        transaction =>
                            transaction
                                .transactionId ===
                            editingId
                    ) as
                        EditableCalendarTransaction |
                        undefined
                ) ||
                null,
            [
                transactions,
                editingId
            ]
        );

    const editCategories =
        useMemo(
            () => {
                if (
                    !bootstrap ||
                    !editingTransaction
                ) {
                    return [];
                }

                return bootstrap
                    .categories
                    .filter(
                        category =>
                            category.type ===
                            editingTransaction.type
                    );
            },
            [
                bootstrap,
                editingTransaction
            ]
        );

    const selectedEditCategory =
        useMemo(
            () => {
                if (
                    !bootstrap ||
                    !editForm
                ) {
                    return null;
                }

                return (
                    bootstrap
                        .categories
                        .find(
                            category =>
                                category
                                    .categoryId ===
                                editForm
                                    .categoryId
                        ) ||
                    null
                );
            },
            [
                bootstrap,
                editForm
            ]
        );

    const isCardPaymentEdit =
        editingTransaction
            ?.type ===
            "이체" &&
        CARD_PAYMENT_CATEGORIES
            .has(
                selectedEditCategory
                    ?.name ||
                editingTransaction
                    ?.category ||
                ""
            );

    async function ensureBootstrap() {
        if (bootstrap) {
            return bootstrap;
        }

        const response =
            await getBootstrap<
                BootstrapResponse
            >();

        if (
            !response.success ||
            !response.data
        ) {
            throw new Error(
                response.error
                    ?.message ||
                "수정에 필요한 정보를 불러오지 못했습니다."
            );
        }

        setBootstrap(
            response.data
        );

        return response.data;
    }

    async function startEdit(
        transaction:
            CalendarTransaction
    ) {
        const editable =
            transaction as
                EditableCalendarTransaction;

        setBootstrapLoadingId(
            transaction
                .transactionId
        );

        setActionError("");
        setActionFeedback("");

        try {
            await ensureBootstrap();

            setEditingId(
                transaction
                    .transactionId
            );

            setEditForm({
                date:
                    transaction.date,

                categoryId:
                    editable
                        .categoryId ||
                    "",

                amount:
                    String(
                        transaction.amount
                    ),

                paymentMethodId:
                    editable
                        .paymentMethodId ||
                    "",

                spendingTarget:
                    transaction
                        .spendingTarget ||
                    "",

                fromAccountId:
                    editable
                        .fromAccountId ||
                    "",

                toAccountId:
                    editable
                        .toAccountId ||
                    "",

                billingMonth:
                    transaction
                        .billingMonth ||
                    "",

                description:
                    transaction.description ||
                    "",

                memo:
                    transaction.memo ||
                    ""
            });
        } catch (
            bootstrapError
        ) {
            setActionError(
                getErrorMessage(
                    bootstrapError
                )
            );
        } finally {
            setBootstrapLoadingId(
                null
            );
        }
    }

    function cancelEdit() {
        setEditingId(null);
        setEditForm(null);
    }

    function updateEditField(
        field:
            keyof EditForm,
        value: string
    ) {
        setEditForm(
            current => {
                if (!current) {
                    return current;
                }

                const next = {
                    ...current,
                    [field]: value
                };

                if (
                    field ===
                        "categoryId" &&
                    editingTransaction
                        ?.type ===
                        "이체" &&
                    bootstrap
                ) {
                    const nextCategory =
                        bootstrap
                            .categories
                            .find(
                                category =>
                                    category
                                        .categoryId ===
                                    value
                            );

                    const nextIsCardPayment =
                        CARD_PAYMENT_CATEGORIES
                            .has(
                                nextCategory
                                    ?.name ||
                                ""
                            );

                    if (
                        !nextIsCardPayment
                    ) {
                        next.billingMonth =
                            "";
                    } else if (
                        !next.billingMonth
                    ) {
                        next.billingMonth =
                            next.date.slice(
                                0,
                                7
                            );
                    }
                }

                return next;
            }
        );

        setActionError("");
        setActionFeedback("");
    }

    function validateEdit() {
        if (
            !editingTransaction ||
            !editForm
        ) {
            return "수정할 거래를 찾을 수 없습니다.";
        }

        if (
            editingTransaction
                .reversalOf
        ) {
            return null;
        }

        if (!editForm.date) {
            return "날짜를 선택해주세요.";
        }

        const amount =
            Number(
                editForm.amount
            );

        if (
            !Number.isFinite(
                amount
            ) ||
            amount <= 0
        ) {
            return "금액을 올바르게 입력해주세요.";
        }

        if (
            !editForm.categoryId
        ) {
            return "카테고리를 선택해주세요.";
        }

        if (
            editingTransaction
                .type ===
                "지출"
        ) {
            if (
                !editForm
                    .paymentMethodId
            ) {
                return "결제수단을 선택해주세요.";
            }

            if (
                !editForm
                    .spendingTarget
            ) {
                return "지출대상을 선택해주세요.";
            }
        }

        if (
            editingTransaction
                .type ===
                "수입" &&
            !editForm
                .toAccountId
        ) {
            return "입금수단을 선택해주세요.";
        }

        if (
            editingTransaction
                .type ===
                "이체"
        ) {
            if (
                !editForm
                    .fromAccountId
            ) {
                return "보내는 수단을 선택해주세요.";
            }

            if (
                !editForm
                    .toAccountId
            ) {
                return "받는 수단을 선택해주세요.";
            }

            if (
                editForm
                    .fromAccountId ===
                editForm
                    .toAccountId
            ) {
                return "보내는 수단과 받는 수단은 같을 수 없습니다.";
            }

            if (
                isCardPaymentEdit &&
                !editForm
                    .billingMonth
            ) {
                return "대상 청구월을 선택해주세요.";
            }
        }

        return null;
    }

    function buildUpdateInput():
        UpdateTransactionInput |
        null {
        if (
            !editingTransaction ||
            !editForm
        ) {
            return null;
        }

        const input:
            UpdateTransactionInput = {
                transactionId:
                    editingTransaction
                        .transactionId,

                expectedUpdatedAtMs:
                    editingTransaction
                        .updatedAtMs ??
                    null
            };

        const currentDescription =
            editingTransaction.description ||
            "";

        const nextDescription =
            editForm.description.trim();

        if (
            nextDescription !==
            currentDescription
        ) {
            input.description =
                nextDescription;
        }

        const currentMemo =
            editingTransaction
                .memo ||
            "";

        const nextMemo =
            editForm.memo.trim();

        if (
            nextMemo !==
            currentMemo
        ) {
            input.memo =
                nextMemo;
        }

        if (
            editingTransaction
                .reversalOf
        ) {
            return input;
        }

        if (
            editForm.date !==
            editingTransaction
                .date
        ) {
            input.date =
                editForm.date;
        }

        const nextAmount =
            Number(
                editForm.amount
            );

        if (
            nextAmount !==
            editingTransaction
                .amount
        ) {
            input.amount =
                nextAmount;
        }

        const currentCategoryId =
            editingTransaction
                .categoryId ||
            "";

        if (
            editForm.categoryId !==
            currentCategoryId
        ) {
            input.categoryId =
                editForm.categoryId;
        }

        if (
            editingTransaction
                .type ===
                "지출"
        ) {
            const currentPaymentMethodId =
                editingTransaction
                    .paymentMethodId ||
                "";

            if (
                editForm
                    .paymentMethodId !==
                currentPaymentMethodId
            ) {
                input.paymentMethodId =
                    editForm
                        .paymentMethodId;
            }

            const currentTarget =
                editingTransaction
                    .spendingTarget ||
                "";

            if (
                editForm
                    .spendingTarget !==
                currentTarget
            ) {
                input.spendingTarget =
                    editForm
                        .spendingTarget;
            }
        }

        if (
            editingTransaction
                .type ===
                "수입"
        ) {
            const currentToAccountId =
                editingTransaction
                    .toAccountId ||
                "";

            if (
                editForm
                    .toAccountId !==
                currentToAccountId
            ) {
                input.toAccountId =
                    editForm
                        .toAccountId;
            }
        }

        if (
            editingTransaction
                .type ===
                "이체"
        ) {
            const currentFromAccountId =
                editingTransaction
                    .fromAccountId ||
                "";

            const currentToAccountId =
                editingTransaction
                    .toAccountId ||
                "";

            const currentBillingMonth =
                editingTransaction
                    .billingMonth ||
                "";

            if (
                editForm
                    .fromAccountId !==
                currentFromAccountId
            ) {
                input.fromAccountId =
                    editForm
                        .fromAccountId;
            }

            if (
                editForm
                    .toAccountId !==
                currentToAccountId
            ) {
                input.toAccountId =
                    editForm
                        .toAccountId;
            }

            if (
                editForm
                    .billingMonth !==
                currentBillingMonth
            ) {
                input.billingMonth =
                    editForm
                        .billingMonth;
            }
        }

        return input;
    }

    async function handleSaveEdit() {
        if (
            !editingTransaction ||
            !editForm
        ) {
            return;
        }

        const validationError =
            validateEdit();

        if (
            validationError
        ) {
            setActionError(
                validationError
            );

            return;
        }

        const input =
            buildUpdateInput();

        if (!input) {
            return;
        }

        if (
            Object.keys(
                input
            ).length ===
            2
        ) {
            setActionFeedback(
                "변경된 내용이 없습니다."
            );

            return;
        }

        const targetId =
            editingTransaction
                .transactionId;

        setSavingId(
            targetId
        );

        setActionError("");
        setActionFeedback("");

        try {
            await updateTransaction(
                input
            );

            cancelEdit();

            setActionFeedback(
                "거래를 수정했습니다."
            );

            invalidateCalendarCache(
                month
            );

            setReloadKey(
                value =>
                    value + 1
            );
        } catch (
            saveError
        ) {
            setActionError(
                getErrorMessage(
                    saveError
                )
            );
        } finally {
            setSavingId(null);
        }
    }

    async function handleDelete(
        transaction:
            CalendarTransaction
    ) {
        const confirmed =
            await confirmAction({
                title:
                    "거래 삭제",
                message:
                    `${transaction.category || transaction.type} ${formatCurrency(
                        transaction.amount
                    )} 거래를 삭제할까요?`,
                confirmLabel:
                    "삭제",
                tone:
                    "danger"
            });

        if (!confirmed) {
            return;
        }

        const targetId =
            transaction
                .transactionId;

        setDeletingId(
            targetId
        );

        setActionError("");
        setActionFeedback("");

        try {
            await deleteTransaction(
                targetId
            );

            setTransactions(
                current =>
                    current.filter(
                        item =>
                            item.transactionId !==
                            targetId
                    )
            );

            if (
                editingId ===
                targetId
            ) {
                cancelEdit();
            }

            setUndoTransactionId(
                targetId
            );

            setUndoLabel(
                `${transaction.category || transaction.type} · ${formatCurrency(
                    transaction.amount
                )}`
            );

            invalidateCalendarCache(
                month
            );

            setReloadKey(
                value =>
                    value + 1
            );
        } catch (
            deleteError
        ) {
            setActionError(
                getErrorMessage(
                    deleteError
                )
            );
        } finally {
            setDeletingId(null);
        }
    }

    async function handleUndoDelete() {
        if (
            !undoTransactionId ||
            undoBusy
        ) {
            return;
        }

        const targetId =
            undoTransactionId;

        setUndoBusy(true);
        setActionError("");

        try {
            await restoreTransaction(
                targetId
            );

            setUndoTransactionId(
                null
            );

            setUndoLabel("");

            setActionFeedback(
                "삭제를 취소했습니다."
            );

            invalidateCalendarCache(
                month
            );

            setReloadKey(
                value =>
                    value + 1
            );
        } catch (
            restoreError
        ) {
            setActionError(
                getErrorMessage(
                    restoreError
                )
            );
        } finally {
            setUndoBusy(false);
        }
    }

    async function handleRestoreDeleted(
        transaction:
            CalendarTransaction
    ) {
        if (restoringId) {
            return;
        }

        const confirmed =
            await confirmAction({
                title:
                    "거래 복원",
                message:
                    `${transaction.category || transaction.type} ${formatCurrency(
                        transaction.amount
                    )} 거래를 복원할까요?`,
                confirmLabel:
                    "복원"
            });

        if (!confirmed) {
            return;
        }

        const targetId =
            transaction
                .transactionId;

        setRestoringId(
            targetId
        );

        setActionError("");
        setActionFeedback("");

        try {
            await restoreTransaction(
                targetId
            );

            if (
                undoTransactionId ===
                targetId
            ) {
                setUndoTransactionId(
                    null
                );

                setUndoLabel("");
            }

            setActionFeedback(
                "삭제된 거래를 복원했습니다."
            );

            invalidateCalendarCache(
                month
            );

            setReloadKey(
                value =>
                    value + 1
            );
        } catch (
            restoreError
        ) {
            setActionError(
                getErrorMessage(
                    restoreError
                )
            );
        } finally {
            setRestoringId(null);
        }
    }

    const summary =
        monthSummary;

    return (
        <main
            className={
                styles.page
            }
        >
            <header
                className={
                    styles.header
                }
            >
                <p className={styles.eyebrow}>거래 기록</p>

                <h1 className={styles.title}>내역</h1>
            </header>

            <div
                className={
                    styles.toolbar
                }
            >
                <div
                    className={
                        styles.monthNavigator
                    }
                >
                    <Button
                        variant="secondary"
                        size="sm"
                        iconOnly
                        aria-label="이전 달"
                        onClick={
                            () =>
                                changeMonth(
                                    -1
                                )
                        }
                        disabled={
                            loading
                        }
                    >
                        ‹
                    </Button>

                    <h2
                        className={
                            styles.monthLabel
                        }
                    >
                        {formatMonthLabel(
                            month
                        )}
                    </h2>

                    <Button
                        variant="secondary"
                        size="sm"
                        iconOnly
                        aria-label="다음 달"
                        onClick={
                            () =>
                                changeMonth(
                                    1
                                )
                        }
                        disabled={
                            loading
                        }
                    >
                        ›
                    </Button>
                </div>

                <div
                    className={
                        styles.toolbarActions
                    }
                >
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={
                            goToday
                        }
                    >
                        오늘
                    </Button>

                    <Button
                        variant="secondary"
                        size="sm"
                        iconOnly
                        aria-label="새로고침"
                        onClick={
                            refreshMonth
                        }
                        disabled={
                            loading
                        }
                    >
                        ↻
                    </Button>
                </div>
            </div>

            <Card
                as="section"
                padding="none"
                className={styles.summaryGrid}
                aria-label="월 요약"
            >
                <div className={styles.summaryCard}>
                    <span
                        className={
                            styles.summaryLabel
                        }
                    >
                        수입
                    </span>

                    <strong
                        className={[
                            styles.summaryValue,
                            styles.summaryIncome
                        ].join(" ")}
                    >
                        <Money amount={summary.monthIncome} absolute tone="income" />
                    </strong>
                </div>

                <div className={styles.summaryCard}>
                    <span
                        className={
                            styles.summaryLabel
                        }
                    >
                        지출
                    </span>

                    <strong
                        className={[
                            styles.summaryValue,
                            styles.summaryExpense
                        ].join(" ")}
                    >
                        <Money amount={summary.monthExpense} absolute tone="expense" />
                    </strong>
                </div>

                <div className={styles.summaryCard}>
                    <span
                        className={
                            styles.summaryLabel
                        }
                    >
                        차액
                    </span>

                    <strong
                        className={[
                            styles.summaryValue,

                            summary
                                .monthNetCashFlow <
                            0
                                ? styles.summaryNegative
                                : ""
                        ]
                            .filter(
                                Boolean
                            )
                            .join(" ")}
                    >
                        <Money
                            amount={summary.monthNetCashFlow}
                            showPlus
                            tone={summary.monthNetCashFlow < 0 ? "negative" : "positive"}
                        />
                    </strong>
                </div>
            </Card>

            <div
                className={
                    styles.filters
                }
                aria-label="거래 유형"
            >
                {
                    FILTERS.map(
                        item => (
                            <button
                                type="button"
                                key={
                                    item
                                }
                                className={[
                                    styles.filterButton,

                                    filter ===
                                    item
                                        ? styles.filterButtonActive
                                        : ""
                                ]
                                    .filter(
                                        Boolean
                                    )
                                    .join(" ")}
                                onClick={
                                    () =>
                                        setFilter(
                                            item
                                        )
                                }
                            >
                                {item}
                            </button>
                        )
                    )
                }
            </div>

            {
                loading && (
                    <p
                        className={
                            styles.loading
                        }
                    >
                        거래 내역을 불러오는 중입니다.
                    </p>
                )
            }

            {
                !loading &&
                error && (
                    <p
                        className={
                            styles.error
                        }
                        role="alert"
                    >
                        {error}
                    </p>
                )
            }

            {
                !loading &&
                !error && (
                    <>
                        <Card
                            as="section"
                            padding="none"
                            className={styles.calendarCard}
                            aria-label={`${formatMonthLabel(
                                month
                            )} 거래 달력`}
                        >
                            <div
                                className={
                                    styles.weekdays
                                }
                            >
                                {
                                    WEEKDAYS.map(
                                        weekday => (
                                            <div
                                                key={
                                                    weekday
                                                }
                                                className={
                                                    styles.weekday
                                                }
                                            >
                                                {weekday}
                                            </div>
                                        )
                                    )
                                }
                            </div>

                            <div
                                className={
                                    styles.calendarGrid
                                }
                            >
                                {
                                    calendarCells.map(
                                        (
                                            cell,
                                            index
                                        ) => {
                                            if (
                                                !cell.date ||
                                                cell.day ===
                                                    null
                                            ) {
                                                return (
                                                    <div
                                                        key={`blank-${index}`}
                                                        className={
                                                            styles.blankCell
                                                        }
                                                        aria-hidden="true"
                                                    />
                                                );
                                            }

                                            const dayItems =
                                                transactionsByDate.get(
                                                    cell.date
                                                ) ||
                                                [];

                                            const income =
                                                sumTransactions(
                                                    dayItems,
                                                    "수입"
                                                );

                                            const expense =
                                                sumTransactions(
                                                    dayItems,
                                                    "지출"
                                                );

                                            const transferCount =
                                                dayItems.filter(
                                                    item =>
                                                        item.type ===
                                                        "이체"
                                                ).length;

                                            const selected =
                                                selectedDate ===
                                                cell.date;

                                            const isToday =
                                                today ===
                                                cell.date;

                                            return (
                                                <button
                                                    type="button"
                                                    key={
                                                        cell.date
                                                    }
                                                    className={[
                                                        styles.dayCell,

                                                        selected
                                                            ? styles.dayCellSelected
                                                            : "",

                                                        isToday
                                                            ? styles.dayCellToday
                                                            : ""
                                                    ]
                                                        .filter(
                                                            Boolean
                                                        )
                                                        .join(
                                                            " "
                                                        )}
                                                    onClick={
                                                        () =>
                                                            setSelectedDate(
                                                                cell.date as string
                                                            )
                                                    }
                                                    aria-label={`${cell.day}일, 거래 ${dayItems.length}건`}
                                                >
                                                    <div
                                                        className={
                                                            styles.dayNumberRow
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.dayNumber
                                                            }
                                                        >
                                                            {cell.day}
                                                        </span>

                                                        {
                                                            dayItems
                                                                .length >
                                                                0 && (
                                                                <span
                                                                    className={
                                                                        styles.transactionCount
                                                                    }
                                                                >
                                                                    {dayItems.length}
                                                                </span>
                                                            )
                                                        }
                                                    </div>

                                                    <div
                                                        className={
                                                            styles.dayStats
                                                        }
                                                    >
                                                        {
                                                            income >
                                                                0 && (
                                                                <span
                                                                    className={
                                                                        styles.dayIncome
                                                                    }
                                                                >
                                                                    +
                                                                    {formatCalendarAmount(
                                                                        income
                                                                    )}
                                                                </span>
                                                            )
                                                        }

                                                        {
                                                            expense >
                                                                0 && (
                                                                <span
                                                                    className={
                                                                        styles.dayExpense
                                                                    }
                                                                >
                                                                    -
                                                                    {formatCalendarAmount(
                                                                        expense
                                                                    )}
                                                                </span>
                                                            )
                                                        }

                                                        {
                                                            transferCount >
                                                                0 && (
                                                                <span
                                                                    className={
                                                                        styles.dayTransfer
                                                                    }
                                                                >
                                                                    이체{" "}
                                                                    {transferCount}
                                                                </span>
                                                            )
                                                        }
                                                    </div>
                                                </button>
                                            );
                                        }
                                    )
                                }
                            </div>
                        </Card>

                        <section
                            className={
                                styles.detailSection
                            }
                        >
                            <div
                                className={
                                    styles.detailHeader
                                }
                            >
                                <div
                                    className={
                                        styles.detailTitleGroup
                                    }
                                >
                                    <p
                                        className={
                                            styles.detailEyebrow
                                        }
                                    >
                                        선택한 날짜
                                    </p>

                                    <h2
                                        className={
                                            styles.detailTitle
                                        }
                                    >
                                        {formatDateLabel(
                                            selectedDate
                                        )}
                                    </h2>
                                </div>

                                <div className={styles.detailHeaderActions}>
                                    <span className={styles.detailCount}>
                                        {selectedTransactions.length}건
                                    </span>

                                    {onAddTransaction && (
                                        <Button
                                            size="sm"
                                            onClick={() => onAddTransaction(selectedDate)}
                                        >
                                            + 추가
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <div
                                className={
                                    styles.daySummary
                                }
                            >
                                <div
                                    className={
                                        styles.daySummaryItem
                                    }
                                >
                                    <span
                                        className={
                                            styles.daySummaryLabel
                                        }
                                    >
                                        수입
                                    </span>

                                    <strong
                                        className={[
                                            styles.daySummaryValue,
                                            styles.summaryIncome
                                        ].join(" ")}
                                    >
                                        {formatCurrency(
                                            selectedIncome
                                        )}
                                    </strong>
                                </div>

                                <div
                                    className={
                                        styles.daySummaryItem
                                    }
                                >
                                    <span
                                        className={
                                            styles.daySummaryLabel
                                        }
                                    >
                                        지출
                                    </span>

                                    <strong
                                        className={[
                                            styles.daySummaryValue,
                                            styles.summaryExpense
                                        ].join(" ")}
                                    >
                                        {formatCurrency(
                                            selectedExpense
                                        )}
                                    </strong>
                                </div>

                                <div
                                    className={
                                        styles.daySummaryItem
                                    }
                                >
                                    <span
                                        className={
                                            styles.daySummaryLabel
                                        }
                                    >
                                        이체
                                    </span>

                                    <strong
                                        className={
                                            styles.daySummaryValue
                                        }
                                    >
                                        {formatCurrency(
                                            selectedTransfer
                                        )}
                                    </strong>
                                </div>
                            </div>

                            {
                                actionError && (
                                    <p
                                        className={
                                            styles.actionError
                                        }
                                        role="alert"
                                    >
                                        {actionError}
                                    </p>
                                )
                            }

                            {
                                actionFeedback && (
                                    <p
                                        className={
                                            styles.actionFeedback
                                        }
                                        role="status"
                                    >
                                        {actionFeedback}
                                    </p>
                                )
                            }

                            {
                                selectedTransactions
                                    .length ===
                                    0 && (
                                    <p
                                        className={
                                            styles.emptyState
                                        }
                                    >
                                        이 날짜에는 표시할 거래가 없습니다.
                                    </p>
                                )
                            }

                            {
                                selectedTransactions
                                    .length >
                                    0 && (
                                    <ul
                                        className={
                                            styles.transactionList
                                        }
                                    >
                                        {
                                            selectedTransactions.map(
                                                transaction => {
                                                    const isEditing =
                                                        editingId ===
                                                        transaction
                                                            .transactionId;

                                                    const isSaving =
                                                        savingId ===
                                                        transaction
                                                            .transactionId;

                                                    const isDeleting =
                                                        deletingId ===
                                                        transaction
                                                            .transactionId;

                                                    const isPreparingEdit =
                                                        bootstrapLoadingId ===
                                                        transaction
                                                            .transactionId;

                                                    return (
                                                        <li
                                                            key={
                                                                transaction.transactionId
                                                            }
                                                            className={
                                                                styles.transactionItem
                                                            }
                                                        >
                                                            <div
                                                                className={
                                                                    styles.transactionTop
                                                                }
                                                            >
                                                                <div
                                                                    className={
                                                                        styles.transactionMain
                                                                    }
                                                                >
                                                                    <div
                                                                        className={
                                                                            styles.transactionTitleRow
                                                                        }
                                                                    >
                                                                        <span
                                                                            className={[
                                                                                styles.transactionType,

                                                                                isPreDiscountBenefitTransaction(transaction)
                                                                                    ? styles.transactionTypeTransfer
                                                                                    : transaction.type ===
                                                                                      "지출"
                                                                                    ? styles.transactionTypeExpense
                                                                                    : transaction.type ===
                                                                                      "수입"
                                                                                    ? styles.transactionTypeIncome
                                                                                    : styles.transactionTypeTransfer
                                                                            ].join(
                                                                                " "
                                                                            )}
                                                                        >
                                                                            {isPreDiscountBenefitTransaction(transaction) ? "혜택" : transaction.type}
                                                                        </span>

                                                                        <span
                                                                            className={
                                                                                styles.transactionTitle
                                                                            }
                                                                        >
                                                                            {getTransactionTitle(
                                                                                transaction
                                                                            )}
                                                                        </span>

                                                                        {
                                                                            transaction.reversalOf && (
                                                                                <span
                                                                                    className={
                                                                                        styles.reversalLabel
                                                                                    }
                                                                                >
                                                                                    취소/환불
                                                                                </span>
                                                                            )
                                                                        }
                                                                    </div>

                                                                    <p
                                                                        className={
                                                                            styles.transactionMeta
                                                                        }
                                                                    >
                                                                        {getTransactionMetaLabel(
                                                                            transaction
                                                                        )}
                                                                    </p>
                                                                </div>

                                                                <strong
                                                                    className={[
                                                                        styles.transactionAmount,

                                                                        isPreDiscountBenefitTransaction(transaction)
                                                                            ? styles.amountTransfer
                                                                            : transaction.type ===
                                                                              "지출"
                                                                            ? styles.amountExpense
                                                                            : transaction.type ===
                                                                              "수입"
                                                                            ? styles.amountIncome
                                                                            : styles.amountTransfer
                                                                    ].join(
                                                                        " "
                                                                    )}
                                                                >
                                                                    {getAmountText(
                                                                        transaction
                                                                    )}
                                                                </strong>
                                                            </div>

                                                            {
                                                                transaction.memo && (
                                                                    <p
                                                                        className={
                                                                            styles.transactionMemo
                                                                        }
                                                                    >
                                                                        {transaction.memo}
                                                                    </p>
                                                                )
                                                            }

                                                            <div
                                                                className={
                                                                    styles.transactionActions
                                                                }
                                                            >
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    loading={isPreparingEdit}
                                                                    loadingLabel="준비 중..."
                                                                    disabled={isSaving || isDeleting}
                                                                    onClick={
                                                                        () =>
                                                                            void startEdit(
                                                                                transaction
                                                                            )
                                                                    }
                                                                >
                                                                    {isEditing ? "수정 중" : "수정"}
                                                                </Button>

                                                                <Button
                                                                    variant="dangerSoft"
                                                                    size="sm"
                                                                    loading={isDeleting}
                                                                    loadingLabel="삭제 중..."
                                                                    disabled={isSaving}
                                                                    onClick={
                                                                        () =>
                                                                            void handleDelete(
                                                                                transaction
                                                                            )
                                                                    }
                                                                >
                                                                    삭제
                                                                </Button>
                                                            </div>

                                                            {
                                                                isEditing &&
                                                                editForm &&
                                                                bootstrap && (
                                                                    <Card
                                                                        padding="sm"
                                                                        tone="soft"
                                                                        shadow="none"
                                                                        className={styles.editPanel}
                                                                    >
                                                                        <div
                                                                            className={
                                                                                styles.editHeader
                                                                            }
                                                                        >
                                                                            <div>
                                                                                <p
                                                                                    className={
                                                                                        styles.editEyebrow
                                                                                    }
                                                                                >
                                                                                    거래 수정
                                                                                </p>

                                                                                <h3
                                                                                    className={
                                                                                        styles.editTitle
                                                                                    }
                                                                                >
                                                                                    {getTransactionTitle(
                                                                                        transaction
                                                                                    )}
                                                                                </h3>
                                                                            </div>

                                                                            <Button
                                                                                variant="soft"
                                                                                size="sm"
                                                                                iconOnly
                                                                                aria-label="수정 닫기"
                                                                                disabled={
                                                                                    isSaving
                                                                                }
                                                                                onClick={
                                                                                    cancelEdit
                                                                                }
                                                                            >
                                                                                ×
                                                                            </Button>
                                                                        </div>

                                                                        {
                                                                            transaction.reversalOf && (
                                                                                <p
                                                                                    className={
                                                                                        styles.editNotice
                                                                                    }
                                                                                >
                                                                                    취소/환불 거래는
                                                                                    금액·계좌·카테고리를
                                                                                    직접 바꿀 수 없습니다.
                                                                                    메모만 수정할 수 있습니다.
                                                                                </p>
                                                                            )
                                                                        }

                                                                        <div
                                                                            className={
                                                                                styles.editGrid
                                                                            }
                                                                        >
                                                                            <label
                                                                                className={
                                                                                    styles.editField
                                                                                }
                                                                            >
                                                                                <span>
                                                                                    날짜
                                                                                </span>

                                                                                <input
                                                                                    type="date"
                                                                                    value={
                                                                                        editForm.date
                                                                                    }
                                                                                    disabled={
                                                                                        isSaving ||
                                                                                        Boolean(
                                                                                            transaction.reversalOf
                                                                                        )
                                                                                    }
                                                                                    onChange={
                                                                                        event =>
                                                                                            updateEditField(
                                                                                                "date",
                                                                                                event.target.value
                                                                                            )
                                                                                    }
                                                                                />
                                                                            </label>

                                                                            <label
                                                                                className={
                                                                                    styles.editField
                                                                                }
                                                                            >
                                                                                <span>
                                                                                    금액
                                                                                </span>

                                                                                <input
                                                                                    type="number"
                                                                                    min="1"
                                                                                    inputMode="numeric"
                                                                                    value={
                                                                                        editForm.amount
                                                                                    }
                                                                                    disabled={
                                                                                        isSaving ||
                                                                                        Boolean(
                                                                                            transaction.reversalOf
                                                                                        )
                                                                                    }
                                                                                    onChange={
                                                                                        event =>
                                                                                            updateEditField(
                                                                                                "amount",
                                                                                                event.target.value
                                                                                            )
                                                                                    }
                                                                                />
                                                                            </label>

                                                                            <label
                                                                                className={
                                                                                    styles.editField
                                                                                }
                                                                            >
                                                                                <span>
                                                                                    카테고리
                                                                                </span>

                                                                                <select
                                                                                    value={
                                                                                        editForm.categoryId
                                                                                    }
                                                                                    disabled={
                                                                                        isSaving ||
                                                                                        Boolean(
                                                                                            transaction.reversalOf
                                                                                        )
                                                                                    }
                                                                                    onChange={
                                                                                        event =>
                                                                                            updateEditField(
                                                                                                "categoryId",
                                                                                                event.target.value
                                                                                            )
                                                                                    }
                                                                                >
                                                                                    <option
                                                                                        value=""
                                                                                    >
                                                                                        선택하세요
                                                                                    </option>

                                                                                    {
                                                                                        editCategories.map(
                                                                                            category => (
                                                                                                <option
                                                                                                    key={
                                                                                                        category.categoryId
                                                                                                    }
                                                                                                    value={
                                                                                                        category.categoryId
                                                                                                    }
                                                                                                >
                                                                                                    {category.name}
                                                                                                </option>
                                                                                            )
                                                                                        )
                                                                                    }
                                                                                </select>
                                                                            </label>

                                                                            {
                                                                                transaction.type ===
                                                                                    "지출" && (
                                                                                    <>
                                                                                        <label
                                                                                            className={
                                                                                                styles.editField
                                                                                            }
                                                                                        >
                                                                                            <span>
                                                                                                결제수단
                                                                                            </span>

                                                                                            <select
                                                                                                value={
                                                                                                    editForm.paymentMethodId
                                                                                                }
                                                                                                disabled={
                                                                                                    isSaving ||
                                                                                                    Boolean(
                                                                                                        transaction.reversalOf
                                                                                                    )
                                                                                                }
                                                                                                onChange={
                                                                                                    event =>
                                                                                                        updateEditField(
                                                                                                            "paymentMethodId",
                                                                                                            event.target.value
                                                                                                        )
                                                                                                }
                                                                                            >
                                                                                                <option
                                                                                                    value=""
                                                                                                >
                                                                                                    선택하세요
                                                                                                </option>

                                                                                                {
                                                                                                    bootstrap.accounts.map(
                                                                                                        account => (
                                                                                                            <option
                                                                                                                key={
                                                                                                                    account.accountId
                                                                                                                }
                                                                                                                value={
                                                                                                                    account.accountId
                                                                                                                }
                                                                                                            >
                                                                                                                {getAccountLabel(
                                                                                                                    account
                                                                                                                )}
                                                                                                            </option>
                                                                                                        )
                                                                                                    )
                                                                                                }
                                                                                            </select>
                                                                                        </label>

                                                                                        <label
                                                                                            className={
                                                                                                styles.editField
                                                                                            }
                                                                                        >
                                                                                            <span>
                                                                                                지출대상
                                                                                            </span>

                                                                                            <select
                                                                                                value={
                                                                                                    editForm.spendingTarget
                                                                                                }
                                                                                                disabled={
                                                                                                    isSaving ||
                                                                                                    Boolean(
                                                                                                        transaction.reversalOf
                                                                                                    )
                                                                                                }
                                                                                                onChange={
                                                                                                    event =>
                                                                                                        updateEditField(
                                                                                                            "spendingTarget",
                                                                                                            event.target.value
                                                                                                        )
                                                                                                }
                                                                                            >
                                                                                                <option
                                                                                                    value=""
                                                                                                >
                                                                                                    선택하세요
                                                                                                </option>

                                                                                                {
                                                                                                    bootstrap.spendingTargets.map(
                                                                                                        target => (
                                                                                                            <option
                                                                                                                key={
                                                                                                                    target
                                                                                                                }
                                                                                                                value={
                                                                                                                    target
                                                                                                                }
                                                                                                            >
                                                                                                                {target}
                                                                                                            </option>
                                                                                                        )
                                                                                                    )
                                                                                                }
                                                                                            </select>
                                                                                        </label>
                                                                                    </>
                                                                                )
                                                                            }

                                                                            {
                                                                                transaction.type ===
                                                                                    "수입" && (
                                                                                    <label
                                                                                        className={
                                                                                            styles.editField
                                                                                        }
                                                                                    >
                                                                                        <span>
                                                                                            입금수단
                                                                                        </span>

                                                                                        <select
                                                                                            value={
                                                                                                editForm.toAccountId
                                                                                            }
                                                                                            disabled={
                                                                                                isSaving ||
                                                                                                Boolean(
                                                                                                    transaction.reversalOf
                                                                                                )
                                                                                            }
                                                                                            onChange={
                                                                                                event =>
                                                                                                    updateEditField(
                                                                                                        "toAccountId",
                                                                                                        event.target.value
                                                                                                    )
                                                                                            }
                                                                                        >
                                                                                            <option
                                                                                                value=""
                                                                                            >
                                                                                                선택하세요
                                                                                            </option>

                                                                                            {
                                                                                                bootstrap.accounts.map(
                                                                                                    account => (
                                                                                                        <option
                                                                                                            key={
                                                                                                                account.accountId
                                                                                                            }
                                                                                                            value={
                                                                                                                account.accountId
                                                                                                            }
                                                                                                        >
                                                                                                            {getAccountLabel(
                                                                                                                account
                                                                                                            )}
                                                                                                        </option>
                                                                                                    )
                                                                                                )
                                                                                            }
                                                                                        </select>
                                                                                    </label>
                                                                                )
                                                                            }

                                                                            {
                                                                                transaction.type ===
                                                                                    "이체" && (
                                                                                    <>
                                                                                        <label
                                                                                            className={
                                                                                                styles.editField
                                                                                            }
                                                                                        >
                                                                                            <span>
                                                                                                보내는 수단
                                                                                            </span>

                                                                                            <select
                                                                                                value={
                                                                                                    editForm.fromAccountId
                                                                                                }
                                                                                                disabled={
                                                                                                    isSaving ||
                                                                                                    Boolean(
                                                                                                        transaction.reversalOf
                                                                                                    )
                                                                                                }
                                                                                                onChange={
                                                                                                    event =>
                                                                                                        updateEditField(
                                                                                                            "fromAccountId",
                                                                                                            event.target.value
                                                                                                        )
                                                                                                }
                                                                                            >
                                                                                                <option
                                                                                                    value=""
                                                                                                >
                                                                                                    선택하세요
                                                                                                </option>

                                                                                                {
                                                                                                    bootstrap.accounts.map(
                                                                                                        account => (
                                                                                                            <option
                                                                                                                key={
                                                                                                                    account.accountId
                                                                                                                }
                                                                                                                value={
                                                                                                                    account.accountId
                                                                                                                }
                                                                                                            >
                                                                                                                {getAccountLabel(
                                                                                                                    account
                                                                                                                )}
                                                                                                            </option>
                                                                                                        )
                                                                                                    )
                                                                                                }
                                                                                            </select>
                                                                                        </label>

                                                                                        <label
                                                                                            className={
                                                                                                styles.editField
                                                                                            }
                                                                                        >
                                                                                            <span>
                                                                                                받는 수단
                                                                                            </span>

                                                                                            <select
                                                                                                value={
                                                                                                    editForm.toAccountId
                                                                                                }
                                                                                                disabled={
                                                                                                    isSaving ||
                                                                                                    Boolean(
                                                                                                        transaction.reversalOf
                                                                                                    )
                                                                                                }
                                                                                                onChange={
                                                                                                    event =>
                                                                                                        updateEditField(
                                                                                                            "toAccountId",
                                                                                                            event.target.value
                                                                                                        )
                                                                                                }
                                                                                            >
                                                                                                <option
                                                                                                    value=""
                                                                                                >
                                                                                                    선택하세요
                                                                                                </option>

                                                                                                {
                                                                                                    bootstrap.accounts.map(
                                                                                                        account => (
                                                                                                            <option
                                                                                                                key={
                                                                                                                    account.accountId
                                                                                                                }
                                                                                                                value={
                                                                                                                    account.accountId
                                                                                                                }
                                                                                                            >
                                                                                                                {getAccountLabel(
                                                                                                                    account
                                                                                                                )}
                                                                                                            </option>
                                                                                                        )
                                                                                                    )
                                                                                                }
                                                                                            </select>
                                                                                        </label>

                                                                                        {
                                                                                            isCardPaymentEdit && (
                                                                                                <label
                                                                                                    className={
                                                                                                        styles.editField
                                                                                                    }
                                                                                                >
                                                                                                    <span>
                                                                                                        대상 청구월
                                                                                                    </span>

                                                                                                    <input
                                                                                                        type="month"
                                                                                                        value={
                                                                                                            editForm.billingMonth
                                                                                                        }
                                                                                                        disabled={
                                                                                                            isSaving ||
                                                                                                            Boolean(
                                                                                                                transaction.reversalOf
                                                                                                            )
                                                                                                        }
                                                                                                        onChange={
                                                                                                            event =>
                                                                                                                updateEditField(
                                                                                                                    "billingMonth",
                                                                                                                    event.target.value
                                                                                                                )
                                                                                                        }
                                                                                                    />
                                                                                                </label>
                                                                                            )
                                                                                        }
                                                                                    </>
                                                                                )
                                                                            }

                                                                            <label
                                                                                className={[
                                                                                    styles.editField,
                                                                                    styles.editMemoField
                                                                                ].join(
                                                                                    " "
                                                                                )}
                                                                            >
                                                                                <span>
                                                                                    내용
                                                                                </span>

                                                                                <input
                                                                                    type="text"
                                                                                    value={
                                                                                        editForm.description
                                                                                    }
                                                                                    disabled={
                                                                                        isSaving
                                                                                    }
                                                                                    onChange={
                                                                                        event =>
                                                                                            updateEditField(
                                                                                                "description",
                                                                                                event.target.value
                                                                                            )
                                                                                    }
                                                                                />
                                                                            </label>

                                                                            <label
                                                                                className={[
                                                                                    styles.editField,
                                                                                    styles.editMemoField
                                                                                ].join(
                                                                                    " "
                                                                                )}
                                                                            >
                                                                                <span>
                                                                                    메모
                                                                                </span>

                                                                                <textarea
                                                                                    value={
                                                                                        editForm.memo
                                                                                    }
                                                                                    disabled={
                                                                                        isSaving
                                                                                    }
                                                                                    onChange={
                                                                                        event =>
                                                                                            updateEditField(
                                                                                                "memo",
                                                                                                event.target.value
                                                                                            )
                                                                                    }
                                                                                />
                                                                            </label>
                                                                        </div>

                                                                        <div
                                                                            className={
                                                                                styles.editActions
                                                                            }
                                                                        >
                                                                            <Button
                                                                                variant="secondary"
                                                                                size="sm"
                                                                                disabled={
                                                                                    isSaving
                                                                                }
                                                                                onClick={
                                                                                    cancelEdit
                                                                                }
                                                                            >
                                                                                취소
                                                                            </Button>

                                                                            <Button
                                                                                size="sm"
                                                                                loading={isSaving}
                                                                                loadingLabel="저장 중..."
                                                                                onClick={
                                                                                    () =>
                                                                                        void handleSaveEdit()
                                                                                }
                                                                            >
                                                                                수정 저장
                                                                            </Button>
                                                                        </div>
                                                                    </Card>
                                                                )
                                                            }
                                                        </li>
                                                    );
                                                }
                                            )
                                        }
                                    </ul>
                                )
                            }
                        </section>

                    </>
                )
            }

            {
                undoTransactionId && (
                    <div
                        className={
                            styles.undoBar
                        }
                        role="status"
                    >
                        <div
                            className={
                                styles.undoText
                            }
                        >
                            <strong>
                                거래를 삭제했습니다.
                            </strong>

                            <span>
                                {undoLabel}
                            </span>
                        </div>

                        <Button
                            size="sm"
                            loading={undoBusy}
                            loadingLabel="복원 중..."
                            onClick={
                                () =>
                                    void handleUndoDelete()
                            }
                        >
                            실행 취소
                        </Button>
                    </div>
                )
            }
        </main>
    );
}
