import {
    Fragment,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import type {
    PointerEvent as ReactPointerEvent
} from "react";

import {
    apiRequest
} from "../../api/client";

import {
    getSession,
    logout
} from "../../api/auth";

import {
    getTransactions
} from "../../api/transactions";

import type {
    Transaction
} from "../../api/transactions";

import {
    clearLedgerStartDate,
    createManagedAccount,
    createManagedCategory,
    deleteManagedAccount,
    deleteManagedCategory,
    getLedgerConfig,
    getManagedAccounts,
    getManagedAccountsSnapshot,
    getManagedCategories,
    getManagedCategoriesSnapshot,
    restoreManagedAccount,
    restoreManagedCategory,
    setLedgerStartDate,
    updateManagedAccount,
    updateManagedCategory
} from "../../api/settingsManagement";

import type {
    LedgerCategoryType,
    ManagedAccount,
    ManagedCategory,
    SaveAccountInput
} from "../../api/settingsManagement";

import {
    applyCategoryPreferences,
    getInputPreferences,
    normalizeInputPreferences,
    saveInputPreferences,
    sortAccountsByPreferences
} from "../../utils/inputPreferences";

import type {
    InputPreferences,
    PreferenceTransactionType,
    SharedInputPreferencesState
} from "../../utils/inputPreferences";

import styles
    from "./SettingsPage.module.css";


type SettingsView =
    | "home"
    | "categories"
    | "accounts"
    | "ledger"
    | "profile";


interface InputAccount {
    accountId: string;
    accountName?: string;
    displayName: string;
    accountType: string;
    subType: string;
    owner?: string;
    paymentAccountId?: string | null;
}


interface InputCategory {
    categoryId: string;
    type: PreferenceTransactionType;
    name: string;
}


interface BootstrapData {
    transactionTypes:
        PreferenceTransactionType[];

    members:
        string[];

    spendingTargets:
        string[];

    accounts:
        InputAccount[];

    categories:
        InputCategory[];

    inputPreferences?:
        SharedInputPreferencesState;
}


interface BootstrapResponse {
    success:
        boolean;

    apiVersion?:
        string;

    data?:
        BootstrapData;

    error?: {
        code?:
            string;

        message?:
            string;
    };
}


interface SavePreferencesResponse {
    success:
        boolean;

    apiVersion?:
        string;

    data?:
        SharedInputPreferencesState;

    error?: {
        code?:
            string;

        message?:
            string;
    };
}


interface AccountFormState {
    accountName:
        string;

    accountType:
        string;

    subType:
        string;

    owner:
        string;

    openingBalance:
        string;

    billingCutoffDay:
        string;

    paymentDay:
        string;

    startYear:
        string;

    endYear:
        string;

    balanceMethod:
        string;

    paymentAccountId:
        string;
}


interface SaveInputPreferenceOptions {
    categories?:
        InputCategory[];

    accounts?:
        InputAccount[];

    successMessage:
        string;
}


const MANAGED_CATEGORY_TYPES:
    LedgerCategoryType[] = [
        "지출",
        "수입",
        "이체"
    ];


const FIXED_OWNERS = [
    "공동",
    "미영",
    "승철"
];


const ACCOUNT_OWNER_TABS = [
    "미영",
    "승철",
    "공동"
] as const;


type AccountOwnerTab =
    typeof ACCOUNT_OWNER_TABS[number];


type AccountKindValue =
    | "checking"
    | "cash"
    | "deposit"
    | "saving"
    | "prepaid"
    | "checkCard"
    | "creditCard"
    | "loan"
    | "investment";


interface AccountKindDefinition {
    value:
        AccountKindValue;

    label:
        string;

    accountType:
        string;

    subType:
        string;

    balanceMethod:
        string;
}


const ACCOUNT_KIND_OPTIONS:
    AccountKindDefinition[] = [
        {
            value:
                "checking",

            label:
                "입출금통장",

            accountType:
                "자산",

            subType:
                "입출금",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "cash",

            label:
                "현금",

            accountType:
                "자산",

            subType:
                "현금",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "deposit",

            label:
                "예금",

            accountType:
                "자산",

            subType:
                "예금",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "saving",

            label:
                "적금",

            accountType:
                "자산",

            subType:
                "적금",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "prepaid",

            label:
                "선불·지역화폐",

            accountType:
                "자산",

            subType:
                "선불/지역화폐",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "checkCard",

            label:
                "체크카드",

            accountType:
                "결제수단",

            subType:
                "체크카드",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "creditCard",

            label:
                "신용카드",

            accountType:
                "부채",

            subType:
                "신용카드",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "loan",

            label:
                "대출",

            accountType:
                "부채",

            subType:
                "대출",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "investment",

            label:
                "투자계좌",

            accountType:
                "자산",

            subType:
                "주식",

            balanceMethod:
                "평가입력"
        }
    ];


function getErrorMessage(
    error:
        unknown,

    fallback:
        string
) {
    return error instanceof Error
        ? error.message
        : fallback;
}


function moveItemToIndex(
    items:
        string[],

    fromIndex:
        number,

    toIndex:
        number
) {
    if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= items.length ||
        toIndex >= items.length
    ) {
        return items;
    }

    const next =
        items.slice();

    const [moved] =
        next.splice(
            fromIndex,
            1
        );

    next.splice(
        toIndex,
        0,
        moved
    );

    return next;
}


function moveSubsetToIndex(
    allOrder:
        string[],

    subsetIds:
        string[],

    fromIndex:
        number,

    toIndex:
        number
) {
    const movedSubset =
        moveItemToIndex(
            subsetIds,
            fromIndex,
            toIndex
        );

    if (
        movedSubset ===
        subsetIds
    ) {
        return allOrder;
    }

    const subsetSet =
        new Set(
            subsetIds
        );

    let cursor =
        0;

    return allOrder.map(
        itemId => {
            if (
                !subsetSet.has(
                    itemId
                )
            ) {
                return itemId;
            }

            const replacement =
                movedSubset[
                    cursor
                ];

            cursor +=
                1;

            return (
                replacement ||
                itemId
            );
        }
    );
}


function autoScrollForPointer(
    clientY:
        number
) {
    const edge =
        84;

    const step =
        24;

    if (
        clientY <
        edge
    ) {
        window.scrollBy(
            0,
            -step
        );
    } else if (
        clientY >
        window.innerHeight -
            edge
    ) {
        window.scrollBy(
            0,
            step
        );
    }
}


function getAccountKind(
    accountType:
        string,

    subType:
        string
) {
    return (
        ACCOUNT_KIND_OPTIONS.find(
            option =>
                option.subType ===
                subType
        ) ||
        ACCOUNT_KIND_OPTIONS.find(
            option =>
                option.accountType ===
                    accountType &&
                option.subType ===
                    subType
        ) ||
        null
    );
}


function getAccountKindLabel(
    accountType:
        string,

    subType:
        string
) {
    return (
        getAccountKind(
            accountType,
            subType
        )?.label ||
        subType ||
        accountType ||
        "기타"
    );
}


function applyAccountKind(
    current:
        AccountFormState,

    kind:
        AccountKindDefinition
): AccountFormState {
    const isCard =
        kind.subType ===
            "체크카드" ||
        kind.subType ===
            "신용카드";

    const isCreditCard =
        kind.subType ===
        "신용카드";

    return {
        ...current,

        accountType:
            kind.accountType,

        subType:
            kind.subType,

        balanceMethod:
            kind.balanceMethod,

        paymentAccountId:
            isCard
                ? current.paymentAccountId
                : "",

        billingCutoffDay:
            isCreditCard
                ? current.billingCutoffDay
                : "",

        paymentDay:
            isCreditCard
                ? current.paymentDay
                : ""
    };
}


function formatKrw(
    value:
        number |
        undefined
) {
    if (
        value ===
            undefined ||
        !Number.isFinite(
            value
        )
    ) {
        return "-";
    }

    return `${Math.round(
        value
    ).toLocaleString(
        "ko-KR"
    )}원`;
}


function csvCell(
    value:
        unknown
) {
    const text =
        value === null ||
        value === undefined
            ? ""
            : String(
                value
            );

    return `"${text.replace(
        /"/g,
        '""'
    )}"`;
}


function createEmptyAccountForm(
    owner:
        string =
            "공동"
): AccountFormState {
    return {
        accountName:
            "",

        accountType:
            "자산",

        subType:
            "입출금",

        owner,

        openingBalance:
            "0",

        billingCutoffDay:
            "",

        paymentDay:
            "",

        startYear:
            "",

        endYear:
            "",

        balanceMethod:
            "자동계산",

        paymentAccountId:
            ""
    };
}


function accountToForm(
    account:
        ManagedAccount
): AccountFormState {
    const kind =
        getAccountKind(
            account.accountType,
            account.subType
        );

    return {
        accountName:
            account.accountName,

        accountType:
            kind?.accountType ||
            account.accountType,

        subType:
            kind?.subType ||
            account.subType,

        owner:
            account.owner,

        openingBalance:
            String(
                account.openingBalance ??
                    0
            ),

        billingCutoffDay:
            account.billingCutoffDay ===
            null
                ? ""
                : String(
                    account.billingCutoffDay
                ),

        paymentDay:
            account.paymentDay ===
            null
                ? ""
                : String(
                    account.paymentDay
                ),

        startYear:
            account.startYear ===
            null
                ? ""
                : String(
                    account.startYear
                ),

        endYear:
            account.endYear ===
            null
                ? ""
                : String(
                    account.endYear
                ),

        balanceMethod:
            kind?.balanceMethod ||
            account.balanceMethod ||
            "자동계산",

        paymentAccountId:
            account.paymentAccountId ||
            ""
    };
}


function parseOptionalInteger(
    value:
        string,

    label:
        string,

    minimum:
        number,

    maximum:
        number
) {
    const text =
        value.trim();

    if (
        !text
    ) {
        return null;
    }

    const number =
        Number(
            text
        );

    if (
        !Number.isInteger(
            number
        ) ||
        number <
            minimum ||
        number >
            maximum
    ) {
        throw new Error(
            `${label}은 ${minimum}~${maximum} 사이의 정수여야 합니다.`
        );
    }

    return number;
}


function buildAccountPayload(
    form:
        AccountFormState
): SaveAccountInput {
    const accountName =
        form.accountName.trim();

    const accountType =
        form.accountType.trim();

    const subType =
        form.subType.trim();

    const owner =
        form.owner.trim();

    const openingBalance =
        Number(
            form.openingBalance ||
                0
        );

    if (
        !accountName
    ) {
        throw new Error(
            "계좌 이름을 입력해주세요."
        );
    }

    if (
        !accountType ||
        !subType
    ) {
        throw new Error(
            "종류를 선택해주세요."
        );
    }

    if (
        !owner
    ) {
        throw new Error(
            "명의자를 선택해주세요."
        );
    }

    if (
        !Number.isFinite(
            openingBalance
        )
    ) {
        throw new Error(
            "시작 잔액은 숫자로 입력해주세요."
        );
    }

    const billingCutoffDay =
        parseOptionalInteger(
            form.billingCutoffDay,
            "청구 마감일",
            1,
            31
        );

    const paymentDay =
        parseOptionalInteger(
            form.paymentDay,
            "결제일",
            1,
            31
        );

    const startYear =
        parseOptionalInteger(
            form.startYear,
            "사용 시작 연도",
            1900,
            2200
        );

    const endYear =
        parseOptionalInteger(
            form.endYear,
            "사용 종료 연도",
            1900,
            2200
        );

    if (
        startYear !==
            null &&
        endYear !==
            null &&
        startYear >
            endYear
    ) {
        throw new Error(
            "사용 시작 연도는 종료 연도보다 늦을 수 없습니다."
        );
    }

    const isCard =
        subType ===
            "체크카드" ||
        subType ===
            "신용카드";

    if (
        isCard &&
        !form.paymentAccountId
    ) {
        throw new Error(
            "카드의 결제계좌를 선택해주세요."
        );
    }

    return {
        accountName,
        accountType,
        subType,
        owner,
        openingBalance,
        billingCutoffDay,
        paymentDay,
        startYear,
        endYear,

        balanceMethod:
            form.balanceMethod.trim() ||
            "자동계산",

        paymentAccountId:
            isCard
                ? form.paymentAccountId
                : null,

        assetAttribution:
            owner
    };
}


function useInputPreferenceData() {
    const [
        bootstrap,
        setBootstrap
    ] =
        useState<
            BootstrapData |
            null
        >(
            null
        );

    const [
        preferences,
        setPreferences
    ] =
        useState<
            InputPreferences |
            null
        >(
            null
        );

    const [
        loading,
        setLoading
    ] =
        useState(
            true
        );

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
        saveError,
        setSaveError
    ] =
        useState("");

    const [
        saving,
        setSaving
    ] =
        useState(
            false
        );

    useEffect(
        () => {
            let active =
                true;

            async function load() {
                setLoading(
                    true
                );

                setError(
                    ""
                );

                try {
                    const response =
                        await apiRequest<
                            BootstrapResponse
                        >(
                            "/api/bootstrap"
                        );

                    if (
                        !response.success ||
                        !response.data
                    ) {
                        throw new Error(
                            response.error
                                ?.message ||
                            "입력 화면 설정을 불러오지 못했습니다."
                        );
                    }

                    if (
                        !active
                    ) {
                        return;
                    }

                    const data =
                        response.data;

                    const sharedPreferences =
                        data.inputPreferences
                            ?.configured ===
                            true &&
                        data.inputPreferences
                            .preferences
                            ? data
                                .inputPreferences
                                .preferences
                            : null;

                    const nextPreferences =
                        sharedPreferences
                            ? normalizeInputPreferences(
                                sharedPreferences,
                                data.categories,
                                data.accounts
                            )
                            : getInputPreferences(
                                data.categories,
                                data.accounts
                            );

                    if (
                        sharedPreferences
                    ) {
                        saveInputPreferences(
                            nextPreferences
                        );
                    }

                    setBootstrap(
                        data
                    );

                    setPreferences(
                        nextPreferences
                    );
                } catch (
                    loadError
                ) {
                    if (
                        active
                    ) {
                        setError(
                            getErrorMessage(
                                loadError,
                                "입력 화면 설정을 불러오지 못했습니다."
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

    function clearMessages() {
        setFeedback(
            ""
        );

        setSaveError(
            ""
        );
    }

    async function savePreferencesToServer(
        nextPreferences:
            InputPreferences,

        options:
            SaveInputPreferenceOptions
    ) {
        if (
            !bootstrap ||
            saving
        ) {
            return false;
        }

        const categorySource =
            options.categories ||
            bootstrap.categories;

        const accountSource =
            options.accounts ||
            bootstrap.accounts;

        const normalized =
            normalizeInputPreferences(
                nextPreferences,
                categorySource,
                accountSource
            );

        saveInputPreferences(
            normalized
        );

        setPreferences(
            normalized
        );

        setSaving(
            true
        );

        clearMessages();

        try {
            const response =
                await apiRequest<
                    SavePreferencesResponse
                >(
                    "/api/settings/input-preferences",
                    {
                        method:
                            "POST",

                        body:
                            JSON.stringify({
                                preferences:
                                    normalized
                            })
                    }
                );

            if (
                !response.success ||
                !response.data ||
                response.data
                    .configured !==
                    true ||
                !response.data
                    .preferences
            ) {
                throw new Error(
                    response.error
                        ?.message ||
                    "부부 공통 설정을 저장하지 못했습니다."
                );
            }

            const saved =
                normalizeInputPreferences(
                    response.data
                        .preferences,
                    categorySource,
                    accountSource
                );

            saveInputPreferences(
                saved
            );

            setPreferences(
                saved
            );

            setFeedback(
                options.successMessage
            );

            return true;
        } catch (
            saveFailure
        ) {
            setSaveError(
                `공통 서버 저장에 실패했습니다. 현재 브라우저에는 저장했습니다. (${getErrorMessage(
                    saveFailure,
                    "알 수 없는 오류"
                )})`
            );

            return false;
        } finally {
            setSaving(
                false
            );
        }
    }

    return {
        bootstrap,
        preferences,
        setPreferences,
        loading,
        error,
        feedback,
        saveError,
        saving,
        clearMessages,
        savePreferencesToServer
    };
}


function SettingsHome(
    {
        onOpen
    }: {
        onOpen:
            (
                view:
                    SettingsView
            ) => void;
    }
) {
    const sharedItems:
        Array<{
            key:
                SettingsView;

            title:
                string;

            description:
                string;
        }> = [
            {
              key:
                    "accounts",

                title:
                    "자산 관리",

                description:
                    "통장·카드·대출·투자계좌와 입력 화면 설정"  
            },

            {
                key:
                    "categories",

                title:
                    "카테고리 관리",

                description:
                    "카테고리 추가·수정과 입력 화면 순서"
            },

            {
                key:
                    "ledger",

                title:
                    "가계부 운영·데이터",

                description:
                    "가계부 시작일, 전체 거래 내보내기, 새로고침"
            }
        ];

    return (
        <>
            <header
                className={
                    styles.pageHeader
                }
            >
                <h1 className={styles.pageTitle}>설정</h1>
            </header>

            <section
                className={
                    styles.menuSection
                }
            >
                <h2
                    className={
                        styles.menuSectionTitle
                    }
                >
                    부부 공통
                </h2>

                <div
                    className={
                        styles.menuCard
                    }
                >
                    {
                        sharedItems.map(
                            item => (
                                <button
                                    type="button"
                                    key={
                                        item.key
                                    }
                                    className={
                                        styles.menuRow
                                    }
                                    onClick={
                                        () =>
                                            onOpen(
                                                item.key
                                            )
                                    }
                                >
                                    <span
                                        className={
                                            styles.menuText
                                        }
                                    >
                                        <strong>
                                            {
                                                item.title
                                            }
                                        </strong>

                                        <span>
                                            {
                                                item.description
                                            }
                                        </span>
                                    </span>

                                    <span
                                        className={
                                            styles.chevron
                                        }
                                        aria-hidden="true"
                                    >
                                        ›
                                    </span>
                                </button>
                            )
                        )
                    }
                </div>
            </section>

            <section
                className={
                    styles.menuSection
                }
            >
                <h2
                    className={
                        styles.menuSectionTitle
                    }
                >
                    내 설정
                </h2>

                <div
                    className={
                        styles.menuCard
                    }
                >
                    <button
                        type="button"
                        className={
                            styles.menuRow
                        }
                        onClick={
                            () =>
                                onOpen(
                                    "profile"
                                )
                        }
                    >
                        <span
                            className={
                                styles.menuText
                            }
                        >
                            <strong>
                                내 계정·앱 정보
                            </strong>

                            <span>
                                현재 사용자, 데이터 저장 방식, 로그아웃
                            </span>
                        </span>

                        <span
                            className={
                                styles.chevron
                            }
                            aria-hidden="true"
                        >
                            ›
                        </span>
                    </button>
                </div>
            </section>
        </>
    );
}


function DetailHeader(
    {
        title,
        description,
        onBack
    }: {
        title:
            string;

        description:
            string;

        onBack:
            () => void;
    }
) {
    return (
        <header
            className={
                styles.detailHeader
            }
        >
            <button
                type="button"
                className={
                    styles.backButton
                }
                onClick={
                    onBack
                }
            >
                <span
                    aria-hidden="true"
                >
                    ‹
                </span>

                설정
            </button>

            <h1
                className={
                    styles.detailTitle
                }
            >
                {title}
            </h1>

            <p
                className={
                    styles.detailDescription
                }
            >
                {description}
            </p>
        </header>
    );
}


function CategorySettings() {
    const [
        initialSnapshot
    ] =
        useState(
            () =>
                getManagedCategoriesSnapshot()
        );

    const [
        categories,
        setCategories
    ] =
        useState<
            ManagedCategory[]
        >(
            () =>
                initialSnapshot
                    ?.items ||
                []
        );

    const [
        selectedType,
        setSelectedType
    ] =
        useState<
            LedgerCategoryType
        >(
            "지출"
        );

    const [
        newName,
        setNewName
    ] =
        useState("");

    const [
        editingId,
        setEditingId
    ] =
        useState<
            string |
            null
        >(
            null
        );

    const [
        editingName,
        setEditingName
    ] =
        useState("");

    const [
        menuCategoryId,
        setMenuCategoryId
    ] =
        useState<
            string |
            null
        >(
            null
        );

    const [
        reordering,
        setReordering
    ] =
        useState(
            false
        );

    const [
        draggingCategoryId,
        setDraggingCategoryId
    ] =
        useState<
            string |
            null
        >(
            null
        );

    const categoryDragPointerId =
        useRef<
            number |
            null
        >(
            null
        );

    const [
        loading,
        setLoading
    ] =
        useState(
            initialSnapshot ===
                null
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

    const inputPreference =
        useInputPreferenceData();


    async function refresh() {
        const result =
            await getManagedCategories({
                includeDeleted:
                    true
            });

        setCategories(
            result.items
        );
    }


    useEffect(
        () => {
            let active =
                true;

            async function load() {
                if (
                    !initialSnapshot
                ) {
                    setLoading(
                        true
                    );
                }

                setError(
                    ""
                );

                try {
                    const result =
                        await getManagedCategories({
                            includeDeleted:
                                true
                        });

                    if (
                        active
                    ) {
                        setCategories(
                            result.items
                        );
                    }
                } catch (
                    loadError
                ) {
                    if (
                        active &&
                        !initialSnapshot
                    ) {
                        setError(
                            getErrorMessage(
                                loadError,
                                "카테고리를 불러오지 못했습니다."
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
        [
            initialSnapshot
        ]
    );


    const currentItems =
        useMemo(
            () =>
                categories.filter(
                    category =>
                        category.type ===
                            selectedType &&
                        !category.isDeleted
                ),
            [
                categories,
                selectedType
            ]
        );


    const deletedItems =
        useMemo(
            () =>
                categories.filter(
                    category =>
                        category.type ===
                            selectedType &&
                        category.isDeleted
                ),
            [
                categories,
                selectedType
            ]
        );


    const preferenceCategories =
        useMemo<
            InputCategory[]
        >(
            () =>
                categories
                    .filter(
                        category =>
                            !category.isDeleted &&
                            category.active
                    )
                    .map(
                        category => ({
                            categoryId:
                                category.categoryId,

                            type:
                                category.type as
                                    PreferenceTransactionType,

                            name:
                                category.name
                        })
                    ),
            [
                categories
            ]
        );


    const normalizedPreferences =
        useMemo(
            () => {
                if (
                    !inputPreference.preferences ||
                    !inputPreference.bootstrap
                ) {
                    return null;
                }

                return normalizeInputPreferences(
                    inputPreference.preferences,
                    preferenceCategories,
                    inputPreference
                        .bootstrap
                        .accounts
                );
            },
            [
                inputPreference.preferences,
                inputPreference.bootstrap,
                preferenceCategories
            ]
        );


    const orderedActiveItems =
        useMemo(
            () => {
                const active =
                    currentItems.filter(
                        category =>
                            category.active
                    );

                if (
                    !normalizedPreferences
                ) {
                    return active;
                }

                const inputItems =
                    active.map(
                        category => ({
                            categoryId:
                                category.categoryId,

                            type:
                                category.type as
                                    PreferenceTransactionType,

                            name:
                                category.name
                        })
                    );

                const ordered =
                    applyCategoryPreferences(
                        inputItems,
                        selectedType as
                            PreferenceTransactionType,
                        normalizedPreferences
                    );

                const byId =
                    new Map(
                        active.map(
                            category => [
                                category.categoryId,
                                category
                            ] as const
                        )
                    );

                return ordered
                    .map(
                        category =>
                            byId.get(
                                category.categoryId
                            )
                    )
                    .filter(
                        (
                            category
                        ): category is ManagedCategory =>
                            Boolean(
                                category
                            )
                    );
            },
            [
                currentItems,
                normalizedPreferences,
                selectedType
            ]
        );


    const inactiveItems =
        useMemo(
            () =>
                currentItems
                    .filter(
                        category =>
                            !category.active
                    )
                    .slice()
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            a.name.localeCompare(
                                b.name,
                                "ko"
                            )
                    ),
            [
                currentItems
            ]
        );


    const managementItems =
        useMemo(
            () => [
                ...orderedActiveItems,
                ...inactiveItems
            ],
            [
                orderedActiveItems,
                inactiveItems
            ]
        );


    const activeMenuCategory =
        managementItems.find(
            category =>
                category.categoryId ===
                menuCategoryId
        ) || null;


    useEffect(
        () => {
            if (
                !activeMenuCategory
            ) {
                return;
            }

            const previousOverflow =
                document.body.style.overflow;

            document.body.style.overflow =
                "hidden";

            return () => {
                document.body.style.overflow =
                    previousOverflow;
            };
        },
        [
            activeMenuCategory
        ]
    );


    async function runMutation(
        key:
            string,

        work:
            () =>
                Promise<unknown>,

        successMessage:
            string
    ) {
        if (
            busyKey
        ) {
            return false;
        }

        setBusyKey(
            key
        );

        setError(
            ""
        );

        setFeedback(
            ""
        );

        setMenuCategoryId(
            null
        );

        try {
            await work();

            await refresh();

            setFeedback(
                successMessage
            );

            return true;
        } catch (
            mutationError
        ) {
            setError(
                getErrorMessage(
                    mutationError,
                    "카테고리를 처리하지 못했습니다."
                )
            );

            return false;
        } finally {
            setBusyKey(
                ""
            );
        }
    }


    async function handleCreate() {
        const name =
            newName.trim();

        if (
            !name
        ) {
            setError(
                "추가할 카테고리 이름을 입력해주세요."
            );

            return;
        }

        const completed =
            await runMutation(
                "create",

                () =>
                    createManagedCategory({
                        type:
                            selectedType,

                        name
                    }),

                `${selectedType} 카테고리를 추가했습니다.`
            );

        if (
            completed
        ) {
            setNewName(
                ""
            );
        }
    }


    async function handleRename(
        category:
            ManagedCategory
    ) {
        const name =
            editingName.trim();

        if (
            !name
        ) {
            setError(
                "카테고리 이름을 입력해주세요."
            );

            return;
        }

        if (
            name ===
            category.name
        ) {
            setEditingId(
                null
            );

            return;
        }

        const completed =
            await runMutation(
                `rename:${category.categoryId}`,

                () =>
                    updateManagedCategory({
                        categoryId:
                            category.categoryId,

                        name
                    }),

                "카테고리 이름을 변경했습니다."
            );

        if (
            completed
        ) {
            setEditingId(
                null
            );

            setEditingName(
                ""
            );
        }
    }


    async function handleDelete(
        category:
            ManagedCategory
    ) {
        if (
            !window.confirm(
                `‘${category.name}’ 카테고리를 삭제할까요?\n\n거래에서 사용 중인 카테고리는 삭제되지 않습니다.`
            )
        ) {
            return;
        }

        await runMutation(
            `delete:${category.categoryId}`,

            () =>
                deleteManagedCategory(
                    category.categoryId
                ),

            "카테고리를 삭제했습니다."
        );
    }


    function reorderCategory(
        draggedId:
            string,

        targetId:
            string
    ) {
        if (
            !normalizedPreferences ||
            draggedId ===
                targetId
        ) {
            return;
        }

        const currentIds =
            orderedActiveItems.map(
                category =>
                    category.categoryId
            );

        const fromIndex =
            currentIds.indexOf(
                draggedId
            );

        const toIndex =
            currentIds.indexOf(
                targetId
            );

        if (
            fromIndex < 0 ||
            toIndex < 0
        ) {
            return;
        }

        const nextOrder =
            moveSubsetToIndex(
                normalizedPreferences
                    .categoryOrder[
                        selectedType as
                            PreferenceTransactionType
                    ],
                currentIds,
                fromIndex,
                toIndex
            );

        inputPreference.setPreferences({
            ...normalizedPreferences,

            categoryOrder: {
                ...normalizedPreferences
                    .categoryOrder,

                [selectedType]:
                    nextOrder
            }
        });

        inputPreference.clearMessages();
    }


    function handleCategoryDragStart(
        event:
            ReactPointerEvent<HTMLButtonElement>,

        categoryId:
            string
    ) {
        if (
            inputPreference.saving
        ) {
            return;
        }

        categoryDragPointerId.current =
            event.pointerId;

        event.currentTarget.setPointerCapture(
            event.pointerId
        );

        setDraggingCategoryId(
            categoryId
        );
    }


    function handleCategoryDragMove(
        event:
            ReactPointerEvent<HTMLButtonElement>
    ) {
        if (
            draggingCategoryId ===
                null ||
            categoryDragPointerId.current !==
                event.pointerId
        ) {
            return;
        }

        event.preventDefault();
        autoScrollForPointer(
            event.clientY
        );

        const target =
            document
                .elementFromPoint(
                    event.clientX,
                    event.clientY
                )
                ?.closest<HTMLElement>(
                    "[data-category-reorder-id]"
                );

        const targetId =
            target?.dataset
                .categoryReorderId;

        if (
            targetId
        ) {
            reorderCategory(
                draggingCategoryId,
                targetId
            );
        }
    }


    function handleCategoryDragEnd(
        event:
            ReactPointerEvent<HTMLButtonElement>
    ) {
        if (
            categoryDragPointerId.current ===
                event.pointerId
        ) {
            categoryDragPointerId.current =
                null;

            setDraggingCategoryId(
                null
            );
        }
    }


    async function handleFinishReordering() {
        if (
            !normalizedPreferences ||
            !inputPreference.bootstrap
        ) {
            return;
        }

        const saved =
            await inputPreference
                .savePreferencesToServer(
                    normalizedPreferences,
                    {
                        categories:
                            preferenceCategories,

                        accounts:
                            inputPreference
                                .bootstrap
                                .accounts,

                        successMessage:
                            "카테고리 순서를 저장했습니다."
                    }
                );

        if (
            saved
        ) {
            setReordering(
                false
            );
        }
    }


    return (
        <div
            className={
                styles.settingsBody
            }
        >
            <section
                className={
                    styles.cardSection
                }
            >
                <div
                    className={
                        styles.segmentedControl
                    }
                >
                    {
                        MANAGED_CATEGORY_TYPES.map(
                            type => (
                                <button
                                    type="button"
                                    key={
                                        type
                                    }
                                    className={
                                        selectedType ===
                                        type
                                            ? styles.segmentButtonActive
                                            : styles.segmentButton
                                    }
                                    disabled={
                                        Boolean(
                                            busyKey
                                        ) ||
                                        inputPreference.saving
                                    }
                                    onClick={
                                        () => {
                                            setSelectedType(
                                                type
                                            );

                                            setEditingId(
                                                null
                                            );

                                            setMenuCategoryId(
                                                null
                                            );

                                            setError(
                                                ""
                                            );

                                            setFeedback(
                                                ""
                                            );

                                            inputPreference
                                                .clearMessages();
                                        }
                                    }
                                >
                                    {type}
                                </button>
                            )
                        )
                    }
                </div>

                <div
                    className={
                        styles.topActionRow
                    }
                >
                    <p>
                        {
                            reordering
                                ? "≡ 손잡이를 잡고 원하는 위치로 끌어 순서를 조정합니다."
                                : "카테고리를 관리하거나 입력 화면 순서를 바꿀 수 있습니다."
                        }
                    </p>

                    <button
                        type="button"
                        className={
                            reordering
                                ? styles.primaryButton
                                : styles.secondaryButton
                        }
                        disabled={
                            Boolean(
                                busyKey
                            ) ||
                            inputPreference.loading ||
                            Boolean(
                                inputPreference.error
                            ) ||
                            !normalizedPreferences ||
                            inputPreference.saving
                        }
                        onClick={
                            () => {
                                if (
                                    reordering
                                ) {
                                    void handleFinishReordering();

                                    return;
                                }

                                setEditingId(
                                    null
                                );

                                setMenuCategoryId(
                                    null
                                );

                                setReordering(
                                    true
                                );

                                inputPreference
                                    .clearMessages();
                            }
                        }
                    >
                        {
                            inputPreference.saving
                                ? "저장 중..."
                                : reordering
                                    ? "완료"
                                    : "순서 변경"
                        }
                    </button>
                </div>

                {
                    !reordering && (
                        <div
                            className={
                                styles.createRow
                            }
                        >
                            <label
                                className={
                                    styles.field
                                }
                            >
                                <span>
                                    새 {selectedType} 카테고리
                                </span>

                                <input
                                    type="text"
                                    value={
                                        newName
                                    }
                                    maxLength={
                                        40
                                    }
                                    placeholder="예: 식비"
                                    disabled={
                                        Boolean(
                                            busyKey
                                        )
                                    }
                                    onChange={
                                        event =>
                                            setNewName(
                                                event.target.value
                                            )
                                    }
                                    onKeyDown={
                                        event => {
                                            if (
                                                event.key ===
                                                "Enter"
                                            ) {
                                                event.preventDefault();

                                                void handleCreate();
                                            }
                                        }
                                    }
                                />
                            </label>

                            <button
                                type="button"
                                className={
                                    styles.primaryButton
                                }
                                disabled={
                                    Boolean(
                                        busyKey
                                    ) ||
                                    !newName.trim()
                                }
                                onClick={
                                    () =>
                                        void handleCreate()
                                }
                            >
                                {
                                    busyKey ===
                                    "create"
                                        ? "추가 중..."
                                        : "추가"
                                }
                            </button>
                        </div>
                    )
                }

                {
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
                    feedback && (
                        <p
                            className={
                                styles.feedback
                            }
                            role="status"
                        >
                            {feedback}
                        </p>
                    )
                }

                {
                    inputPreference.feedback && (
                        <p
                            className={
                                styles.feedback
                            }
                            role="status"
                        >
                            {
                                inputPreference.feedback
                            }
                        </p>
                    )
                }

                {
                    inputPreference.saveError && (
                        <p
                            className={
                                styles.error
                            }
                            role="alert"
                        >
                            {
                                inputPreference.saveError
                            }
                        </p>
                    )
                }

                {
                    loading
                        ? (
                            <p
                                className={
                                    styles.state
                                }
                            >
                                카테고리를 불러오는 중입니다.
                            </p>
                        )
                        : reordering
                            ? orderedActiveItems.length ===
                                0
                                ? (
                                    <p
                                        className={
                                            styles.emptyState
                                        }
                                    >
                                        순서를 변경할 카테고리가 없습니다.
                                    </p>
                                )
                                : (
                                    <ul
                                        className={
                                            styles.itemList
                                        }
                                    >
                                        {
                                            orderedActiveItems.map(
                                                (
                                                    category,
                                                    index
                                                ) => (
                                                    <li
                                                        key={
                                                            category.categoryId
                                                        }
                                                        data-category-reorder-id={
                                                            category.categoryId
                                                        }
                                                        className={`${styles.orderRow} ${
                                                            draggingCategoryId ===
                                                            category.categoryId
                                                                ? styles.draggingRow
                                                                : ""
                                                        }`}
                                                    >
                                                        <button
                                                            type="button"
                                                            className={
                                                                styles.dragHandle
                                                            }
                                                            aria-label={`${category.name} 순서 이동`}
                                                            disabled={
                                                                inputPreference.saving
                                                            }
                                                            onPointerDown={
                                                                event =>
                                                                    handleCategoryDragStart(
                                                                        event,
                                                                        category.categoryId
                                                                    )
                                                            }
                                                            onPointerMove={
                                                                handleCategoryDragMove
                                                            }
                                                            onPointerUp={
                                                                handleCategoryDragEnd
                                                            }
                                                            onPointerCancel={
                                                                handleCategoryDragEnd
                                                            }
                                                        >
                                                            ≡
                                                        </button>

                                                        <span
                                                            className={
                                                                styles.orderNumber
                                                            }
                                                        >
                                                            {
                                                                index +
                                                                1
                                                            }
                                                        </span>

                                                        <span
                                                            className={
                                                                styles.primaryItemText
                                                            }
                                                        >
                                                            {
                                                                category.name
                                                            }
                                                        </span>
                                                    </li>
                                                )
                                            )
                                        }
                                    </ul>
                                )
                            : managementItems.length ===
                                0
                                ? (
                                    <p
                                        className={
                                            styles.emptyState
                                        }
                                    >
                                        등록된 {selectedType} 카테고리가 없습니다.
                                    </p>
                                )
                                : (
                                    <ul
                                        className={
                                            styles.itemList
                                        }
                                    >
                                        {
                                            managementItems.map(
                                                category => {
                                                    const editing =
                                                        editingId ===
                                                        category.categoryId;

                                                    const menuOpen =
                                                        menuCategoryId ===
                                                        category.categoryId;

                                                    return (
                                                        <li
                                                            key={
                                                                category.categoryId
                                                            }
                                                            className={`${styles.managementRow} ${
                                                                !category.active
                                                                    ? styles.mutedRow
                                                                    : ""
                                                            }`}
                                                        >
                                                            {
                                                                editing
                                                                    ? (
                                                                        <div
                                                                            className={
                                                                                styles.inlineEdit
                                                                            }
                                                                        >
                                                                            <input
                                                                                type="text"
                                                                                value={
                                                                                    editingName
                                                                                }
                                                                                maxLength={
                                                                                    40
                                                                                }
                                                                                onChange={
                                                                                    event =>
                                                                                        setEditingName(
                                                                                            event.target.value
                                                                                        )
                                                                                }
                                                                            />

                                                                            <button
                                                                                type="button"
                                                                                className={
                                                                                    styles.secondarySmallButton
                                                                                }
                                                                                onClick={
                                                                                    () =>
                                                                                        setEditingId(
                                                                                            null
                                                                                        )
                                                                                }
                                                                            >
                                                                                취소
                                                                            </button>

                                                                            <button
                                                                                type="button"
                                                                                className={
                                                                                    styles.primarySmallButton
                                                                                }
                                                                                onClick={
                                                                                    () =>
                                                                                        void handleRename(
                                                                                            category
                                                                                        )
                                                                                }
                                                                            >
                                                                                저장
                                                                            </button>
                                                                        </div>
                                                                    )
                                                                    : (
                                                                        <>
                                                                            <span
                                                                                className={
                                                                                    styles.itemTextGroup
                                                                                }
                                                                            >
                                                                                <strong>
                                                                                    {
                                                                                        category.name
                                                                                    }
                                                                                </strong>

                                                                                <span>
                                                                                    {
                                                                                        category.active
                                                                                            ? "사용 중"
                                                                                            : "사용 중지"
                                                                                    }
                                                                                </span>
                                                                            </span>

                                                                            <div
                                                                                className={
                                                                                    styles.rowActions
                                                                                }
                                                                            >
                                                                                <button
                                                                                    type="button"
                                                                                    className={
                                                                                        styles.iconMenuButton
                                                                                    }
                                                                                    aria-label={`${category.name} 메뉴`}
                                                                                    aria-expanded={
                                                                                        menuOpen
                                                                                    }
                                                                                    onClick={
                                                                                        () =>
                                                                                            setMenuCategoryId(
                                                                                                current =>
                                                                                                    current ===
                                                                                                    category.categoryId
                                                                                                        ? null
                                                                                                        : category.categoryId
                                                                                            )
                                                                                    }
                                                                                >
                                                                                    ⋮
                                                                                </button>
                                                                            </div>
                                                                        </>
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

                {
                    activeMenuCategory &&
                    !reordering && (
                        <div
                            className={
                                styles.actionSheetBackdrop
                            }
                            role="presentation"
                            onClick={
                                () =>
                                    setMenuCategoryId(
                                        null
                                    )
                            }
                        >
                            <section
                                className={
                                    styles.actionSheet
                                }
                                role="dialog"
                                aria-modal="true"
                                aria-label={`${activeMenuCategory.name} 카테고리 메뉴`}
                                onClick={
                                    event =>
                                        event.stopPropagation()
                                }
                            >
                                <span
                                    className={
                                        styles.actionSheetHandle
                                    }
                                />

                                <strong
                                    className={
                                        styles.actionSheetTitle
                                    }
                                >
                                    {activeMenuCategory.name}
                                </strong>

                                <button
                                    type="button"
                                    className={
                                        styles.actionSheetButton
                                    }
                                    onClick={
                                        () => {
                                            setEditingId(
                                                activeMenuCategory.categoryId
                                            );

                                            setEditingName(
                                                activeMenuCategory.name
                                            );

                                            setMenuCategoryId(
                                                null
                                            );
                                        }
                                    }
                                >
                                    이름 변경
                                </button>

                                <button
                                    type="button"
                                    className={
                                        styles.actionSheetButton
                                    }
                                    onClick={
                                        () => {
                                            setMenuCategoryId(
                                                null
                                            );

                                            void runMutation(
                                                `active:${activeMenuCategory.categoryId}`,

                                                () =>
                                                    updateManagedCategory({
                                                        categoryId:
                                                            activeMenuCategory.categoryId,

                                                        active:
                                                            !activeMenuCategory.active
                                                    }),

                                                activeMenuCategory.active
                                                    ? "카테고리를 사용 중지했습니다."
                                                    : "카테고리를 다시 사용합니다."
                                            );
                                        }
                                    }
                                >
                                    {
                                        activeMenuCategory.active
                                            ? "사용 중지"
                                            : "다시 사용"
                                    }
                                </button>

                                <button
                                    type="button"
                                    className={`${styles.actionSheetButton} ${styles.actionSheetDanger}`}
                                    onClick={
                                        () => {
                                            setMenuCategoryId(
                                                null
                                            );

                                            void handleDelete(
                                                activeMenuCategory
                                            );
                                        }
                                    }
                                >
                                    삭제
                                </button>

                                <button
                                    type="button"
                                    className={
                                        styles.actionSheetCancel
                                    }
                                    onClick={
                                        () =>
                                            setMenuCategoryId(
                                                null
                                            )
                                    }
                                >
                                    취소
                                </button>
                            </section>
                        </div>
                    )
                }


                {
                    !reordering && (
                        <details
                            className={
                                styles.deletedSection
                            }
                        >
                            <summary>
                                삭제된 {selectedType} 카테고리

                                <span>
                                    {
                                        deletedItems.length
                                    }
                                </span>
                            </summary>

                            {
                                deletedItems.length ===
                                0
                                    ? (
                                        <p
                                            className={
                                                styles.emptyState
                                            }
                                        >
                                            삭제된 카테고리가 없습니다.
                                        </p>
                                    )
                                    : (
                                        <ul
                                            className={
                                                styles.itemList
                                            }
                                        >
                                            {
                                                deletedItems.map(
                                                    category => (
                                                        <li
                                                            key={
                                                                category.categoryId
                                                            }
                                                            className={
                                                                styles.deletedRow
                                                            }
                                                        >
                                                            <span>
                                                                {
                                                                    category.name
                                                                }
                                                            </span>

                                                            <button
                                                                type="button"
                                                                className={
                                                                    styles.restoreButton
                                                                }
                                                                onClick={
                                                                    () =>
                                                                        void runMutation(
                                                                            `restore:${category.categoryId}`,

                                                                            () =>
                                                                                restoreManagedCategory(
                                                                                    category.categoryId
                                                                                ),

                                                                            "카테고리를 복원했습니다."
                                                                        )
                                                                }
                                                            >
                                                                복원
                                                            </button>
                                                        </li>
                                                    )
                                                )
                                            }
                                        </ul>
                                    )
                            }
                        </details>
                    )
                }
            </section>
        </div>
    );
}


function AccountSettings() {
    const [
        initialSnapshot
    ] =
        useState(
            () =>
                getManagedAccountsSnapshot()
        );

    const [
        accounts,
        setAccounts
    ] =
        useState<
            ManagedAccount[]
        >(
            () =>
                initialSnapshot
                    ?.items ||
                []
        );

    const [
        form,
        setForm
    ] =
        useState<
            AccountFormState
        >(
            createEmptyAccountForm
        );

    const [
        editingId,
        setEditingId
    ] =
        useState<
            string |
            null
        >(
            null
        );

    const [
        menuAccountId,
        setMenuAccountId
    ] =
        useState<
            string |
            null
        >(
            null
        );

    const [
        showForm,
        setShowForm
    ] =
        useState(
            false
        );

    const [
        reordering,
        setReordering
    ] =
        useState(
            false
        );

    const [
        draggingAccountId,
        setDraggingAccountId
    ] =
        useState<
            string |
            null
        >(
            null
        );

    const accountDragPointerId =
        useRef<
            number |
            null
        >(
            null
        );

    const [
        loading,
        setLoading
    ] =
        useState(
            initialSnapshot ===
                null
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
        ownerTab,
        setOwnerTab
    ] =
        useState<
            AccountOwnerTab
        >(
            "미영"
        );

    const inputPreference =
        useInputPreferenceData();


    async function refresh() {
        const result =
            await getManagedAccounts({
                includeDeleted:
                    true
            });

        setAccounts(
            result.items
        );
    }


    useEffect(
        () => {
            let active =
                true;

            async function load() {
                if (
                    !initialSnapshot
                ) {
                    setLoading(
                        true
                    );
                }

                setError(
                    ""
                );

                try {
                    const result =
                        await getManagedAccounts({
                            includeDeleted:
                                true
                        });

                    if (
                        active
                    ) {
                        setAccounts(
                            result.items
                        );
                    }
                } catch (
                    loadError
                ) {
                    if (
                        active &&
                        !initialSnapshot
                    ) {
                        setError(
                            getErrorMessage(
                                loadError,
                                "자산 정보를 불러오지 못했습니다."
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
        [
            initialSnapshot
        ]
    );


    const nonDeletedAccounts =
        useMemo(
            () =>
                accounts.filter(
                    account =>
                        !account.isDeleted
                ),
            [
                accounts
            ]
        );


    const ownerAccounts =
        useMemo(
            () =>
                nonDeletedAccounts.filter(
                    account =>
                        account.owner ===
                        ownerTab
                ),
            [
                nonDeletedAccounts,
                ownerTab
            ]
        );


    const deletedAccounts =
        useMemo(
            () =>
                accounts.filter(
                    account =>
                        account.isDeleted &&
                        account.owner ===
                            ownerTab
                ),
            [
                accounts,
                ownerTab
            ]
        );


    const inputAccounts =
        useMemo<
            InputAccount[]
        >(
            () =>
                nonDeletedAccounts
                    .filter(
                        account =>
                            account.active
                    )
                    .map(
                        account => ({
                            accountId:
                                account.accountId,

                            accountName:
                                account.accountName,

                            displayName:
                                account.displayName,

                            accountType:
                                account.accountType,

                            subType:
                                account.subType,

                            owner:
                                account.owner,

                            paymentAccountId:
                                account.paymentAccountId
                        })
                    ),
            [
                nonDeletedAccounts
            ]
        );


    const normalizedPreferences =
        useMemo(
            () => {
                if (
                    !inputPreference.preferences ||
                    !inputPreference.bootstrap
                ) {
                    return null;
                }

                return normalizeInputPreferences(
                    inputPreference.preferences,
                    inputPreference
                        .bootstrap
                        .categories,
                    inputAccounts
                );
            },
            [
                inputPreference.preferences,
                inputPreference.bootstrap,
                inputAccounts
            ]
        );


    const orderedActiveAccounts =
        useMemo(
            () => {
                const active =
                    ownerAccounts.filter(
                        account =>
                            account.active
                    );

                if (
                    !normalizedPreferences
                ) {
                    return active;
                }

                const orderedInput =
                    sortAccountsByPreferences(
                        inputAccounts,
                        normalizedPreferences
                    ).filter(
                        account =>
                            account.owner ===
                            ownerTab
                    );

                const byId =
                    new Map(
                        active.map(
                            account => [
                                account.accountId,
                                account
                            ] as const
                        )
                    );

                return orderedInput
                    .map(
                        account =>
                            byId.get(
                                account.accountId
                            )
                    )
                    .filter(
                        (
                            account
                        ): account is ManagedAccount =>
                            Boolean(
                                account
                            )
                    );
            },
            [
                ownerAccounts,
                inputAccounts,
                normalizedPreferences,
                ownerTab
            ]
        );


    const inactiveAccounts =
        useMemo(
            () =>
                ownerAccounts
                    .filter(
                        account =>
                            !account.active
                    )
                    .slice()
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            a.displayName.localeCompare(
                                b.displayName,
                                "ko"
                            )
                    ),
            [
                ownerAccounts
            ]
        );


    const managementItems =
        useMemo(
            () => [
                ...orderedActiveAccounts,
                ...inactiveAccounts
            ],
            [
                orderedActiveAccounts,
                inactiveAccounts
            ]
        );


    const activeMenuAccount =
        managementItems.find(
            account =>
                account.accountId ===
                menuAccountId
        ) || null;


    useEffect(
        () => {
            if (
                !activeMenuAccount
            ) {
                return;
            }

            const previousOverflow =
                document.body.style.overflow;

            document.body.style.overflow =
                "hidden";

            return () => {
                document.body.style.overflow =
                    previousOverflow;
            };
        },
        [
            activeMenuAccount
        ]
    );


    const hiddenAccountSet =
        useMemo(
            () =>
                new Set(
                    normalizedPreferences
                        ?.hiddenAccountIds ||
                    []
                ),
            [
                normalizedPreferences
            ]
        );


    const ownerOptions =
        useMemo(
            () =>
                Array.from(
                    new Set([
                        ...FIXED_OWNERS,

                        ...accounts
                            .map(
                                account =>
                                    account.owner
                            )
                            .filter(
                                Boolean
                            )
                    ])
                ),
            [
                accounts
            ]
        );


    const paymentAccountOptions =
        useMemo(
            () =>
                nonDeletedAccounts
                    .filter(
                        account =>
                            account.active
                    )
                    .filter(
                        account => {
                            if (
                                account.accountId ===
                                editingId
                            ) {
                                return false;
                            }

                            return ![
                                "체크카드",
                                "신용카드",
                                "주식",
                                "대출"
                            ].some(
                                keyword =>
                                    account.subType.includes(
                                        keyword
                                    )
                            );
                        }
                    ),
            [
                nonDeletedAccounts,
                editingId
            ]
        );


    const isCard =
        form.subType ===
            "체크카드" ||
        form.subType ===
            "신용카드";


    const selectedKind =
        getAccountKind(
            form.accountType,
            form.subType
        );


    function updateForm<
        K extends
            keyof AccountFormState
    >(
        key:
            K,

        value:
            AccountFormState[K]
    ) {
        setForm(
            current => ({
                ...current,

                [key]:
                    value
            })
        );
    }


    function handleKindChange(
        value:
            string
    ) {
        const kind =
            ACCOUNT_KIND_OPTIONS.find(
                option =>
                    option.value ===
                    value
            );

        if (
            !kind
        ) {
            return;
        }

        setForm(
            current =>
                applyAccountKind(
                    current,
                    kind
                )
        );
    }


    function beginCreate() {
        setEditingId(
            null
        );

        setMenuAccountId(
            null
        );

        setForm(
            createEmptyAccountForm(
                ownerTab
            )
        );

        setShowForm(
            true
        );

        setError(
            ""
        );

        setFeedback(
            ""
        );
    }


    function beginEdit(
        account:
            ManagedAccount
    ) {
        setEditingId(
            account.accountId
        );

        setMenuAccountId(
            null
        );

        setForm(
            accountToForm(
                account
            )
        );

        setShowForm(
            true
        );

        setError(
            ""
        );

        setFeedback(
            ""
        );
    }


    function closeForm() {
        setEditingId(
            null
        );

        setForm(
            createEmptyAccountForm(
                ownerTab
            )
        );

        setShowForm(
            false
        );
    }


    async function runMutation(
        key:
            string,

        work:
            () =>
                Promise<unknown>,

        successMessage:
            string
    ) {
        if (
            busyKey
        ) {
            return false;
        }

        setBusyKey(
            key
        );

        setError(
            ""
        );

        setFeedback(
            ""
        );

        setMenuAccountId(
            null
        );

        try {
            await work();

            await refresh();

            setFeedback(
                successMessage
            );

            return true;
        } catch (
            mutationError
        ) {
            setError(
                getErrorMessage(
                    mutationError,
                    "자산 정보를 처리하지 못했습니다."
                )
            );

            return false;
        } finally {
            setBusyKey(
                ""
            );
        }
    }


    async function handleSave() {
        let payload:
            SaveAccountInput;

        try {
            payload =
                buildAccountPayload(
                    form
                );
        } catch (
            validationError
        ) {
            setError(
                getErrorMessage(
                    validationError,
                    "입력값을 확인해주세요."
                )
            );

            return;
        }

        const completed =
            editingId
                ? await runMutation(
                    `save:${editingId}`,

                    () =>
                        updateManagedAccount({
                            accountId:
                                editingId,

                            ...payload
                        }),

                    "자산 정보를 수정했습니다."
                )
                : await runMutation(
                    "create",

                    () =>
                        createManagedAccount(
                            payload
                        ),

                    "새 항목을 추가했습니다."
                );

        if (
            completed
        ) {
            closeForm();
        }
    }


    async function handleDelete(
        account:
            ManagedAccount
    ) {
        if (
            !window.confirm(
                `‘${account.displayName}’ 항목을 삭제할까요?\n\n거래나 카드 결제계좌로 사용 중이면 삭제되지 않습니다. 그 경우 사용 종료 연도를 설정해주세요.`
            )
        ) {
            return;
        }

        await runMutation(
            `delete:${account.accountId}`,

            () =>
                deleteManagedAccount(
                    account.accountId
                ),

            "항목을 삭제했습니다."
        );
    }


    function reorderAccount(
        draggedId:
            string,

        targetId:
            string
    ) {
        if (
            !normalizedPreferences ||
            draggedId ===
                targetId
        ) {
            return;
        }

        const ownerIds =
            orderedActiveAccounts.map(
                account =>
                    account.accountId
            );

        const fromIndex =
            ownerIds.indexOf(
                draggedId
            );

        const toIndex =
            ownerIds.indexOf(
                targetId
            );

        if (
            fromIndex < 0 ||
            toIndex < 0
        ) {
            return;
        }

        const nextOrder =
            moveSubsetToIndex(
                normalizedPreferences
                    .accountOrder,
                ownerIds,
                fromIndex,
                toIndex
            );

        inputPreference.setPreferences({
            ...normalizedPreferences,

            accountOrder:
                nextOrder
        });

        inputPreference.clearMessages();
    }


    function handleAccountDragStart(
        event:
            ReactPointerEvent<HTMLButtonElement>,

        accountId:
            string
    ) {
        if (
            inputPreference.saving
        ) {
            return;
        }

        accountDragPointerId.current =
            event.pointerId;

        event.currentTarget.setPointerCapture(
            event.pointerId
        );

        setDraggingAccountId(
            accountId
        );
    }


    function handleAccountDragMove(
        event:
            ReactPointerEvent<HTMLButtonElement>
    ) {
        if (
            draggingAccountId ===
                null ||
            accountDragPointerId.current !==
                event.pointerId
        ) {
            return;
        }

        event.preventDefault();
        autoScrollForPointer(
            event.clientY
        );

        const target =
            document
                .elementFromPoint(
                    event.clientX,
                    event.clientY
                )
                ?.closest<HTMLElement>(
                    "[data-account-reorder-id]"
                );

        const targetId =
            target?.dataset
                .accountReorderId;

        if (
            targetId
        ) {
            reorderAccount(
                draggingAccountId,
                targetId
            );
        }
    }


    function handleAccountDragEnd(
        event:
            ReactPointerEvent<HTMLButtonElement>
    ) {
        if (
            accountDragPointerId.current ===
                event.pointerId
        ) {
            accountDragPointerId.current =
                null;

            setDraggingAccountId(
                null
            );
        }
    }


    async function handleFinishReordering() {
        if (
            !normalizedPreferences ||
            !inputPreference.bootstrap
        ) {
            return;
        }

        const saved =
            await inputPreference
                .savePreferencesToServer(
                    normalizedPreferences,
                    {
                        categories:
                            inputPreference
                                .bootstrap
                                .categories,

                        accounts:
                            inputAccounts,

                        successMessage:
                            "입력 화면 자산 순서를 저장했습니다."
                    }
                );

        if (
            saved
        ) {
            setReordering(
                false
            );
        }
    }


    async function handleToggleInputVisibility(
        account:
            ManagedAccount
    ) {
        if (
            !normalizedPreferences ||
            !inputPreference.bootstrap
        ) {
            return;
        }

        const hidden =
            new Set(
                normalizedPreferences
                    .hiddenAccountIds
            );

        const wasHidden =
            hidden.has(
                account.accountId
            );

        if (
            wasHidden
        ) {
            hidden.delete(
                account.accountId
            );
        } else {
            hidden.add(
                account.accountId
            );
        }

        const nextPreferences:
            InputPreferences = {
                ...normalizedPreferences,

                hiddenAccountIds:
                    Array.from(
                        hidden
                    )
            };

        setMenuAccountId(
            null
        );

        await inputPreference
            .savePreferencesToServer(
                nextPreferences,
                {
                    categories:
                        inputPreference
                            .bootstrap
                            .categories,

                    accounts:
                        inputAccounts,

                    successMessage:
                        wasHidden
                            ? "입력 화면에 표시합니다."
                            : "입력 화면에서 숨겼습니다."
                }
            );
    }


    function renderAccountForm() {
        return (
            <section
                                                className={
                                                    styles.formCard
                                                }
                                            >
                                                <div
                                                    className={
                                                        styles.formHeader
                                                    }
                                                >
                                                    <div>
                                                        <h2>
                                                            {
                                                                editingId
                                                                    ? "항목 수정"
                                                                    : "새 항목 추가"
                                                            }
                                                        </h2>

                                                        <p>
                                                            종류만 선택하면 내부 자산·부채 분류와 잔액 방식은 앱이 자동으로 정합니다.
                                                        </p>
                                                    </div>

                                                    <button
                                                        type="button"
                                                        className={
                                                            styles.closeButton
                                                        }
                                                        aria-label="입력창 닫기"
                                                        disabled={
                                                            Boolean(
                                                                busyKey
                                                            )
                                                        }
                                                        onClick={
                                                            closeForm
                                                        }
                                                    >
                                                        ×
                                                    </button>
                                                </div>

                                                <div
                                                    className={
                                                        styles.formGrid
                                                    }
                                                >
                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            이름
                                                        </span>

                                                        <input
                                                            type="text"
                                                            value={
                                                                form.accountName
                                                            }
                                                            maxLength={
                                                                60
                                                            }
                                                            disabled={
                                                                Boolean(
                                                                    busyKey
                                                                )
                                                            }
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "accountName",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        />
                                                    </label>

                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            명의자
                                                        </span>

                                                        <select
                                                            value={
                                                                form.owner
                                                            }
                                                            disabled={
                                                                Boolean(
                                                                    busyKey
                                                                )
                                                            }
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "owner",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        >
                                                            {
                                                                ownerOptions.map(
                                                                    owner => (
                                                                        <option
                                                                            key={
                                                                                owner
                                                                            }
                                                                            value={
                                                                                owner
                                                                            }
                                                                        >
                                                                            {owner}
                                                                        </option>
                                                                    )
                                                                )
                                                            }
                                                        </select>
                                                    </label>

                                                    <label
                                                        className={`${styles.field} ${styles.fullField}`}
                                                    >
                                                        <span>
                                                            종류
                                                        </span>

                                                        <select
                                                            value={
                                                                selectedKind
                                                                    ?.value ||
                                                                "__legacy__"
                                                            }
                                                            disabled={
                                                                Boolean(
                                                                    busyKey
                                                                )
                                                            }
                                                            onChange={
                                                                event => {
                                                                    if (
                                                                        event.target.value ===
                                                                        "__legacy__"
                                                                    ) {
                                                                        return;
                                                                    }

                                                                    handleKindChange(
                                                                        event.target.value
                                                                    );
                                                                }
                                                            }
                                                        >
                                                            {
                                                                !selectedKind && (
                                                                    <option
                                                                        value="__legacy__"
                                                                    >
                                                                        기존 분류 · {
                                                                            form.subType ||
                                                                            form.accountType ||
                                                                            "기타"
                                                                        }
                                                                    </option>
                                                                )
                                                            }

                                                            {
                                                                ACCOUNT_KIND_OPTIONS.map(
                                                                    option => (
                                                                        <option
                                                                            key={
                                                                                option.value
                                                                            }
                                                                            value={
                                                                                option.value
                                                                            }
                                                                        >
                                                                            {
                                                                                option.label
                                                                            }
                                                                        </option>
                                                                    )
                                                                )
                                                            }
                                                        </select>
                                                    </label>

                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            시작 잔액
                                                        </span>

                                                        <input
                                                            type="number"
                                                            inputMode="numeric"
                                                            value={
                                                                form.openingBalance
                                                            }
                                                            disabled={
                                                                Boolean(
                                                                    busyKey
                                                                )
                                                            }
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "openingBalance",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        />
                                                    </label>

                                                    {
                                                        isCard && (
                                                            <label
                                                                className={`${styles.field} ${styles.fullField}`}
                                                            >
                                                                <span>
                                                                    카드 결제계좌
                                                                </span>

                                                                <select
                                                                    value={
                                                                        form.paymentAccountId
                                                                    }
                                                                    disabled={
                                                                        Boolean(
                                                                            busyKey
                                                                        )
                                                                    }
                                                                    onChange={
                                                                        event =>
                                                                            updateForm(
                                                                                "paymentAccountId",
                                                                                event.target.value
                                                                            )
                                                                    }
                                                                >
                                                                    <option
                                                                        value=""
                                                                    >
                                                                        선택해주세요
                                                                    </option>

                                                                    {
                                                                        paymentAccountOptions.map(
                                                                            account => (
                                                                                <option
                                                                                    key={
                                                                                        account.accountId
                                                                                    }
                                                                                    value={
                                                                                        account.accountId
                                                                                    }
                                                                                >
                                                                                    {
                                                                                        account.displayName
                                                                                    }
                                                                                </option>
                                                                            )
                                                                        )
                                                                    }
                                                                </select>
                                                            </label>
                                                        )
                                                    }

                                                    {
                                                        form.subType ===
                                                            "신용카드" && (
                                                            <>
                                                                <label
                                                                    className={
                                                                        styles.field
                                                                    }
                                                                >
                                                                    <span>
                                                                        청구 마감일
                                                                    </span>

                                                                    <input
                                                                        type="number"
                                                                        min={
                                                                            1
                                                                        }
                                                                        max={
                                                                            31
                                                                        }
                                                                        value={
                                                                            form.billingCutoffDay
                                                                        }
                                                                        placeholder="1~31"
                                                                        onChange={
                                                                            event =>
                                                                                updateForm(
                                                                                    "billingCutoffDay",
                                                                                    event.target.value
                                                                                )
                                                                        }
                                                                    />
                                                                </label>

                                                                <label
                                                                    className={
                                                                        styles.field
                                                                    }
                                                                >
                                                                    <span>
                                                                        결제일
                                                                    </span>

                                                                    <input
                                                                        type="number"
                                                                        min={
                                                                            1
                                                                        }
                                                                        max={
                                                                            31
                                                                        }
                                                                        value={
                                                                            form.paymentDay
                                                                        }
                                                                        placeholder="1~31"
                                                                        onChange={
                                                                            event =>
                                                                                updateForm(
                                                                                    "paymentDay",
                                                                                    event.target.value
                                                                                )
                                                                        }
                                                                    />
                                                                </label>
                                                            </>
                                                        )
                                                    }

                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            사용 시작 연도
                                                        </span>

                                                        <input
                                                            type="number"
                                                            min={
                                                                1900
                                                            }
                                                            max={
                                                                2200
                                                            }
                                                            value={
                                                                form.startYear
                                                            }
                                                            placeholder="선택 입력"
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "startYear",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        />
                                                    </label>

                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            사용 종료 연도
                                                        </span>

                                                        <input
                                                            type="number"
                                                            min={
                                                                1900
                                                            }
                                                            max={
                                                                2200
                                                            }
                                                            value={
                                                                form.endYear
                                                            }
                                                            placeholder="사용 중이면 비워두기"
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "endYear",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        />
                                                    </label>
                                                </div>

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

                                                <div
                                                    className={
                                                        styles.formActions
                                                    }
                                                >
                                                    <button
                                                        type="button"
                                                        className={
                                                            styles.secondaryButton
                                                        }
                                                        onClick={
                                                            closeForm
                                                        }
                                                    >
                                                        취소
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className={
                                                            styles.primaryButton
                                                        }
                                                        onClick={
                                                            () =>
                                                                void handleSave()
                                                        }
                                                    >
                                                        {
                                                            busyKey
                                                                ? "저장 중..."
                                                                : editingId
                                                                    ? "수정 저장"
                                                                    : "추가"
                                                        }
                                                    </button>
                                                </div>
                                            </section>
        );
    }


    return (
        <div
            className={
                styles.settingsBody
            }
        >
            <section
                className={
                    styles.cardSection
                }
            >
                <div
                    className={
                        styles.segmentedControl
                    }
                >
                    {
                        ACCOUNT_OWNER_TABS.map(
                            owner => (
                                <button
                                    type="button"
                                    key={
                                        owner
                                    }
                                    className={
                                        ownerTab ===
                                        owner
                                            ? styles.segmentButtonActive
                                            : styles.segmentButton
                                    }
                                    disabled={
                                        Boolean(
                                            busyKey
                                        ) ||
                                        inputPreference.saving
                                    }
                                    onClick={
                                        () => {
                                            setOwnerTab(
                                                owner
                                            );

                                            setEditingId(
                                                null
                                            );

                                            setMenuAccountId(
                                                null
                                            );

                                            setShowForm(
                                                false
                                            );

                                            setForm(
                                                createEmptyAccountForm(
                                                    owner
                                                )
                                            );

                                            setError(
                                                ""
                                            );

                                            setFeedback(
                                                ""
                                            );
                                        }
                                    }
                                >
                                    {owner}
                                    {" "}
                                    {
                                        accounts.filter(
                                            account =>
                                                !account.isDeleted &&
                                                account.owner ===
                                                    owner
                                        ).length
                                    }
                                </button>
                            )
                        )
                    }
                </div>
            </section>

            <div
                className={
                    styles.topActionRow
                }
            >
                <p>
                    {
                        reordering
                            ? `≡ 손잡이를 잡고 ${ownerTab} 항목을 원하는 위치로 끌어 놓으세요.`
                            : "통장·현금·카드·대출·투자계좌를 한곳에서 관리합니다."
                    }
                </p>

                <div
                    className={
                        styles.rowActions
                    }
                >
                    {
                        !reordering && (
                            <button
                                type="button"
                                className={
                                    styles.primaryButton
                                }
                                disabled={
                                    Boolean(
                                        busyKey
                                    )
                                }
                                onClick={
                                    beginCreate
                                }
                            >
                                항목 추가
                            </button>
                        )
                    }

                    <button
                        type="button"
                        className={
                            reordering
                                ? styles.primaryButton
                                : styles.secondaryButton
                        }
                        disabled={
                            Boolean(
                                busyKey
                            ) ||
                            inputPreference.loading ||
                            Boolean(
                                inputPreference.error
                            ) ||
                            !normalizedPreferences ||
                            inputPreference.saving
                        }
                        onClick={
                            () => {
                                if (
                                    reordering
                                ) {
                                    void handleFinishReordering();

                                    return;
                                }

                                setShowForm(
                                    false
                                );

                                setEditingId(
                                    null
                                );

                                setMenuAccountId(
                                    null
                                );

                                inputPreference
                                    .clearMessages();

                                setReordering(
                                    true
                                );
                            }
                        }
                    >
                        {
                            inputPreference.saving
                                ? "저장 중..."
                                : reordering
                                    ? "완료"
                                    : "순서 변경"
                        }
                    </button>
                </div>
            </div>

            {
                !reordering &&
                showForm &&
                !editingId &&
                renderAccountForm()
            }

            {
                error &&
                !showForm && (
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

            {
                inputPreference.feedback && (
                    <p
                        className={
                            styles.feedback
                        }
                    >
                        {
                            inputPreference.feedback
                        }
                    </p>
                )
            }

            {
                inputPreference.saveError && (
                    <p
                        className={
                            styles.error
                        }
                    >
                        {
                            inputPreference.saveError
                        }
                    </p>
                )
            }

            <section
                className={
                    styles.cardSection
                }
            >
                {
                    loading
                        ? (
                            <p
                                className={
                                    styles.state
                                }
                            >
                                자산 정보를 불러오는 중입니다.
                            </p>
                        )
                        : reordering
                            ? orderedActiveAccounts.length ===
                                0
                                ? (
                                    <p
                                        className={
                                            styles.emptyState
                                        }
                                    >
                                        순서를 변경할 사용 중인 항목이 없습니다.
                                    </p>
                                )
                                : (
                                    <ul
                                        className={
                                            styles.itemList
                                        }
                                    >
                                        {
                                            orderedActiveAccounts.map(
                                                (
                                                    account,
                                                    index
                                                ) => {
                                                    const hidden =
                                                        hiddenAccountSet.has(
                                                            account.accountId
                                                        );

                                                    return (
                                                        <li
                                                            key={
                                                                account.accountId
                                                            }
                                                            data-account-reorder-id={
                                                                account.accountId
                                                            }
                                                            className={`${styles.orderRow} ${
                                                                hidden
                                                                    ? styles.mutedRow
                                                                    : ""
                                                            } ${
                                                                draggingAccountId ===
                                                                account.accountId
                                                                    ? styles.draggingRow
                                                                    : ""
                                                            }`}
                                                        >
                                                            <button
                                                                type="button"
                                                                className={
                                                                    styles.dragHandle
                                                                }
                                                                aria-label={`${account.displayName} 순서 이동`}
                                                                disabled={
                                                                    inputPreference.saving
                                                                }
                                                                onPointerDown={
                                                                    event =>
                                                                        handleAccountDragStart(
                                                                            event,
                                                                            account.accountId
                                                                        )
                                                                }
                                                                onPointerMove={
                                                                    handleAccountDragMove
                                                                }
                                                                onPointerUp={
                                                                    handleAccountDragEnd
                                                                }
                                                                onPointerCancel={
                                                                    handleAccountDragEnd
                                                                }
                                                            >
                                                                ≡
                                                            </button>

                                                            <span
                                                                className={
                                                                    styles.orderNumber
                                                                }
                                                            >
                                                                {
                                                                    index +
                                                                    1
                                                                }
                                                            </span>

                                                            <span
                                                                className={
                                                                    styles.itemTextGroup
                                                                }
                                                            >
                                                                <strong>
                                                                    {
                                                                        account.displayName
                                                                    }
                                                                </strong>

                                                                <span>
                                                                    {
                                                                        getAccountKindLabel(
                                                                            account.accountType,
                                                                            account.subType
                                                                        )
                                                                    }
                                                                    {
                                                                        hidden
                                                                            ? " · 입력 숨김"
                                                                            : ""
                                                                    }
                                                                </span>
                                                            </span>
                                                        </li>
                                                    );
                                                }
                                            )
                                        }
                                    </ul>
                                )
                            : managementItems.length ===
                                0
                                ? (
                                    <p
                                        className={
                                            styles.emptyState
                                        }
                                    >
                                        {ownerTab} 명의로 등록된 항목이 없습니다.
                                    </p>
                                )
                                : (
                                    <ul
                                        className={
                                            styles.itemList
                                        }
                                    >
                                        {
                                            managementItems.map(
                                                account => {
                                                    const menuOpen =
                                                        menuAccountId ===
                                                        account.accountId;

                                                    const hidden =
                                                        hiddenAccountSet.has(
                                                            account.accountId
                                                        );

                                                    const editing =
                                                        editingId ===
                                                        account.accountId;

                                                    return (
                                                        <Fragment
                                                                                                                    key={
                                                                                                                        account.accountId
                                                                                                                    }
                                                                                                                >
                                                            <li
                                                                                                                        className={`${styles.managementRow} ${
                                                                                                                            !account.active
                                                                                                                                ? styles.mutedRow
                                                                                                                                : ""
                                                                                                                        }`}
                                                                                                                    >
                                                                                                                        <span
                                                                                                                            className={
                                                                                                                                styles.itemTextGroup
                                                                                                                            }
                                                                                                                        >
                                                                                                                            <strong>
                                                                                                                                {
                                                                                                                                    account.displayName
                                                                                                                                }
                                                                                                                            </strong>
                                                            
                                                                                                                            <span>
                                                                                                                                {
                                                                                                                                    getAccountKindLabel(
                                                                                                                                        account.accountType,
                                                                                                                                        account.subType
                                                                                                                                    )
                                                                                                                                }
                                                                                                                                {" · "}
                                                                                                                                {
                                                                                                                                    account.owner
                                                                                                                                }
                                                                                                                            </span>
                                                            
                                                                                                                            <span>
                                                                                                                                현재 잔액{" "}
                                                                                                                                {
                                                                                                                                    formatKrw(
                                                                                                                                        account.currentBalance
                                                                                                                                    )
                                                                                                                                }
                                                            
                                                                                                                                {
                                                                                                                                    !account.active
                                                                                                                                        ? " · 사용 종료"
                                                                                                                                        : hidden
                                                                                                                                            ? " · 입력 숨김"
                                                                                                                                            : " · 입력 표시"
                                                                                                                                }
                                                                                                                            </span>
                                                                                                                        </span>
                                                            
                                                                                                                        <div
                                                                                                                            className={
                                                                                                                                styles.rowActions
                                                                                                                            }
                                                                                                                        >
                                                                                                                            <button
                                                                                                                                type="button"
                                                                                                                                className={
                                                                                                                                    styles.iconMenuButton
                                                                                                                                }
                                                                                                                                aria-label={`${account.displayName} 메뉴`}
                                                                                                                                aria-expanded={
                                                                                                                                    menuOpen
                                                                                                                                }
                                                                                                                                onClick={
                                                                                                                                    () =>
                                                                                                                                        setMenuAccountId(
                                                                                                                                            current =>
                                                                                                                                                current ===
                                                                                                                                                account.accountId
                                                                                                                                                    ? null
                                                                                                                                                    : account.accountId
                                                                                                                                        )
                                                                                                                                }
                                                                                                                            >
                                                                                                                                ⋮
                                                                                                                            </button>
                                                                                                                        </div>
                                                                                                                    </li>
                                                        
                                                                                                                    {
                                                                                                                        showForm &&
                                                                                                                        editing && (
                                                                                                                            <li
                                                                                                                                className={
                                                                                                                                    styles.inlineFormListItem
                                                                                                                                }
                                                                                                                            >
                                                                                                                                {renderAccountForm()}
                                                                                                                            </li>
                                                                                                                        )
                                                                                                                    }
                                                                                                                </Fragment>
                                                    );
                                                }
                                            )
                                        }
                                    </ul>
                                )
                }

                {
                    activeMenuAccount &&
                    !reordering && (
                        <div
                            className={
                                styles.actionSheetBackdrop
                            }
                            role="presentation"
                            onClick={
                                () =>
                                    setMenuAccountId(
                                        null
                                    )
                            }
                        >
                            <section
                                className={
                                    styles.actionSheet
                                }
                                role="dialog"
                                aria-modal="true"
                                aria-label={`${activeMenuAccount.displayName} 메뉴`}
                                onClick={
                                    event =>
                                        event.stopPropagation()
                                }
                            >
                                <span
                                    className={
                                        styles.actionSheetHandle
                                    }
                                />

                                <strong
                                    className={
                                        styles.actionSheetTitle
                                    }
                                >
                                    {activeMenuAccount.displayName}
                                </strong>

                                <button
                                    type="button"
                                    className={
                                        styles.actionSheetButton
                                    }
                                    onClick={
                                        () =>
                                            beginEdit(
                                                activeMenuAccount
                                            )
                                    }
                                >
                                    수정
                                </button>

                                {
                                    activeMenuAccount.active &&
                                    normalizedPreferences &&
                                    inputPreference.bootstrap && (
                                        <button
                                            type="button"
                                            className={
                                                styles.actionSheetButton
                                            }
                                            disabled={
                                                inputPreference.saving
                                            }
                                            onClick={
                                                () =>
                                                    void handleToggleInputVisibility(
                                                        activeMenuAccount
                                                    )
                                            }
                                        >
                                            {
                                                hiddenAccountSet.has(
                                                    activeMenuAccount.accountId
                                                )
                                                    ? "입력 표시"
                                                    : "입력 숨김"
                                            }
                                        </button>
                                    )
                                }

                                <button
                                    type="button"
                                    className={`${styles.actionSheetButton} ${styles.actionSheetDanger}`}
                                    onClick={
                                        () => {
                                            setMenuAccountId(
                                                null
                                            );

                                            void handleDelete(
                                                activeMenuAccount
                                            );
                                        }
                                    }
                                >
                                    삭제
                                </button>

                                <button
                                    type="button"
                                    className={
                                        styles.actionSheetCancel
                                    }
                                    onClick={
                                        () =>
                                            setMenuAccountId(
                                                null
                                            )
                                    }
                                >
                                    취소
                                </button>
                            </section>
                        </div>
                    )
                }


                {
                    !reordering && (
                        <details
                            className={
                                styles.deletedSection
                            }
                        >
                            <summary>
                                삭제된 항목

                                <span>
                                    {
                                        deletedAccounts.length
                                    }
                                </span>
                            </summary>

                            {
                                deletedAccounts.length ===
                                0
                                    ? (
                                        <p
                                            className={
                                                styles.emptyState
                                            }
                                        >
                                            삭제된 항목이 없습니다.
                                        </p>
                                    )
                                    : (
                                        <ul
                                            className={
                                                styles.itemList
                                            }
                                        >
                                            {
                                                deletedAccounts.map(
                                                    account => (
                                                        <li
                                                            key={
                                                                account.accountId
                                                            }
                                                            className={
                                                                styles.deletedRow
                                                            }
                                                        >
                                                            <span>
                                                                {
                                                                    account.displayName
                                                                }
                                                            </span>

                                                            <button
                                                                type="button"
                                                                className={
                                                                    styles.restoreButton
                                                                }
                                                                onClick={
                                                                    () =>
                                                                        void runMutation(
                                                                            `restore:${account.accountId}`,

                                                                            () =>
                                                                                restoreManagedAccount(
                                                                                    account.accountId
                                                                                ),

                                                                            "항목을 복원했습니다."
                                                                        )
                                                                }
                                                            >
                                                                복원
                                                            </button>
                                                        </li>
                                                    )
                                                )
                                            }
                                        </ul>
                                    )
                            }
                        </details>
                    )
                }
            </section>
        </div>
    );
}


function LedgerDataSettings() {
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
            !window.confirm(
                "가계부 시작일 제한을 해제할까요?"
            )
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
                `우리_가계부_거래_${new Date()
                    .toISOString()
                    .slice(
                        0,
                        10
                    )}.csv`;

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

            <section
                className={
                    styles.cardSection
                }
            >
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
                                    <button
                                        type="button"
                                        className={
                                            styles.secondaryButton
                                        }
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
                                    </button>

                                    <button
                                        type="button"
                                        className={
                                            styles.primaryButton
                                        }
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
                                    </button>
                                </div>
                            </div>
                        )
                }
            </section>

            <section
                className={
                    styles.cardSection
                }
            >
                <button
                    type="button"
                    className={
                        styles.fullWidthButton
                    }
                    disabled={
                        Boolean(
                            busyKey
                        )
                    }
                    onClick={
                        () =>
                            void handleExport()
                    }
                >
                    전체 거래 CSV로 내보내기
                </button>
            </section>

            <section
                className={
                    styles.cardSection
                }
            >
                <button
                    type="button"
                    className={
                        styles.fullWidthButton
                    }
                    onClick={
                        () =>
                            window.location.reload()
                    }
                >
                    최신 데이터 다시 불러오기
                </button>
            </section>
        </div>
    );
}


function ProfileSettings() {
    const [
        userName,
        setUserName
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
        loggingOut,
        setLoggingOut
    ] =
        useState(
            false
        );


    useEffect(
        () => {
            let active =
                true;

            async function loadSession() {
                try {
                    const session =
                        await getSession();

                    if (
                        active &&
                        session.loggedIn &&
                        session.user
                    ) {
                        setUserName(
                            session.user.name
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

            void loadSession();

            return () => {
                active =
                    false;
            };
        },
        []
    );


    async function handleLogout() {
        if (
            !window.confirm(
                "로그아웃할까요?"
            )
        ) {
            return;
        }

        setLoggingOut(
            true
        );

        try {
            await logout();

            window.location.reload();
        } finally {
            setLoggingOut(
                false
            );
        }
    }


    return (
        <div
            className={
                styles.settingsBody
            }
        >
            <section
                className={
                    styles.cardSection
                }
            >
                <div
                    className={
                        styles.profileRow
                    }
                >
                    <span
                        className={
                            styles.avatar
                        }
                    >
                        {
                            (
                                userName ||
                                "내"
                            ).slice(
                                0,
                                1
                            )
                        }
                    </span>

                    <span
                        className={
                            styles.itemTextGroup
                        }
                    >
                        <strong>
                            {
                                loading
                                    ? "확인 중..."
                                    : userName ||
                                        "로그인 사용자"
                            }
                        </strong>

                        <span>
                            현재 로그인한 사용자
                        </span>
                    </span>
                </div>
            </section>

            <section
                className={
                    styles.cardSection
                }
            >
                <div
                    className={
                        styles.sectionHeading
                    }
                >
                    <h2>
                        우리 가계부
                    </h2>

                    <p>
                        미영·승철 두 사람이 함께 사용하는
                        부부 공유 가계부입니다.
                    </p>
                </div>

                <dl
                    className={
                        styles.infoList
                    }
                >
                    <div>
                        <dt>
                            로그인 유지
                        </dt>

                        <dd>
                            접속할 때마다 최대 400일로 연장
                        </dd>
                    </div>

                    <div>
                        <dt>
                            원본 데이터
                        </dt>

                        <dd>
                            Google Sheets
                        </dd>
                    </div>

                    <div>
                        <dt>
                            설정 공유
                        </dt>

                        <dd>
                            부부 공통 설정은 두 계정에 동일 적용
                        </dd>
                    </div>
                </dl>
            </section>

            <button
                type="button"
                className={
                    styles.logoutButton
                }
                disabled={
                    loggingOut
                }
                onClick={
                    () =>
                        void handleLogout()
                }
            >
                {
                    loggingOut
                        ? "로그아웃 중..."
                        : "로그아웃"
                }
            </button>
        </div>
    );
}


export default function SettingsPage() {
    const [
        view,
        setView
    ] =
        useState<
            SettingsView
        >(
            "home"
        );


    const detail = {
        categories: {
            title:
                "카테고리 관리",

            description:
                "카테고리를 관리하고 입력 화면 순서를 정합니다."
        },

        accounts: {
            title:
                "자산 관리",

            description:
                "자산을 관리하고 입력 화면 노출과 순서를 정합니다."
        },

        ledger: {
            title:
                "가계부 운영·데이터",

            description:
                "운영 기준과 데이터 내보내기를 관리합니다."
        },

        profile: {
            title:
                "내 계정·앱 정보",

            description:
                "현재 로그인 정보와 앱의 저장 방식을 확인합니다."
        }
    } as const;


    return (
        <main
            className={
                styles.page
            }
        >
            {
                view ===
                "home"
                    ? (
                        <SettingsHome
                            onOpen={
                                setView
                            }
                        />
                    )
                    : (
                        <>
                            <DetailHeader
                                title={
                                    detail[
                                        view
                                    ].title
                                }
                                description={
                                    detail[
                                        view
                                    ].description
                                }
                                onBack={
                                    () =>
                                        setView(
                                            "home"
                                        )
                                }
                            />

                            {
                                view ===
                                    "categories" && (
                                    <CategorySettings />
                                )
                            }

                            {
                                view ===
                                    "accounts" && (
                                    <AccountSettings />
                                )
                            }

                            {
                                view ===
                                    "ledger" && (
                                    <LedgerDataSettings />
                                )
                            }

                            {
                                view ===
                                    "profile" && (
                                    <ProfileSettings />
                                )
                            }
                        </>
                    )
            }
        </main>
    );
}
