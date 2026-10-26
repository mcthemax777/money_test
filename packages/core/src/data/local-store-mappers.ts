/**
 * 사본의 줄과 바깥 모양 사이를 옮기는 함수들. 큐의 명령, 반복 등록, 보관함 후보, 회차 기준 집계 줄이다.
 */

import {
  Dec,
  type EntryDraftDto,
  type Mutation,
  type MutationKind,
  type NamedCategoryPostingRow,
  spreadInstallmentRow,
} from '@money/types';

import type { SqlValue } from './sql-driver';
import type { Row } from './local-store-types';
import { asInt, asIso, asJson, asMoney, asText, asFlag } from './local-store-values';

/**
 * 큐의 한 줄을 명령으로.
 *
 * clientId 는 이 표에 담지 않는다. 기기마다 하나뿐이라 줄마다 되풀이할 값이 아니고,
 * 한 곳에만 두어야 나중에 바뀔 일이 생겨도 어긋나지 않는다.
 */
export const toMutation = (row: Row, clientId: string): Mutation => ({
  mutationId: String(row.mutationId),
  clientId,
  clientSeq: Number(row.clientSeq),
  hlc: String(row.hlc),
  kind: String(row.kind) as MutationKind,
  projectId: String(row.projectId),
  targets: JSON.parse(String(row.targets)) as string[],
  payload: JSON.parse(String(row.payload)) as unknown,
});

/**
 * 반복 등록 한 줄을 사본의 칸으로. 동기화 응답(서버 행)과 기기의 새 규칙이 같은 길로 온다.
 * 배열(요일·태그)은 JSON 글자로 담는다.
 */
export function recurringRow(projectId: string, row: Row): Record<string, SqlValue> {
  const list = (value: unknown): string => {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'string' && value.startsWith('[')) return value;
    return '[]';
  };
  const intOrNull = (value: unknown) => (value == null || value === '' ? null : asInt(value));
  return {
    id: String(row.id),
    projectId,
    isActive: asFlag(row.isActive ?? true),
    frequency: String(row.frequency ?? 'none'),
    everyDays: intOrNull(row.everyDays),
    weekdays: list(row.weekdays),
    holidayRule: asText(row.holidayRule) ?? 'none',
    dayOfMonth: intOrNull(row.dayOfMonth),
    month: intOrNull(row.month),
    startDate: String(row.startDate),
    endDate: asText(row.endDate),
    timeOfDay: asText(row.timeOfDay),
    kind: String(row.kind),
    amount: row.amount == null || row.amount === '' ? null : String(row.amount),
    currency: asText(row.currency),
    description: String(row.description ?? ''),
    merchant: asText(row.merchant),
    personId: asText(row.personId),
    categoryId: asText(row.categoryId),
    accountId: asText(row.accountId),
    toAccountId: asText(row.toAccountId),
    feeAmount: row.feeAmount == null || row.feeAmount === '' ? null : String(row.feeAmount),
    feeCategoryId: asText(row.feeCategoryId),
    cardId: asText(row.cardId),
    installmentMonths: intOrNull(row.installmentMonths),
    tagIds: list(row.tagIds),
    createdAt: row.createdAt ? asIso(row.createdAt) : '',
    updatedAt: row.updatedAt ? asIso(row.updatedAt) : '',
    updatedVersion: row.updatedVersion == null ? 0 : asInt(row.updatedVersion),
    fieldHlc: asJson(row.fieldHlc),
  };
}

/**
 * 세기 전에 깔아 두는 값. **서버가 아직 모르는 계좌의 기초 잔액**이다.
 *
 * 기기에서 통장을 만들면 기초 잔액이 잔액 칸에만 적힌다 -- 그것을 전표로 만드는 일은
 * 서버가 명령을 재생할 때 한다. 그래서 그 전표가 돌아오기 전까지는 다리를 세어도 0 이고,
 * 방금 "50,000원으로 개설"한 통장이 0원으로 보인다.
 *
 * 서버가 아는 줄(번호가 붙은 줄)에는 깔지 않는다. 그때는 기초 잔액이 이미 다리로 들어와
 * 있어, 함께 세면 두 번 센다.
 */
export function openingSeed(row: Row): Dec {
  return asInt(row.updatedVersion) === 0 ? Dec.of(asMoney(row.balance)) : Dec.of(0);
}

/** 사본의 한 줄을 창구가 내보내는 모양으로. 서버 응답과 같은 모양이어야 한다. */
export function toDraftResponse(row: Row): EntryDraftDto.Response {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    source: String(row.source) as EntryDraftDto.Response['source'],
    status: String(row.status) as EntryDraftDto.Response['status'],
    rawText: String(row.rawText ?? ''),
    appPackage: asText(row.appPackage),
    appTitle: asText(row.appTitle),
    kind: asText(row.kind) as EntryDraftDto.Response['kind'],
    amount: asText(row.amount),
    currency: asText(row.currency),
    occurredAt: asText(row.occurredAt),
    merchant: asText(row.merchant),
    description: asText(row.description),
    installmentMonths: row.installmentMonths == null ? null : asInt(row.installmentMonths),
    personId: asText(row.personId),
    categoryId: asText(row.categoryId),
    accountId: asText(row.accountId),
    toAccountId: asText(row.toAccountId),
    feeAmount: asText(row.feeAmount),
    feeCategoryId: asText(row.feeCategoryId),
    cardId: asText(row.cardId),
    confidence: asInt(row.confidence),
    parser: asText(row.parser),
    dedupeKey: String(row.dedupeKey ?? ''),
    registeredEntryId: asText(row.registeredEntryId),
    recurringRuleId: asText(row.recurringRuleId),
    createdByName: asText(row.createdByName),
    deviceName: asText(row.deviceName),
    /*
     * 태그는 다리 표에 있다. 이 함수는 한 줄만 보므로 비워 두고, 부르는 쪽이 한 번에
     * 읽어 붙인다(`draftRows`). 여기서 그때그때 물으면 줄마다 질의가 하나씩 늘어난다.
     */
    tagIds: [],
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  };
}

/**
 * 회차 기준의 집계 행 하나. 규칙은 공용 `spreadInstallmentRow` 에 있고(서버도 같은 것을 쓴다),
 * 여기서는 사본의 열을 그 모양으로 옮길 뿐이다. 걸린 환불은 (줄 키, 조정 JSON) 짝을 레코드
 * 구분자(30)·단위 구분자(31)로 이어 붙인 한 칸으로 온다.
 */
export function spreadRowOf(named: NamedCategoryPostingRow, row: Row): NamedCategoryPostingRow {
  const months = row.installmentMonths == null ? 0 : asInt(row.installmentMonths);
  return spreadInstallmentRow(named, {
    lineKey: asText(row.lineKey),
    refundAdjust: asText(row.refundAdjust),
    ownDate: String(row.ownDate),
    plan:
      months > 0
        ? {
            months,
            amount: asMoney(row.installmentAmount ?? '0'),
            baseAmount: asMoney(row.installmentBase ?? '0'),
            principalShares: row.principalShares,
            interestShares: row.interestShares,
          }
        : null,
    refunds: String(row.installmentCuts ?? '')
      .split(String.fromCharCode(30))
      .filter(Boolean)
      .map((pair) => {
        const [lineKey, adjust] = pair.split(String.fromCharCode(31));
        return { lineKey: lineKey || null, adjust };
      }),
  });
}

/**
 * 카드 번호 마스킹. 서버가 내보내는 모양과 같아야 한다.
 *
 * 사본에는 서버가 이미 마스킹한 값이 들어오지만(응답에 실린 것이 그것이다), 값이
 * 없을 때 화면이 undefined 를 만나지 않도록 한 곳에서 빈 문자열로 맞춘다.
 */
export function maskCardNumber(value: string | null): string {
  return value ?? '';
}
