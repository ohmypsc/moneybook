export type PreferenceTransactionType =
  | "지출"
  | "수입"
  | "이체";

export interface PreferenceCategoryLike {
  categoryId: string;
  type: PreferenceTransactionType;
  name: string;
}

export interface PreferenceAccountLike {
  accountId: string;
  accountName?: string;
  displayName: string;
  accountType: string;
  subType: string;
}

export interface InputPreferences {
  version: 1;

  categoryOrder: Record<
    PreferenceTransactionType,
    string[]
  >;

  accountOrder: string[];

  hiddenAccountIds: string[];
}

const STORAGE_KEY =
  "moneybook.inputPreferences.v1";

const TRANSACTION_TYPES:
  PreferenceTransactionType[] = [
    "지출",
    "수입",
    "이체"
  ];


/**
 * =========================================================
 * 기본 표시 규칙
 * =========================================================
 *
 * 처음 설정을 열기 전에도
 * 입력 화면에 주식/대출/예적금 계좌가
 * 무더기로 보이지 않도록 기본값을 정합니다.
 *
 * 설정 화면에서 사용자가 직접 다시 켤 수 있습니다.
 */
export function isDefaultInputAccountVisible(
  account: PreferenceAccountLike
) {
  const accountType =
    String(
      account.accountType || ""
    ).trim();

  const subType =
    String(
      account.subType || ""
    ).trim();

  if (
    accountType === "투자"
  ) {
    return false;
  }

  const hiddenKeywords = [
    "주식",
    "대출",
    "예적금",
    "예금",
    "적금"
  ];

  if (
    hiddenKeywords.some(
      keyword =>
        subType.includes(
          keyword
        )
    )
  ) {
    return false;
  }

  return true;
}


/**
 * 저장된 순서에 아직 존재하는 ID만 유지하고,
 * 새로 생긴 항목은 뒤에 붙입니다.
 */
function mergeOrder(
  savedOrder: string[],
  currentIds: string[]
) {
  const currentSet =
    new Set(
      currentIds
    );

  const result =
    savedOrder.filter(
      id =>
        currentSet.has(id)
    );

  const resultSet =
    new Set(
      result
    );

  currentIds.forEach(
    id => {
      if (
        !resultSet.has(id)
      ) {
        result.push(id);
        resultSet.add(id);
      }
    }
  );

  return result;
}


function safeReadStoredPreferences():
  InputPreferences | null {
  if (
    typeof window ===
    "undefined"
  ) {
    return null;
  }

  try {
    const raw =
      window.localStorage.getItem(
        STORAGE_KEY
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw) as
        Partial<InputPreferences>;

    if (
      parsed.version !== 1 ||
      !parsed.categoryOrder ||
      !Array.isArray(
        parsed.accountOrder
      ) ||
      !Array.isArray(
        parsed.hiddenAccountIds
      )
    ) {
      return null;
    }

    return {
      version: 1,

      categoryOrder: {
        지출:
          Array.isArray(
            parsed.categoryOrder
              .지출
          )
            ? parsed.categoryOrder
                .지출
            : [],

        수입:
          Array.isArray(
            parsed.categoryOrder
              .수입
          )
            ? parsed.categoryOrder
                .수입
            : [],

        이체:
          Array.isArray(
            parsed.categoryOrder
              .이체
          )
            ? parsed.categoryOrder
                .이체
            : []
      },

      accountOrder:
        parsed.accountOrder,

      hiddenAccountIds:
        parsed.hiddenAccountIds
    };
  } catch {
    return null;
  }
}


export function createDefaultInputPreferences(
  categories:
    PreferenceCategoryLike[],
  accounts:
    PreferenceAccountLike[]
): InputPreferences {
  return {
    version: 1,

    categoryOrder: {
      지출:
        categories
          .filter(
            category =>
              category.type ===
              "지출"
          )
          .map(
            category =>
              category.categoryId
          ),

      수입:
        categories
          .filter(
            category =>
              category.type ===
              "수입"
          )
          .map(
            category =>
              category.categoryId
          ),

      이체:
        categories
          .filter(
            category =>
              category.type ===
              "이체"
          )
          .map(
            category =>
              category.categoryId
          )
    },

    accountOrder:
      accounts.map(
        account =>
          account.accountId
      ),

    hiddenAccountIds:
      accounts
        .filter(
          account =>
            !isDefaultInputAccountVisible(
              account
            )
        )
        .map(
          account =>
            account.accountId
        )
  };
}


export function normalizeInputPreferences(
  stored:
    InputPreferences | null,
  categories:
    PreferenceCategoryLike[],
  accounts:
    PreferenceAccountLike[]
): InputPreferences {
  if (!stored) {
    return createDefaultInputPreferences(
      categories,
      accounts
    );
  }

  const categoryOrder =
    {} as Record<
      PreferenceTransactionType,
      string[]
    >;

  TRANSACTION_TYPES.forEach(
    type => {
      const ids =
        categories
          .filter(
            category =>
              category.type ===
              type
          )
          .map(
            category =>
              category.categoryId
          );

      categoryOrder[type] =
        mergeOrder(
          stored
            .categoryOrder[type] ||
            [],
          ids
        );
    }
  );

  const currentAccountIds =
    accounts.map(
      account =>
        account.accountId
    );

  const originallyKnown =
    new Set(
      stored.accountOrder
    );

  const accountOrder =
    mergeOrder(
      stored.accountOrder,
      currentAccountIds
    );

  const currentAccountSet =
    new Set(
      currentAccountIds
    );

  const hiddenSet =
    new Set(
      stored.hiddenAccountIds.filter(
        id =>
          currentAccountSet.has(
            id
          )
      )
    );

  /*
   * 설정 저장 이후 새 계좌가 생긴 경우에는
   * 새 계좌의 종류에 따라 기본 표시 여부를 결정합니다.
   */
  accounts.forEach(
    account => {
      if (
        originallyKnown.has(
          account.accountId
        )
      ) {
        return;
      }

      if (
        !isDefaultInputAccountVisible(
          account
        )
      ) {
        hiddenSet.add(
          account.accountId
        );
      }
    }
  );

  return {
    version: 1,

    categoryOrder,

    accountOrder,

    hiddenAccountIds:
      Array.from(
        hiddenSet
      )
  };
}


export function getInputPreferences(
  categories:
    PreferenceCategoryLike[],
  accounts:
    PreferenceAccountLike[]
) {
  return normalizeInputPreferences(
    safeReadStoredPreferences(),
    categories,
    accounts
  );
}


export function saveInputPreferences(
  preferences:
    InputPreferences
) {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      preferences
    )
  );
}


export function resetInputPreferences(
  categories:
    PreferenceCategoryLike[],
  accounts:
    PreferenceAccountLike[]
) {
  if (
    typeof window !==
    "undefined"
  ) {
    window.localStorage.removeItem(
      STORAGE_KEY
    );
  }

  return createDefaultInputPreferences(
    categories,
    accounts
  );
}


function getOrderIndex(
  order: string[],
  id: string
) {
  const index =
    order.indexOf(id);

  return index >= 0
    ? index
    : Number.MAX_SAFE_INTEGER;
}


export function applyCategoryPreferences<
  T extends PreferenceCategoryLike
>(
  categories: T[],
  type:
    PreferenceTransactionType,
  preferences:
    InputPreferences
): T[] {
  const order =
    preferences
      .categoryOrder[type];

  return categories
    .filter(
      category =>
        category.type === type
    )
    .slice()
    .sort(
      (a, b) => {
        const orderDifference =
          getOrderIndex(
            order,
            a.categoryId
          ) -
          getOrderIndex(
            order,
            b.categoryId
          );

        if (
          orderDifference !== 0
        ) {
          return orderDifference;
        }

        return a.name.localeCompare(
          b.name,
          "ko"
        );
      }
    );
}


export function sortAccountsByPreferences<
  T extends PreferenceAccountLike
>(
  accounts: T[],
  preferences:
    InputPreferences
): T[] {
  const order =
    preferences.accountOrder;

  return accounts
    .slice()
    .sort(
      (a, b) => {
        const orderDifference =
          getOrderIndex(
            order,
            a.accountId
          ) -
          getOrderIndex(
            order,
            b.accountId
          );

        if (
          orderDifference !== 0
        ) {
          return orderDifference;
        }

        return (
          a.displayName ||
          a.accountName ||
          a.accountId
        ).localeCompare(
          b.displayName ||
            b.accountName ||
            b.accountId,
          "ko"
        );
      }
    );
}


export function applyAccountPreferences<
  T extends PreferenceAccountLike
>(
  accounts: T[],
  preferences:
    InputPreferences
): T[] {
  const hiddenSet =
    new Set(
      preferences
        .hiddenAccountIds
    );

  return sortAccountsByPreferences(
    accounts.filter(
      account =>
        !hiddenSet.has(
          account.accountId
        )
    ),
    preferences
  );
}
