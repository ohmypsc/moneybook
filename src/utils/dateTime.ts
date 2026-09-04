const SEOUL_TIME_ZONE = "Asia/Seoul";

function getParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map(part => [part.type, part.value]));

  return {
    year: map.get("year") || "",
    month: map.get("month") || "",
    day: map.get("day") || ""
  };
}

export function getSeoulDateString(date = new Date()) {
  const { year, month, day } = getParts(date);
  return `${year}-${month}-${day}`;
}

export function getSeoulMonthString(date = new Date()) {
  return getSeoulDateString(date).slice(0, 7);
}

export function getSeoulTimestampLabel(date = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: SEOUL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function getSeoulFileDate(date = new Date()) {
  return getSeoulDateString(date);
}
