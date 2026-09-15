export function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error
    ? error.message
    : fallback;
}

function moveItemToIndex(
  items: string[],
  fromIndex: number,
  toIndex: number
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

  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveSubsetToIndex(
  allOrder: string[],
  subsetIds: string[],
  fromIndex: number,
  toIndex: number
) {
  const movedSubset = moveItemToIndex(
    subsetIds,
    fromIndex,
    toIndex
  );

  if (movedSubset === subsetIds) {
    return allOrder;
  }

  const subsetSet = new Set(subsetIds);
  let cursor = 0;

  return allOrder.map(itemId => {
    if (!subsetSet.has(itemId)) {
      return itemId;
    }

    const replacement = movedSubset[cursor];
    cursor += 1;
    return replacement || itemId;
  });
}

export function autoScrollForPointer(
  clientY: number
) {
  const edge = 84;
  const step = 24;

  if (clientY < edge) {
    window.scrollBy(0, -step);
  } else if (
    clientY >
    window.innerHeight - edge
  ) {
    window.scrollBy(0, step);
  }
}

export function buildOwnerTabs(
  members: string[],
  accountOwners: string[] = []
) {
  const unique = new Set<string>();

  for (const owner of [...members, ...accountOwners]) {
    const normalized = String(owner || "").trim();
    if (normalized && normalized !== "공동") {
      unique.add(normalized);
    }
  }

  return [...unique, "공동"];
}
