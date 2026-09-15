function cleanText(value) {
  return String(value ?? "").trim();
}

export function dateOnly(value) {
  const text = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }

  return text;
}

export function monthOnly(value) {
  const text = cleanText(value);
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) return "";

  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? text : "";
}

export function estimateBillingMonth(dateText, cutoff, paymentDay) {
  const date = dateOnly(dateText);
  const cutoffNumber = Number(cutoff);
  const paymentDayNumber = Number(paymentDay);

  if (
    !date ||
    !Number.isFinite(cutoffNumber) ||
    cutoffNumber <= 0 ||
    !Number.isFinite(paymentDayNumber) ||
    paymentDayNumber <= 0
  ) {
    return null;
  }

  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const effectiveCutoff = Math.min(cutoffNumber, lastDay);

  let offset = day <= effectiveCutoff ? 0 : 1;
  if (paymentDayNumber <= cutoffNumber) offset += 1;

  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
}
