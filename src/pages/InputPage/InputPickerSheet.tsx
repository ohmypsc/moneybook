import { useEffect, useMemo, useState } from "react";

import { BottomSheet } from "../../components/common/BottomSheet/BottomSheet";
import {
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
  onClose
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
  const selectedAccount = orderedAllAccounts.find(
    account => account.accountId === selectedValue
  );
  const selectedIsOtherOwner = Boolean(
    selectedAccount && isOtherOwnerAccount(selectedAccount, userName)
  );
  const [showOtherOwnerAccounts, setShowOtherOwnerAccounts] = useState(
    selectedIsOtherOwner
  );

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
