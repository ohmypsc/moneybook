import {
  createManagedAccount as createManagedAccountCore,
  createManagedCategory as createManagedCategoryCore,
  deleteManagedAccount as deleteManagedAccountCore,
  deleteManagedCategory as deleteManagedCategoryCore,
  getManagedAccounts as getManagedAccountsCore,
  getManagedCategories as getManagedCategoriesCore,
  restoreManagedAccount as restoreManagedAccountCore,
  restoreManagedCategory as restoreManagedCategoryCore,
  updateManagedAccount as updateManagedAccountCore,
  updateManagedCategory as updateManagedCategoryCore
} from "./settingsManagementCore";

export * from "./settingsManagementCore";


type CategoryQuery =
  Parameters<
    typeof getManagedCategoriesCore
  >[0];


type AccountQuery =
  Parameters<
    typeof getManagedAccountsCore
  >[0];


type CategoryResult =
  Awaited<
    ReturnType<
      typeof getManagedCategoriesCore
    >
  >;


type AccountResult =
  Awaited<
    ReturnType<
      typeof getManagedAccountsCore
    >
  >;


type CategoryItem =
  CategoryResult extends {
    items: Array<infer T>;
  }
    ? T
    : never;


type AccountItem =
  AccountResult extends {
    items: Array<infer T>;
  }
    ? T
    : never;


interface CacheEntry<T> {
  value: T;
  updatedAt: number;
}


const MANAGED_SETTINGS_TTL_MS =
  30 * 1000;


let categoryCache:
  CacheEntry<CategoryResult> | null =
  null;

let accountCache:
  CacheEntry<AccountResult> | null =
  null;


let categoryRequest:
  Promise<CategoryResult> | null =
  null;

let accountRequest:
  Promise<AccountResult> | null =
  null;


let categoryGeneration =
  0;

let accountGeneration =
  0;


function asRecord(
  value: unknown
): Record<string, unknown> {
  if (
    value &&
    typeof value === "object"
  ) {
    return value as
      Record<string, unknown>;
  }

  return {};
}


function isFullCategoryQuery(
  params: CategoryQuery | undefined
) {
  const query =
    asRecord(params);

  return (
    query.includeDeleted ===
      true &&
    !query.type
  );
}


function isFullAccountQuery(
  params: AccountQuery | undefined
) {
  const query =
    asRecord(params);

  return (
    query.includeDeleted ===
      true &&
    !query.owner &&
    !query.accountType &&
    !query.subType
  );
}


function isFresh<T>(
  entry: CacheEntry<T> | null
) {
  return !!(
    entry &&
    Date.now() -
      entry.updatedAt <
      MANAGED_SETTINGS_TTL_MS
  );
}


function invalidateCategoryCache() {
  categoryGeneration +=
    1;

  categoryCache =
    null;

  categoryRequest =
    null;
}


function invalidateAccountCache() {
  accountGeneration +=
    1;

  accountCache =
    null;

  accountRequest =
    null;
}


function extractNestedEntity<T>(
  value: unknown,
  key: string
): T | null {
  const root =
    asRecord(value);

  const direct =
    root[key];

  if (
    direct &&
    typeof direct === "object"
  ) {
    return direct as T;
  }

  const data =
    asRecord(
      root.data
    );

  const nested =
    data[key];

  if (
    nested &&
    typeof nested === "object"
  ) {
    return nested as T;
  }

  return null;
}


function replaceResultItems<
  T extends {
    items: unknown[];
  }
>(
  result: T,
  items: T["items"]
): T {
  const next = {
    ...result,
    items
  } as T & {
    total?: number;
  };

  if (
    typeof next.total ===
    "number"
  ) {
    next.total =
      items.length;
  }

  return next;
}


function upsertCategoryCache(
  category: CategoryItem
) {
  categoryGeneration +=
    1;

  categoryRequest =
    null;

  if (
    !categoryCache ||
    !Array.isArray(
      categoryCache.value.items
    )
  ) {
    categoryCache =
      null;

    return;
  }

  const categoryId =
    asRecord(category)
      .categoryId;

  if (
    typeof categoryId !==
      "string" ||
    !categoryId
  ) {
    categoryCache =
      null;

    return;
  }

  const currentItems =
    categoryCache.value.items;

  const index =
    currentItems.findIndex(
      item =>
        asRecord(item)
          .categoryId ===
        categoryId
    );

  const items =
    currentItems.slice();

  if (
    index >=
    0
  ) {
    items[index] =
      category;
  } else {
    items.push(
      category
    );
  }

  categoryCache = {
    value:
      replaceResultItems(
        categoryCache.value,
        items
      ),

    updatedAt:
      Date.now()
  };
}


function upsertAccountCache(
  account: AccountItem
) {
  accountGeneration +=
    1;

  accountRequest =
    null;

  if (
    !accountCache ||
    !Array.isArray(
      accountCache.value.items
    )
  ) {
    accountCache =
      null;

    return;
  }

  const accountId =
    asRecord(account)
      .accountId;

  if (
    typeof accountId !==
      "string" ||
    !accountId
  ) {
    accountCache =
      null;

    return;
  }

  const currentItems =
    accountCache.value.items;

  const index =
    currentItems.findIndex(
      item =>
        asRecord(item)
          .accountId ===
        accountId
    );

  const items =
    currentItems.slice();

  if (
    index >=
    0
  ) {
    items[index] =
      account;
  } else {
    items.push(
      account
    );
  }

  accountCache = {
    value:
      replaceResultItems(
        accountCache.value,
        items
      ),

    updatedAt:
      Date.now()
  };
}


async function loadFullCategories() {
  if (
    isFresh(
      categoryCache
    )
  ) {
    return categoryCache!
      .value;
  }

  if (
    categoryRequest
  ) {
    return categoryRequest;
  }

  const requestGeneration =
    categoryGeneration;

  const request =
    getManagedCategoriesCore(
      {
        includeDeleted:
          true
      } as CategoryQuery
    )
      .then(
        result => {
          if (
            requestGeneration ===
            categoryGeneration
          ) {
            categoryCache = {
              value:
                result,

              updatedAt:
                Date.now()
            };
          }

          return result;
        }
      )
      .finally(
        () => {
          if (
            categoryRequest ===
            request
          ) {
            categoryRequest =
              null;
          }
        }
      );

  categoryRequest =
    request;

  return request;
}


async function loadFullAccounts() {
  if (
    isFresh(
      accountCache
    )
  ) {
    return accountCache!
      .value;
  }

  if (
    accountRequest
  ) {
    return accountRequest;
  }

  const requestGeneration =
    accountGeneration;

  const request =
    getManagedAccountsCore(
      {
        includeDeleted:
          true
      } as AccountQuery
    )
      .then(
        result => {
          if (
            requestGeneration ===
            accountGeneration
          ) {
            accountCache = {
              value:
                result,

              updatedAt:
                Date.now()
            };
          }

          return result;
        }
      )
      .finally(
        () => {
          if (
            accountRequest ===
            request
          ) {
            accountRequest =
              null;
          }
        }
      );

  accountRequest =
    request;

  return request;
}


export function getManagedCategoriesSnapshot() {
  return categoryCache
    ?.value ??
    null;
}


export function getManagedAccountsSnapshot() {
  return accountCache
    ?.value ??
    null;
}


export async function getManagedCategories(
  params?: CategoryQuery
) {
  if (
    isFullCategoryQuery(
      params
    )
  ) {
    return loadFullCategories();
  }

  return getManagedCategoriesCore(
    (params ?? {}) as
      CategoryQuery
  );
}


export async function getManagedAccounts(
  params?: AccountQuery
) {
  if (
    isFullAccountQuery(
      params
    )
  ) {
    return loadFullAccounts();
  }

  return getManagedAccountsCore(
    (params ?? {}) as
      AccountQuery
  );
}


export async function createManagedCategory(
  ...args:
    Parameters<
      typeof createManagedCategoryCore
    >
) {
  const result =
    await createManagedCategoryCore(
      ...args
    );

  const category =
    extractNestedEntity<
      CategoryItem
    >(
      result,
      "category"
    );

  if (
    category
  ) {
    upsertCategoryCache(
      category
    );
  } else {
    invalidateCategoryCache();
  }

  return result;
}


export async function updateManagedCategory(
  ...args:
    Parameters<
      typeof updateManagedCategoryCore
    >
) {
  const result =
    await updateManagedCategoryCore(
      ...args
    );

  const category =
    extractNestedEntity<
      CategoryItem
    >(
      result,
      "category"
    );

  if (
    category
  ) {
    upsertCategoryCache(
      category
    );
  } else {
    invalidateCategoryCache();
  }

  return result;
}


export async function deleteManagedCategory(
  ...args:
    Parameters<
      typeof deleteManagedCategoryCore
    >
) {
  const result =
    await deleteManagedCategoryCore(
      ...args
    );

  invalidateCategoryCache();

  return result;
}


export async function restoreManagedCategory(
  ...args:
    Parameters<
      typeof restoreManagedCategoryCore
    >
) {
  const result =
    await restoreManagedCategoryCore(
      ...args
    );

  invalidateCategoryCache();

  return result;
}


export async function createManagedAccount(
  ...args:
    Parameters<
      typeof createManagedAccountCore
    >
) {
  const result =
    await createManagedAccountCore(
      ...args
    );

  const account =
    extractNestedEntity<
      AccountItem
    >(
      result,
      "account"
    );

  if (
    account
  ) {
    upsertAccountCache(
      account
    );
  } else {
    invalidateAccountCache();
  }

  return result;
}


export async function updateManagedAccount(
  ...args:
    Parameters<
      typeof updateManagedAccountCore
    >
) {
  const result =
    await updateManagedAccountCore(
      ...args
    );

  const account =
    extractNestedEntity<
      AccountItem
    >(
      result,
      "account"
    );

  if (
    account
  ) {
    upsertAccountCache(
      account
    );
  } else {
    invalidateAccountCache();
  }

  return result;
}


export async function deleteManagedAccount(
  ...args:
    Parameters<
      typeof deleteManagedAccountCore
    >
) {
  const result =
    await deleteManagedAccountCore(
      ...args
    );

  invalidateAccountCache();

  return result;
}


export async function restoreManagedAccount(
  ...args:
    Parameters<
      typeof restoreManagedAccountCore
    >
) {
  const result =
    await restoreManagedAccountCore(
      ...args
    );

  invalidateAccountCache();

  return result;
}


export function clearManagedSettingsCache() {
  invalidateCategoryCache();
  invalidateAccountCache();
}


export async function prefetchManagedSettings() {
  await Promise.allSettled([
    loadFullCategories(),
    loadFullAccounts()
  ]);
}
