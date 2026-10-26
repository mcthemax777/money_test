/**
 * 사본의 칸 값을 맞추는 작은 도구들. 글자·금액·플래그·시각과 SQL 자리표 조각이 여기 있다.
 */

/**
 * 서버가 준 지도(fieldHlc)를 사본에 담을 글자로.
 *
 * 기기는 이 값을 해석하지 않는다. 다음 편집의 시계를 매길 때 @money/types 의
 * field-merge 에 그대로 넘길 뿐이라, 문자열로 두는 편이 왕복에서 잃는 것이 없다.
 */
export const asJson = (value: unknown): string | null => {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
};

export const asText = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value);

export const asMoney = (value: unknown): string => asText(value) ?? '0';

export const asFlag = (value: unknown): number => (value ? 1 : 0);

export const asInt = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

/** ISO 문자열로. Date 와 문자열이 섞여 오므로 한 곳에서 맞춘다. */
export const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

/** `IN (?, ?, ?)` 의 물음표들. 개수가 0 이면 아무것도 맞지 않는 절이 된다. */
export const placeholders = (count: number): string =>
  count === 0 ? 'NULL' : new Array(count).fill('?').join(', ');

/**
 * 잔액을 셀 때 `asOf` 뒤 날짜의 전표를 빼는 조건. 별칭 `e` 의 entry 와 함께 쓴다.
 *
 * entry.date 는 늘 `toISOString()` 꼴로 담기므로(`asIso`, `local-entry-writer`) 문자열
 * 견주기가 곧 시각 견주기다. null 이면 자르지 않는다.
 */
export const asOfClause = (asOf: Date | null): { sql: string; params: string[] } =>
  asOf ? { sql: ' AND e.date <= ?', params: [asOf.toISOString()] } : { sql: '', params: [] };
