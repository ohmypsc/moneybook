import { useEffect, useMemo, useState } from "react";

import { getDashboardSnapshot } from "../../api/dashboard";
import { BottomSheet } from "../../components/common/BottomSheet/BottomSheet";
import { merchantCategoryIds } from "../../../shared/merchantUsage.js";
import {
  getFrequentCategoryIds,
  matchesCategorySearch,
  sortByKoreanLabel
} from "../../utils/categoryUsage";
import {
  getBackendType,
  isAccountPickerKind,
  isOtherOwnerAccount,
  type Account,
  type Category,
  type InputMode,
  type PickerKind
} from "./inputDomain";
import {
  getAccountPickerGroups,
  getAccountPickerItem,
  getOtherOwnerPickerLabel,
  getPickerItems,
  getPickerSelectedValue,
  getPickerTitle,
  type PickerItem,
  type PickerSelection
} from "./inputPicker";
import styles from "./InputPage.module.css";

interface InputPickerSheetProps {
  kind: PickerKind;
  mode: InputMode;
  userName: string;
  orderedAllAccounts: Account[];
  visibleAccounts: Account[];
  creditCards: Account[];
  cardSourceAccounts: Account[];
  visibleAccountIds: Set<string>;
  investmentAccountIds: Set<string>;
  categories: Category[];
  spendingTargets: string[];
  selection: PickerSelection;
  onSelect: (kind: PickerKind, value: string) => void;
  onClose: () => void;
  /** 거래 내용(가맹점). 있으면 이 가맹점에 예전에 쓴 카테고리를 맨 위에 따로 보여 줍니다. */
  merchant?: string;
}

export function InputPickerSheet({
  kind,
  mode,
  userName,
  orderedAllAccounts,
  visibleAccounts,
  creditCards,
  cardSourceAccounts,
  visibleAccountIds,
  investmentAccountIds,
  categories,
  spendingTargets,
  selection,
  onSelect,
  onClose,
  merchant = ""
}: InputPickerSheetProps) {
  const accountContext = useMemo(
    () => ({
      userName,
      orderedAllAccounts,
      visibleAccounts,
      creditCards,
      cardSourceAccounts,
      visibleAccountIds,
      investmentAccountIds,
      selectedCardAccountId: selection.toAccountId
    }),
    [
      userName,
      orderedAllAccounts,
      visibleAccounts,
      creditCards,
      cardSourceAccounts,
      visibleAccountIds,
      investmentAccountIds,
      selection.toAccountId
    ]
  );

  const selectedValue = getPickerSelectedValue(kind, selection);
  const selectedAccount = orderedAllAccounts.find(account => account.accountId === selectedValue);
  const selectedIsOtherOwner = Boolean(
    selectedAccount && isOtherOwnerAccount(selectedAccount, userName)
  );
  const [showOtherOwnerAccounts, setShowOtherOwnerAccounts] = useState(selectedIsOtherOwner);

  useEffect(() => {
    setShowOtherOwnerAccounts(selectedIsOtherOwner);
  }, [kind, selectedIsOtherOwner]);

  function renderOption(value: string, label: string, meta?: string) {
    const selected = selectedValue === value;

    return (
      <button
        type="button"
        key={value}
        className={`${styles.sheetOption} ${selected ? styles.sheetOptionSelected : ""}`}
        onClick={() => onSelect(kind, value)}
      >
        <span className={styles.sheetOptionText}>
          <strong>{label}</strong>
          {meta && <span>{meta}</span>}
        </span>
        {selected && (
          <span className={styles.sheetCheck} aria-hidden="true">
            ✓
          </span>
        )}
      </button>
    );
  }

  let content;

  if (isAccountPickerKind(kind)) {
    const groups = getAccountPickerGroups(kind, accountContext);

    content = (
      <>
        {groups.other.length > 0 && (
          <>
            <button
              type="button"
              className={styles.sheetMoreOption}
              aria-expanded={showOtherOwnerAccounts}
              onClick={() => setShowOtherOwnerAccounts(current => !current)}
            >
              <span>
                {getOtherOwnerPickerLabel(kind)}
                <strong>
                  {groups.other.length}개 · {showOtherOwnerAccounts ? "접기" : "더보기"}
                </strong>
              </span>
              <span className={styles.sheetMoreChevron} aria-hidden="true">
                {showOtherOwnerAccounts ? "⌃" : "⌄"}
              </span>
            </button>

            {showOtherOwnerAccounts && (
              <>
                <div className={styles.sheetGroupLabel}>다른 명의</div>
                {groups.other
                  .map(getAccountPickerItem)
                  .map(item => renderOption(item.value, item.label, item.meta))}
                {groups.primary.length > 0 && (
                  <div className={styles.sheetGroupLabel}>내 명의 · 공동</div>
                )}
              </>
            )}
          </>
        )}

        {groups.primary
          .map(getAccountPickerItem)
          .map(item => renderOption(item.value, item.label, item.meta))}
      </>
    );
  } else if (kind === "category") {
    content = (
      <CategoryChipPicker
        items={getPickerItems(kind, { ...accountContext, mode, categories, spendingTargets })}
        selectedValue={selectedValue}
        onPick={value => onSelect(kind, value)}
        merchant={merchant}
        type={getBackendType(mode)}
      />
    );
  } else {
    content = getPickerItems(kind, {
      ...accountContext,
      mode,
      categories,
      spendingTargets
    }).map(item => renderOption(item.value, item.label, item.meta));
  }

  return (
    <BottomSheet title={getPickerTitle(kind, mode)} onClose={onClose}>
      {content}
    </BottomSheet>
  );
}

const SEARCH_THRESHOLD = 12;
const FREQUENT_THRESHOLD = 8;

interface CategoryChipPickerProps {
  items: PickerItem[];
  selectedValue: string;
  onPick: (value: string) => void;
  merchant?: string;
  type?: string;
}

/*
 * 카테고리는 수십 개까지 늘어날 수 있어 한 줄에 하나씩 쌓지 않고 글자 칩으로 촘촘하게 보여 줍니다.
 * 위쪽에는 자주 쓰는 것을 따로 모으고, 많을 때는 검색(초성 포함)을 붙입니다.
 */
function CategoryChipPicker({
  items,
  selectedValue,
  onPick,
  merchant = "",
  type = ""
}: CategoryChipPickerProps) {
  const [query, setQuery] = useState("");

  const sortedItems = useMemo(() => sortByKoreanLabel(items), [items]);

  const trimmedMerchant = merchant.trim();
  const { merchantItems, frequentItems } = useMemo(() => {
    const dashboard = getDashboardSnapshot();
    const byId = new Map(items.map(item => [item.value, item]));
    const pick = (ids: string[]) =>
      ids.map(id => byId.get(id)).filter((item): item is PickerItem => Boolean(item));
    const fromMerchant = pick(
      merchantCategoryIds(
        trimmedMerchant,
        type,
        dashboard?.merchantUsage,
        items.map(item => item.value)
      )
    );
    if (items.length <= FREQUENT_THRESHOLD)
      return { merchantItems: fromMerchant, frequentItems: [] };
    const frequentIds = getFrequentCategoryIds(
      items.map(item => item.value),
      dashboard?.categoryUsage,
      (dashboard?.recentTransactions || []).map(tx => tx.categoryId)
    );
    const merchantIds = new Set(fromMerchant.map(item => item.value));
    return {
      merchantItems: fromMerchant,
      frequentItems: pick(frequentIds.filter(id => !merchantIds.has(id)))
    };
  }, [items, trimmedMerchant, type]);

  const trimmedQuery = query.trim();
  const visibleItems = trimmedQuery
    ? sortedItems.filter(item => matchesCategorySearch(item.label, trimmedQuery))
    : sortedItems;

  function renderChip(item: PickerItem, frequent = false) {
    const selected = selectedValue === item.value;
    return (
      <button
        type="button"
        key={item.value}
        className={[
          styles.categoryChip,
          frequent ? styles.categoryChipFrequent : "",
          selected ? styles.categoryChipSelected : ""
        ]
          .filter(Boolean)
          .join(" ")}
        aria-pressed={selected}
        onClick={() => onPick(item.value)}
      >
        {item.label}
      </button>
    );
  }

  return (
    <div
      className={[
        styles.categoryPicker,
        items.length > SEARCH_THRESHOLD ? styles.categoryPickerSearchable : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {items.length > SEARCH_THRESHOLD && (
        <div className={styles.categorySearch}>
          <input
            type="search"
            className={styles.categorySearchInput}
            value={query}
            placeholder="카테고리 검색 (초성도 돼요: ㅅㅂ)"
            aria-label="카테고리 검색"
            enterKeyHint="search"
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && visibleItems.length === 1) {
                event.preventDefault();
                onPick(visibleItems[0].value);
              }
            }}
          />
        </div>
      )}

      {!trimmedQuery && merchantItems.length > 0 && (
        <>
          <p className={styles.categoryGroupLabel}>‘{trimmedMerchant}’에 썼던</p>
          <div className={styles.categoryChips}>
            {merchantItems.map(item => renderChip(item, true))}
          </div>
        </>
      )}

      {!trimmedQuery && frequentItems.length > 0 && (
        <>
          <p className={styles.categoryGroupLabel}>자주 쓰는</p>
          <div className={styles.categoryChips}>
            {frequentItems.map(item => renderChip(item, true))}
          </div>
        </>
      )}

      {(frequentItems.length > 0 || merchantItems.length > 0 || trimmedQuery) && (
        <p className={styles.categoryGroupLabel}>
          {trimmedQuery ? `검색 결과 ${visibleItems.length}개` : `전체 ${items.length}개`}
        </p>
      )}

      {visibleItems.length > 0 ? (
        <div className={styles.categoryChips}>{visibleItems.map(item => renderChip(item))}</div>
      ) : (
        <p className={styles.categoryEmpty}>‘{trimmedQuery}’에 맞는 카테고리가 없습니다.</p>
      )}
    </div>
  );
}
