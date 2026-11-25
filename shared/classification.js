// 거래 태그 정규화(입력 화면·서버 공용)
export function normalizeTags(value = []) {
  if (typeof value === "string") value = value.split(/[,，\n]/);
  if (!Array.isArray(value)) throw new Error("태그는 배열 또는 쉼표로 구분한 문자열이어야 합니다.");
  const tags = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("태그 이름은 문자열이어야 합니다.");
    const tag = item.normalize("NFC").trim().replace(/^#+/, "").trim();
    if (!tag) continue;
    if (tag.length > 30) throw new Error("태그 이름은 30자 이내로 입력해주세요.");
    if (!tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  if (tags.length > 10) throw new Error("거래당 태그는 최대 10개입니다.");
  return tags;
}
