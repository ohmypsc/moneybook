import { getCalendarTransactions } from "./calendar";
import type { CalendarTransaction } from "./calendar";
import { subscribeLedgerChanges } from "../utils/ledgerEvents";

interface MonthCacheEntry {
    items: CalendarTransaction[];
    storedAt: number;
}

const CURRENT_MONTH_TTL_MS = 30 * 1000;
const ARCHIVE_MONTH_TTL_MS = 5 * 60 * 1000;

const activeMonthCache = new Map<string, MonthCacheEntry>();
const deletedMonthCache = new Map<string, MonthCacheEntry>();

const activeMonthRequests =
    new Map<string, Promise<CalendarTransaction[]>>();

const deletedMonthRequests =
    new Map<string, Promise<CalendarTransaction[]>>();

let cacheGeneration = 0;

function pad(value: number) {
    return String(value).padStart(2, "0");
}

export function getCurrentCalendarMonth() {
    const now = new Date();

    return [
        now.getFullYear(),
        pad(now.getMonth() + 1)
    ].join("-");
}

function getMonthBounds(month: string) {
    const match =
        /^(\d{4})-(\d{2})$/.exec(month);

    if (!match) {
        throw new Error(
            "월 형식이 올바르지 않습니다."
        );
    }

    const year = Number(match[1]);
    const monthNumber = Number(match[2]);

    if (
        !Number.isInteger(year) ||
        monthNumber < 1 ||
        monthNumber > 12
    ) {
        throw new Error(
            "월 형식이 올바르지 않습니다."
        );
    }

    const lastDay =
        new Date(
            year,
            monthNumber,
            0
        ).getDate();

    return {
        dateFrom: `${month}-01`,
        dateTo: `${month}-${pad(lastDay)}`
    };
}

function getTtl(month: string) {
    return month === getCurrentCalendarMonth()
        ? CURRENT_MONTH_TTL_MS
        : ARCHIVE_MONTH_TTL_MS;
}

function isFresh(
    month: string,
    entry: MonthCacheEntry | undefined
) {
    return Boolean(
        entry &&
        Date.now() - entry.storedAt <
            getTtl(month)
    );
}

export function getCalendarMonthSnapshot(
    month: string
) {
    return (
        activeMonthCache.get(month)?.items ||
        null
    );
}

export function getDeletedCalendarMonthSnapshot(
    month: string
) {
    return (
        deletedMonthCache.get(month)?.items ||
        null
    );
}

export async function loadCalendarMonth(
    month: string,
    options: {
        forceRefresh?: boolean;
    } = {}
) {
    const cached =
        activeMonthCache.get(month);

    if (
        !options.forceRefresh &&
        isFresh(month, cached)
    ) {
        return cached!.items;
    }

    const existingRequest =
        activeMonthRequests.get(month);

    if (
        !options.forceRefresh &&
        existingRequest
    ) {
        return existingRequest;
    }

    const {
        dateFrom,
        dateTo
    } = getMonthBounds(month);

    const requestGeneration =
        cacheGeneration;

    let request:
        Promise<CalendarTransaction[]>;

    request =
        getCalendarTransactions({
            dateFrom,
            dateTo,
            limit: 1000
        })
            .then(result => {
                const items =
                    Array.isArray(result.items)
                        ? result.items.filter(
                              item =>
                                  !item.isDeleted
                          )
                        : [];

                if (
                    requestGeneration ===
                    cacheGeneration
                ) {
                    activeMonthCache.set(
                        month,
                        {
                            items,
                            storedAt:
                                Date.now()
                        }
                    );
                }

                return items;
            })
            .finally(() => {
                if (
                    activeMonthRequests.get(
                        month
                    ) === request
                ) {
                    activeMonthRequests.delete(
                        month
                    );
                }
            });

    activeMonthRequests.set(
        month,
        request
    );

    return request;
}

export async function loadDeletedCalendarMonth(
    month: string,
    options: {
        forceRefresh?: boolean;
    } = {}
) {
    const cached =
        deletedMonthCache.get(month);

    if (
        !options.forceRefresh &&
        isFresh(month, cached)
    ) {
        return cached!.items;
    }

    const existingRequest =
        deletedMonthRequests.get(month);

    if (
        !options.forceRefresh &&
        existingRequest
    ) {
        return existingRequest;
    }

    const {
        dateFrom,
        dateTo
    } = getMonthBounds(month);

    const requestGeneration =
        cacheGeneration;

    let request:
        Promise<CalendarTransaction[]>;

    request =
        getCalendarTransactions({
            dateFrom,
            dateTo,
            includeDeleted: true,
            limit: 1000
        })
            .then(result => {
                const allItems =
                    Array.isArray(result.items)
                        ? result.items
                        : [];

                const deletedItems =
                    allItems.filter(
                        item =>
                            item.isDeleted
                    );

                const activeItems =
                    allItems.filter(
                        item =>
                            !item.isDeleted
                    );

                if (
                    requestGeneration ===
                    cacheGeneration
                ) {
                    const storedAt =
                        Date.now();

                    deletedMonthCache.set(
                        month,
                        {
                            items:
                                deletedItems,
                            storedAt
                        }
                    );

                    activeMonthCache.set(
                        month,
                        {
                            items:
                                activeItems,
                            storedAt
                        }
                    );
                }

                return deletedItems;
            })
            .finally(() => {
                if (
                    deletedMonthRequests.get(
                        month
                    ) === request
                ) {
                    deletedMonthRequests.delete(
                        month
                    );
                }
            });

    deletedMonthRequests.set(
        month,
        request
    );

    return request;
}

export async function prefetchCalendarMonth(
    month = getCurrentCalendarMonth()
) {
    try {
        await loadCalendarMonth(month);
    } catch {
        /*
         * 달력 프리페치 실패는
         * 홈 화면과 앱 진입을 막지 않습니다.
         */
    }
}

export function invalidateCalendarCache(
    month?: string
) {
    cacheGeneration += 1;

    if (month) {
        activeMonthCache.delete(month);
        deletedMonthCache.delete(month);
        activeMonthRequests.delete(month);
        deletedMonthRequests.delete(month);

        return;
    }

    activeMonthCache.clear();
    deletedMonthCache.clear();
    activeMonthRequests.clear();
    deletedMonthRequests.clear();
}

if (typeof window !== "undefined") {
    subscribeLedgerChanges(() => {
        invalidateCalendarCache();
    });
}
