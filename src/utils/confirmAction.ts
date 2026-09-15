export type ConfirmTone =
  | "default"
  | "danger";

export interface ConfirmActionOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

export interface ConfirmActionSnapshot {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
}

interface ConfirmQueueItem {
  snapshot: ConfirmActionSnapshot;
  resolve: (value: boolean) => void;
}

const listeners =
  new Set<() => void>();

const queue:
  ConfirmQueueItem[] = [];

let current:
  ConfirmQueueItem | null =
    null;

let nextId = 1;

function emit() {
  listeners.forEach(
    listener => listener()
  );
}

function showNext() {
  if (
    current ||
    queue.length === 0
  ) {
    return;
  }

  current =
    queue.shift() || null;

  emit();
}

export function confirmAction(
  input:
    string | ConfirmActionOptions
): Promise<boolean> {
  const options =
    typeof input === "string"
      ? { message: input }
      : input;

  const snapshot:
    ConfirmActionSnapshot = {
      id: nextId,
      title:
        options.title ||
        "확인",
      message:
        options.message,
      confirmLabel:
        options.confirmLabel ||
        "확인",
      cancelLabel:
        options.cancelLabel ||
        "취소",
      tone:
        options.tone ||
        "default"
    };

  nextId += 1;

  return new Promise<boolean>(
    resolve => {
      queue.push({
        snapshot,
        resolve
      });

      showNext();
    }
  );
}

export function subscribeConfirmAction(
  listener: () => void
) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getConfirmActionSnapshot() {
  return current?.snapshot || null;
}

export function resolveConfirmAction(
  id: number,
  result: boolean
) {
  if (
    !current ||
    current.snapshot.id !== id
  ) {
    return;
  }

  const completed =
    current;

  current = null;
  completed.resolve(result);
  emit();

  queueMicrotask(
    showNext
  );
}
