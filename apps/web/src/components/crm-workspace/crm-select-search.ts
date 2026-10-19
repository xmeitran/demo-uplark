/** Lower-cased text without Vietnamese diacritics, so "huyen" finds "Huyền" and "dung" finds "Đức Dũng". */
export function normalizeSearchText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
}

/** True when every part of `haystack` joined contains the query; an empty query matches everything. */
export function matchesSearch(query: string, ...haystack: Array<string | undefined>): boolean {
  const needle = normalizeSearchText(query);
  return !needle || normalizeSearchText(haystack.filter(Boolean).join(" ")).includes(needle);
}

/** "Chọn tất cả" / "Bỏ chọn tất cả" act on the options the search shows; selections hidden by the search are kept. */
export function toggleVisibleSelection(values: readonly string[], visible: readonly string[], allVisibleSelected: boolean): string[] {
  return allVisibleSelected
    ? values.filter((value) => !visible.includes(value))
    : [...values, ...visible.filter((value) => !values.includes(value))];
}
