import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  PointerEvent as ReactPointerEvent
} from "react";

import {
  createManagedCategory,
  deleteManagedCategory,
  getManagedCategories,
  getManagedCategoriesSnapshot,
  restoreManagedCategory,
  updateManagedCategory
} from "../../api/settingsManagement";

import type {
  LedgerCategoryType,
  ManagedCategory
} from "../../api/settingsManagement";

import {
  applyCategoryPreferences,
  normalizeInputPreferences
} from "../../utils/inputPreferences";

import type {
  PreferenceTransactionType
} from "../../utils/inputPreferences";

import { confirmAction } from "../../utils/confirmAction";
import {
  isSystemSettlementCategory
} from "../../utils/settlement";
import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import {
  autoScrollForPointer,
  getErrorMessage,
  moveSubsetToIndex
} from "./settingsShared";
import {
  useInputPreferenceData
} from "./useInputPreferenceData";
import type { InputCategory } from "./useInputPreferenceData";
import styles from "./SettingsPage.module.css";

const MANAGED_CATEGORY_TYPES: LedgerCategoryType[] = [
  "지출",
  "수입",
  "이체"
];

export function CategorySettings() {
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
                        !category.isDeleted &&
                        !isSystemSettlementCategory(category)
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
                        category.isDeleted &&
                        !isSystemSettlementCategory(category)
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
                            category.active &&
                            !isSystemSettlementCategory(category)
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
            !(await confirmAction({
                title:
                    "카테고리 삭제",
                message:
                    `‘${category.name}’ 카테고리를 삭제할까요?\n\n거래에서 사용 중인 카테고리는 삭제되지 않습니다.`,
                confirmLabel:
                    "삭제",
                tone:
                    "danger"
            }))
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
            <Card as="section">
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
                    </Button>
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

                            <Button
                                
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
                            </Button>
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

                                                                            <Button
                                                                                variant="secondary"
                                                                                size="sm"
                                                                                onClick={
                                                                                    () =>
                                                                                        setEditingId(
                                                                                            null
                                                                                        )
                                                                                }
                                                                            >
                                                                                취소
                                                                            </Button>

                                                                            <Button
                                                                                size="sm"
                                                                                onClick={
                                                                                    () =>
                                                                                        void handleRename(
                                                                                            category
                                                                                        )
                                                                                }
                                                                            >
                                                                                저장
                                                                            </Button>
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

                                                            <Button
                                                                variant="soft"
                                                                size="sm"
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


