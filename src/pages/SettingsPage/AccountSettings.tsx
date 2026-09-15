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
  getAutomationSettings,
  saveAutomationSettings
} from "../../api/automation";
import type {
  AutomationSettings,
  BenefitKind,
  BenefitRule
} from "../../api/automation";
import { getBootstrap } from "../../api/bootstrap";
import {
  clearBootstrapMemoryCache,
  getCachedBootstrapPayload
} from "../../api/bootstrapCache";
import type { BootstrapResponse } from "../../types/bootstrap";
import {
  createManagedAccount,
  deleteManagedAccount,
  getManagedAccounts,
  getManagedAccountsSnapshot,
  restoreManagedAccount,
  updateManagedAccount
} from "../../api/settingsManagement";
import type {
  ManagedAccount,
  SaveAccountInput
} from "../../api/settingsManagement";
import {
  normalizeInputPreferences,
  sortAccountsByPreferences
} from "../../utils/inputPreferences";
import type { InputPreferences } from "../../utils/inputPreferences";
import { markLedgerChanged } from "../../utils/ledgerEvents";
import { confirmAction } from "../../utils/confirmAction";
import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import {
  ACCOUNT_KIND_OPTIONS,
  accountToForm,
  applyAccountKind,
  buildAccountPayload,
  createEmptyAccountForm,
  formatKrw,
  getAccountKind,
  getAccountKindLabel,
  getBenefitRuleForAccount,
  parseBenefitSettings,
  parseRewardOpeningBalance
} from "./accountDomain";
import type { AccountFormState } from "./accountDomain";
import { AccountFormCard } from "./AccountFormCard";
import {
  autoScrollForPointer,
  buildOwnerTabs,
  getErrorMessage,
  moveSubsetToIndex
} from "./settingsShared";
import { useInputPreferenceData } from "./useInputPreferenceData";
import type { InputAccount } from "./useInputPreferenceData";
import styles from "./SettingsPage.module.css";

interface AccountSettingsProps {
    initialAccountId?: string;
    createNew?: boolean;
    initialOwner?: string;
    embedded?: boolean;
    onClose?: () => void;
    onSaved?: () => void | Promise<void>;
}

export function AccountSettings({
    initialAccountId,
    createNew = false,
    initialOwner,
    embedded = false,
    onClose,
    onSaved
}: AccountSettingsProps = {}) {
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
        householdMembers,
        setHouseholdMembers
    ] =
        useState<string[]>(
            () =>
                getCachedBootstrapPayload<BootstrapResponse>()
                    ?.data
                    ?.members
                    ?.filter(Boolean) ||
                []
        );

    const [
        automationSettings,
        setAutomationSettings
    ] =
        useState<
            AutomationSettings |
            null
        >(
            null
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

    const embeddedOpenedRef =
        useRef(false);

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

    const ownerTabTouchedRef =
        useRef(false);

    const [
        ownerTab,
        setOwnerTab
    ] =
        useState<string>(
            () =>
                initialOwner ||
                householdMembers[0] ||
                "공동"
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
                    const [
                        result,
                        nextAutomationSettings,
                        bootstrapResponse
                    ] =
                        await Promise.all([
                            getManagedAccounts({
                                includeDeleted:
                                    true
                            }),
                            getAutomationSettings(),
                            getBootstrap<BootstrapResponse>()
                                .catch(() => null)
                        ]);

                    if (
                        active
                    ) {
                        setAccounts(
                            result.items
                        );

                        setAutomationSettings(
                            nextAutomationSettings
                        );

                        if (
                            bootstrapResponse?.success &&
                            bootstrapResponse.data?.members
                        ) {
                            setHouseholdMembers(
                                bootstrapResponse.data.members.filter(Boolean)
                            );
                        }
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


    const ownerTabs =
        useMemo(
            () =>
                buildOwnerTabs(
                    householdMembers,
                    accounts.map(account => account.owner)
                ),
            [
                accounts,
                householdMembers
            ]
        );


    useEffect(
        () => {
            if (
                ownerTabTouchedRef.current ||
                initialOwner ||
                householdMembers.length === 0
            ) {
                return;
            }

            setOwnerTab(
                current =>
                    current === "공동"
                        ? householdMembers[0]
                        : current
            );
        },
        [
            householdMembers,
            initialOwner
        ]
    );


    useEffect(
        () => {
            if (
                !embedded ||
                embeddedOpenedRef.current
            ) {
                return;
            }

            if (
                createNew
            ) {
                const nextOwner =
                    ownerTabs.includes(
                        initialOwner || ""
                    )
                        ? initialOwner || "공동"
                        : "공동";

                embeddedOpenedRef.current =
                    true;
                setOwnerTab(
                    nextOwner
                );
                setEditingId(
                    null
                );
                setForm(
                    createEmptyAccountForm(
                        nextOwner
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
                return;
            }

            if (
                !initialAccountId ||
                !automationSettings
            ) {
                return;
            }

            const account =
                accounts.find(
                    item =>
                        item.accountId ===
                        initialAccountId
                );

            if (
                !account ||
                account.isDeleted
            ) {
                return;
            }

            embeddedOpenedRef.current =
                true;

            if (
                ownerTabs.includes(
                    account.owner
                )
            ) {
                setOwnerTab(
                    account.owner
                );
            }

            beginEdit(
                account
            );
        },
        [
            accounts,
            automationSettings,
            createNew,
            embedded,
            initialAccountId,
            initialOwner,
            ownerTabs
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
                        ...ownerTabs,

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
                accounts,
                ownerTabs
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
                account,
                getBenefitRuleForAccount(
                    automationSettings,
                    account.accountId
                )
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


    useEffect(
        () => {
            if (
                !automationSettings ||
                !editingId ||
                !showForm
            ) {
                return;
            }

            const account =
                accounts.find(
                    item =>
                        item.accountId ===
                            editingId
                );

            if (
                !account ||
                account.subType !==
                    "선불/지역화폐"
            ) {
                return;
            }

            const rule =
                getBenefitRuleForAccount(
                    automationSettings,
                    editingId
                );

            setForm(
                current => ({
                    ...current,
                    rewardOpeningBalance:
                        Number(
                            rule?.rewardOpeningBalance ||
                            0
                        ) > 0
                            ? String(
                                rule?.rewardOpeningBalance
                            )
                            : "",
                    benefitKind:
                        rule?.kind ||
                        "none",
                    benefitRatePercent:
                        Number(
                            rule?.ratePercent ||
                            0
                        ) > 0
                            ? String(
                                rule?.ratePercent
                            )
                            : "",
                    benefitMonthlyCap:
                        rule?.monthlyCap ===
                            null ||
                        rule?.monthlyCap ===
                            undefined
                            ? ""
                            : String(
                                rule.monthlyCap
                            ),
                    benefitValidFrom:
                        rule?.validFrom ||
                        "",
                    benefitValidTo:
                        rule?.validTo ||
                        ""
                })
            );
        },
        [
            accounts,
            automationSettings,
            editingId,
            showForm
        ]
    );


    async function persistAccountBenefitSettings(
        accountId:
            string,

        benefitSettings:
            Omit<
                BenefitRule,
                "id" |
                "accountId"
            > |
            null,

        isPrepaid:
            boolean
    ) {
        const latest =
            await getAutomationSettings();

        const existing =
            latest.benefitRules.find(
                rule =>
                    rule.accountId ===
                        accountId
            ) ||
            null;

        const remainingRules =
            latest.benefitRules.filter(
                rule =>
                    rule.accountId !==
                        accountId
            );

        if (
            !isPrepaid ||
            !benefitSettings
        ) {
            if (
                !existing
            ) {
                setAutomationSettings(
                    latest
                );
                return;
            }

            const saved =
                await saveAutomationSettings({
                    ...latest,
                    benefitRules:
                        remainingRules
                });

            setAutomationSettings(
                saved.settings
            );

            clearBootstrapMemoryCache();
            return;
        }

        const nextRule:
            BenefitRule = {
                id:
                    existing?.id ||
                    `BEN_${accountId}`,
                accountId,
                ...benefitSettings
            };

        const saved =
            await saveAutomationSettings({
                ...latest,
                benefitRules: [
                    ...remainingRules,
                    nextRule
                ]
            });

        setAutomationSettings(
            saved.settings
        );

        clearBootstrapMemoryCache();
    }

    function closeForm() {
        if (
            embedded &&
            onClose
        ) {
            onClose();
            return;
        }

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

            markLedgerChanged();

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

        let rewardOpeningBalance =
            0;

        let benefitSettings:
            Omit<
                BenefitRule,
                "id" |
                "accountId"
            > |
            null =
                null;

        try {
            payload =
                buildAccountPayload(
                    form
                );

            rewardOpeningBalance =
                parseRewardOpeningBalance(
                    form,
                    Number(
                        payload.openingBalance ||
                            0
                    )
                );

            benefitSettings =
                parseBenefitSettings(
                    form,
                    rewardOpeningBalance
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

                    async () => {
                        await updateManagedAccount({
                            accountId:
                                editingId,

                            ...payload
                        });

                        await persistAccountBenefitSettings(
                            editingId,
                            benefitSettings,
                            payload.subType ===
                                "선불/지역화폐"
                        );
                    },

                    "자산 정보를 수정했습니다."
                )
                : await runMutation(
                    "create",

                    async () => {
                        const created =
                            await createManagedAccount(
                                payload
                            );

                        const accountId =
                            created.account?.accountId ||
                            created.accountId ||
                            "";

                        if (
                            !accountId
                        ) {
                            throw new Error(
                                "새 자산의 식별값을 확인하지 못했습니다."
                            );
                        }

                        await persistAccountBenefitSettings(
                            accountId,
                            benefitSettings,
                            payload.subType ===
                                "선불/지역화폐"
                        );
                    },

                    "새 항목을 추가했습니다."
                );

        if (
            completed
        ) {
            if (
                onSaved
            ) {
                await onSaved();
            }

            closeForm();
        }
    }


    async function handleDelete(
        account:
            ManagedAccount
    ) {
        if (
            !(await confirmAction({
                title:
                    "자산 삭제",
                message:
                    `‘${account.displayName}’ 항목을 삭제할까요?\n\n거래나 카드 결제계좌로 사용 중이면 삭제되지 않습니다. 그 경우 사용 종료 연도를 설정해주세요.`,
                confirmLabel:
                    "삭제",
                tone:
                    "danger"
            }))
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
            <AccountFormCard
                editingId={editingId}
                busyKey={busyKey}
                form={form}
                ownerOptions={ownerOptions}
                selectedKind={selectedKind}
                paymentAccountOptions={paymentAccountOptions}
                automationSettings={automationSettings}
                error={error}
                closeForm={closeForm}
                updateForm={updateForm}
                handleKindChange={handleKindChange}
                setForm={setForm}
                handleSave={handleSave}
            />
        );
    }


    if (
        embedded
    ) {
        const focusedAccount =
            accounts.find(
                account =>
                    account.accountId ===
                    initialAccountId &&
                    !account.isDeleted
            );

        return (
            <div
                className={
                    styles.settingsBody
                }
            >
                {
                    loading && (
                        <p
                            className={
                                styles.state
                            }
                        >
                            계좌 정보를 불러오는 중입니다.
                        </p>
                    )
                }

                {
                    !loading &&
                    !createNew &&
                    !focusedAccount && (
                        <p
                            className={
                                styles.error
                            }
                        >
                            편집할 계좌를 찾을 수 없습니다.
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
                    !loading &&
                    showForm &&
                    (
                        createNew
                            ? editingId === null
                            : Boolean(
                                focusedAccount &&
                                editingId === focusedAccount.accountId
                            )
                    ) &&
                    renderAccountForm()
                }
            </div>
        );
    }


    return (
        <div
            className={
                styles.settingsBody
            }
        >
            <Card as="section">
                <div
                    className={
                        styles.segmentedControl
                    }
                >
                    {
                        ownerTabs.map(
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
                                            ownerTabTouchedRef.current = true;

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
            </Card>

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
                            <Button
                                
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
                            </Button>
                        )
                    }

                    <Button
                        variant={reordering ? "primary" : "secondary"}
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
                    </Button>
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

            <Card as="section">
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

                                                            <Button
                                                                variant="soft"
                                                                size="sm"
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
                                                            </Button>
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
            </Card>
        </div>
    );
}


