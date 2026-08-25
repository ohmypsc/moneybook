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

export interface SharedInputPreferencesState {
  configured: boolean;
  version: 1;
  preferences: InputPreferences | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const STORAGE_KEY =
  "moneybook.inputPreferences.v1";

const FETCH_PATCH_MARKER =
  "__moneybookInputPreferencesFetchPatched";

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


function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}


function readStringArray(
  value: unknown
): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const result: string[] = [];
  const seen =
    new Set<string>();

  for (
    const item
    of value
  ) {
    if (
      typeof item !==
      "string"
    ) {
      return null;
    }

    const text =
      item.trim();

    if (
      text &&
      !seen.has(text)
    ) {
      seen.add(text);
      result.push(text);
    }
  }

  return result;
}


/**
 * 서버/localStorage에서 읽은 값을
 * 현재 앱이 이해할 수 있는 v1 설정인지 검사합니다.
 */
export function parseInputPreferences(
  value: unknown
): InputPreferences | null {
  if (
    !isRecord(value)
  ) {
    return null;
  }

  if (
    value.version !== 1
  ) {
    return null;
  }

  if (
    !isRecord(
      value.categoryOrder
    )
  ) {
    return null;
  }

  const expenseOrder =
    readStringArray(
      value.categoryOrder.지출
    );

  const incomeOrder =
    readStringArray(
      value.categoryOrder.수입
    );

  const transferOrder =
    readStringArray(
      value.categoryOrder.이체
    );

  const accountOrder =
    readStringArray(
      value.accountOrder
    );

  const hiddenAccountIds =
    readStringArray(
      value.hiddenAccountIds
    );

  if (
    !expenseOrder ||
    !incomeOrder ||
    !transferOrder ||
    !accountOrder ||
    !hiddenAccountIds
  ) {
    return null;
  }

  return {
    version: 1,

    categoryOrder: {
      지출: expenseOrder,
      수입: incomeOrder,
      이체: transferOrder
    },

    accountOrder,

    hiddenAccountIds
  };
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

    return parseInputPreferences(
      JSON.parse(raw) as unknown
    );
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


/**
 * localStorage는 서버 공통 설정의 로컬 백업입니다.
 * 서버가 잠시 응답하지 않아도 입력 화면은 이 값을 사용합니다.
 */
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


/**
 * Apps Script bootstrap에 포함된 부부 공통 설정을
 * 현재 브라우저의 백업값으로 동기화합니다.
 *
 * 서버에 아직 공통 설정이 없으면 기존 localStorage를
 * 지우지 않습니다. 최초 저장 시 현재 브라우저 설정이
 * 서버 공통값이 됩니다.
 */
export function syncInputPreferencesFromBootstrapPayload(
  payload: unknown
) {
  if (
    typeof window ===
    "undefined" ||
    !isRecord(payload)
  ) {
    return false;
  }

  const data =
    isRecord(payload.data)
      ? payload.data
      : payload;

  if (
    !isRecord(
      data.inputPreferences
    )
  ) {
    return false;
  }

  if (
    data.inputPreferences
      .configured !==
    true
  ) {
    return false;
  }

  const parsed =
    parseInputPreferences(
      data.inputPreferences
        .preferences
    );

  if (!parsed) {
    return false;
  }

  saveInputPreferences(
    parsed
  );

  return true;
}


function isBootstrapRequest(
  input: RequestInfo | URL
) {
  if (
    typeof window ===
    "undefined"
  ) {
    return false;
  }

  try {
    let value: string;

    if (
      typeof input ===
      "string"
    ) {
      value = input;

    } else if (
      input instanceof URL
    ) {
      value =
        input.toString();

    } else {
      value =
        input.url;
    }

    const url =
      new URL(
        value,
        window.location.origin
      );

    return (
      url.origin ===
        window.location.origin &&
      url.pathname ===
        "/api/bootstrap"
    );

  } catch {
    return false;
  }
}


/**
 * InputPage 자체를 다시 쓰지 않고도 서버 공통 설정을
 * 적용하기 위한 얇은 bootstrap 동기화 계층입니다.
 *
 * /api/bootstrap의 네트워크 요청을 추가하지 않습니다.
 * 기존 요청의 응답 복사본만 읽고 localStorage를 갱신한 뒤
 * 원래 Response를 그대로 반환합니다.
 */
function installBootstrapPreferenceSync() {
  if (
    typeof window ===
      "undefined" ||
    typeof window.fetch !==
      "function"
  ) {
    return;
  }

  const markedWindow =
    window as typeof window & {
      [FETCH_PATCH_MARKER]?:
        boolean;
    };

  if (
    markedWindow[
      FETCH_PATCH_MARKER
    ]
  ) {
    return;
  }

  const originalFetch =
    window.fetch.bind(
      window
    );

  markedWindow[
    FETCH_PATCH_MARKER
  ] =
    true;

  window.fetch =
    (async (
      input:
        RequestInfo | URL,
      init?:
        RequestInit
    ) => {
      const response =
        await originalFetch(
          input,
          init
        );

      if (
        response.ok &&
        isBootstrapRequest(
          input
        )
      ) {
        try {
          const payload =
            await response
              .clone()
              .json() as unknown;

          syncInputPreferencesFromBootstrapPayload(
            payload
          );

        } catch {
          /*
           * 설정 동기화 실패가 bootstrap 자체를
           * 실패시키면 안 됩니다.
           */
        }
      }

      return response;
    }) as typeof window.fetch;
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


installBootstrapPreferenceSync();
