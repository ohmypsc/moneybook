import {
  clearLedgerStartDate,
  createManagedAccount as createManagedAccountRequest,
  createManagedCategory as createManagedCategoryRequest,
  deleteManagedAccount as deleteManagedAccountRequest,
  deleteManagedCategory as deleteManagedCategoryRequest,
  getLedgerConfig,
  getManagedAccounts as getManagedAccountsRequest,
  getManagedCategories as getManagedCategoriesRequest,
  restoreManagedAccount as restoreManagedAccountRequest,
  restoreManagedCategory as restoreManagedCategoryRequest,
  setLedgerStartDate,
  updateManagedAccount as updateManagedAccountRequest,
  updateManagedCategory as updateManagedCategoryRequest
} from "./settingsManagementCore";

export * from "./settingsManagementCore";

export {
  clearLedgerStartDate,
  getLedgerConfig,
  setLedgerStartDate
};

type CategoryQuery =
  Parameters<
    typeof getManagedCategoriesRequest
  >[0];

type AccountQuery =
  Parameters<
    typeof getManagedAccountsRequest
  >[0];

type CategoryResult =
  Awaited<
    ReturnType<
      typeof getManagedCategoriesRequest
    >
  >;

type AccountResult =
  Awaited<
    ReturnType<
      typeof getManagedAccountsRequest
    >
  >;

type CacheEntry<T> = {
  data: T;
  fetchedAt: number;
};

const MANAGED_SETTINGS_TTL_MS =
  30 * 1000;

function createMemoryQueryCache<T>() {
  let cache:
    CacheEntry<T> |
    null =
      null;

  let request:
    Promise<T> |
    null =
      null;

  let generation =
    0;

  function clear() {
    generation += 1;

    cache =
      null;

    request =
      null;
  }

  /*
   * 화면 재진입 시에는 만료된 값이라도
   * 마지막 정상 데이터를 즉시 표시합니다.
   *
   * 실제 최신 여부는 get()에서 판단하고
   * 필요하면 백그라운드 요청으로 교체됩니다.
   */
  function peek() {
    return (
      cache?.data ||
      null
    );
  }

  function freshSnapshot() {
    if (
      !cache ||
      Date.now() -
        cache.fetchedAt >=
        MANAGED_SETTINGS_TTL_MS
    ) {
      return null;
    }

    return cache.data;
  }

  function get(
    loader:
      () =>
        Promise<T>
  ) {
    const cached =
      freshSnapshot();

    if (cached) {
      return Promise.resolve(
        cached
      );
    }

    if (request) {
      return request;
    }

    const requestGeneration =
      generation;

    const task =
      loader()
        .then(
          data => {
            if (
              requestGeneration ===
              generation
            ) {
              cache = {
                data,
                fetchedAt:
                  Date.now()
              };
            }

            return data;
          }
        );

    request =
      task;

    const clearRequest =
      () => {
        if (
          request ===
          task
        ) {
          request =
            null;
        }
      };

    void task.then(
      clearRequest,
      clearRequest
    );

    return task;
  }

  return {
    clear,
    get,
    peek
  };
}

function toQueryRecord(
  value:
    unknown
) {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return {} as
      Record<
        string,
        unknown
      >;
  }

  return value as
    Record<
      string,
      unknown
    >;
}

function isFullCategoryQuery(
  params:
    unknown
) {
  const query =
    toQueryRecord(
      params
    );

  return (
    query.includeDeleted ===
      true &&
    !query.type
  );
}

function isFullAccountQuery(
  params:
    unknown
) {
  const query =
    toQueryRecord(
      params
    );

  return (
    query.includeDeleted ===
      true &&
    !query.owner &&
    !query.accountType &&
    !query.subType
  );
}

const categoryCache =
  createMemoryQueryCache<
    CategoryResult
  >();

const accountCache =
  createMemoryQueryCache<
    AccountResult
  >();

export function clearManagedSettingsCache() {
  categoryCache.clear();
  accountCache.clear();
}

export function getManagedCategoriesSnapshot() {
  return categoryCache
    .peek();
}

export function getManagedAccountsSnapshot() {
  return accountCache
    .peek();
}

export function getManagedCategories(
  params:
    CategoryQuery
) {
  if (
    !isFullCategoryQuery(
      params
    )
  ) {
    return getManagedCategoriesRequest(
      params
    );
  }

  return categoryCache.get(
    () =>
      getManagedCategoriesRequest(
        params
      )
  );
}

export function getManagedAccounts(
  params:
    AccountQuery
) {
  if (
    !isFullAccountQuery(
      params
    )
  ) {
    return getManagedAccountsRequest(
      params
    );
  }

  return accountCache.get(
    () =>
      getManagedAccountsRequest(
        params
      )
  );
}

export async function prefetchManagedSettings() {
  await Promise.allSettled([
    getManagedCategories({
      includeDeleted:
        true
    } as CategoryQuery),

    getManagedAccounts({
      includeDeleted:
        true
    } as AccountQuery)
  ]);
}

async function runMutation<T>(
  work:
    () =>
      Promise<T>,

  invalidate:
    () =>
      void
) {
  const result =
    await work();

  invalidate();

  return result;
}

export function createManagedCategory(
  ...args:
    Parameters<
      typeof createManagedCategoryRequest
    >
) {
  return runMutation(
    () =>
      createManagedCategoryRequest(
        ...args
      ),

    categoryCache.clear
  );
}

export function updateManagedCategory(
  ...args:
    Parameters<
      typeof updateManagedCategoryRequest
    >
) {
  return runMutation(
    () =>
      updateManagedCategoryRequest(
        ...args
      ),

    categoryCache.clear
  );
}

export function deleteManagedCategory(
  ...args:
    Parameters<
      typeof deleteManagedCategoryRequest
    >
) {
  return runMutation(
    () =>
      deleteManagedCategoryRequest(
        ...args
      ),

    categoryCache.clear
  );
}

export function restoreManagedCategory(
  ...args:
    Parameters<
      typeof restoreManagedCategoryRequest
    >
) {
  return runMutation(
    () =>
      restoreManagedCategoryRequest(
        ...args
      ),

    categoryCache.clear
  );
}

export function createManagedAccount(
  ...args:
    Parameters<
      typeof createManagedAccountRequest
    >
) {
  return runMutation(
    () =>
      createManagedAccountRequest(
        ...args
      ),

    accountCache.clear
  );
}

export function updateManagedAccount(
  ...args:
    Parameters<
      typeof updateManagedAccountRequest
    >
) {
  return runMutation(
    () =>
      updateManagedAccountRequest(
        ...args
      ),

    accountCache.clear
  );
}

export function deleteManagedAccount(
  ...args:
    Parameters<
      typeof deleteManagedAccountRequest
    >
) {
  return runMutation(
    () =>
      deleteManagedAccountRequest(
        ...args
      ),

    accountCache.clear
  );
}

export function restoreManagedAccount(
  ...args:
    Parameters<
      typeof restoreManagedAccountRequest
    >
) {
  return runMutation(
    () =>
      restoreManagedAccountRequest(
        ...args
      ),

    accountCache.clear
  );
}
