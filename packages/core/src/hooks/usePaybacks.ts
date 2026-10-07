/**
 * 원거래에 걸린 페이백 (PAYBACK_DESIGN.md 7단계).
 *
 * 원거래 상세가 "받은 페이백"과 그 합을 그린다. 웹과 앱의 상세가 함께 쓴다.
 * 결제할 때 깎인 차감도 같은 칸에 줄별로 함께 싣는다 (7-7) -- 차감은 원거래에 적힌 값이라
 * 따로 읽지 않는다.
 *
 * 지출만 본다. 페이백은 지출 줄을 되돌리는 것이라 다른 갈래에는 걸리지 않는다.
 *
 * 웹은 서버에서, 앱은 사본에서 읽는다. 둘 다 같은 조건(`paybackOf`)으로 고른다.
 */
import { useEffect, useMemo, useState } from 'react';
import { originalEntry, type EntryLine, type EntryListItem } from '@money/types';
import { homeDataPort } from '../data/home-port';
import type { MessageKey } from '../lib/i18n';
import { toNumber } from '../lib/money';
import { useLoadedKey } from './useLoadedKey';
import { useMirrorVersion } from './useMirrorVersion';

/** 원거래의 한 줄과 그 줄에서 깎이고 돌려받은 것. */
export interface PaybackLineGroup {
  /** 원거래의 줄. 원거래에서 찾지 못한 줄에 걸린 것은 null 로 따로 모은다. */
  line: EntryLine | null;
  items: EntryListItem[];
  /** 이 줄에서 돌려받은 합 (표시 통화). */
  received: number;
  /**
   * 결제할 때 이 줄에서 깎인 금액. 없으면 null.
   *
   * 외화로 적은 거래면 결제 통화 그대로다(`discountCurrency`). 표시 통화로 옮기지 않으므로
   * 돌려받은 것과 더하거나 정가를 되살리는 데 쓰지 않는다.
   */
  discount: number | null;
  /** 차감의 통화. 표시 통화와 같으면 null. */
  discountCurrency: string | null;
  /** 깎이기 전의 값 = 줄 금액 + 차감. 차감이 없거나 통화가 다르면 null. */
  listPrice: number | null;
  /** 이 줄의 금액(차감 뒤)에서 돌려받은 것을 뺀 것. 줄을 찾지 못했으면 null. */
  remaining: number | null;
}

export interface PaybackList {
  items: EntryListItem[];
  /**
   * 줄별로 묶은 것. 어느 분류가 얼마 깎였는지 보이게 한다.
   *
   * 원거래를 나눴거나 차감이 있을 때만 싣는다. 차감이나 돌려받은 것이 있는 줄만, 원거래의
   * 줄 차례로 담는다. 둘 다 아니면 빈 배열이고, 화면은 받은 목록만 그린다.
   */
  byLine: PaybackLineGroup[];
  /** 차감이 있는 줄이 하나라도 있는가. 칸 이름이 "차감·환불·페이백"이 된다. */
  hasDiscount: boolean;
  /** 받은 페이백의 합 (표시 통화). */
  total: number;
  /**
   * 받은 합이 원거래 금액보다 많은가.
   *
   * 막지 않고 알리기만 한다 -- 끊긴 두 기기가 따로 적으면 서버가 재생할 때에야 넘는 것을
   * 알 수 있어, 막으면 이미 들어온 돈의 기록이 거절된다 (결정 C).
   */
  isOver: boolean;
  isLoading: boolean;
  /** 불러오지 못했다. 빈 목록과 가른다 -- 실패를 "받은 페이백 없음"으로 보이면 안 된다. */
  failed: boolean;
}

export function usePaybacks(
  original: EntryListItem | null,
  projectId: string | null | undefined,
  /** 부르는 쪽이 저장한 뒤 다시 읽게 할 때 올린다. */
  reloadToken = 0,
): PaybackList {
  const [items, setItems] = useState<EntryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const mirrorVersion = useMirrorVersion();
  const loaded = useLoadedKey();

  /*
   * 할부는 회차 몫으로 옮긴 줄이 올 수 있다. 회차 줄은 금액이 한 달치이고 차감을 비워 두므로,
   * 산 날의 거래로 되돌려 본다 (`originalEntry`).
   */
  const whole = original ? originalEntry(original) : null;
  const originalId = whole && whole.kind === 'expense' ? whole.id : null;

  useEffect(() => {
    setFailed(false);
    if (!originalId || !projectId) {
      loaded.mark(null);
      setItems([]);
      return;
    }

    let cancelled = false;
    // 같은 거래를 다시 받을 때는 목록을 가리지 않는다 (useLoadedKey 주석).
    const queryKey = `${originalId}|${projectId}`;
    const isRefresh = loaded.has(queryKey);
    if (!isRefresh) setIsLoading(true);
    homeDataPort()
      .getAllEntries({ paybackOf: originalId }, projectId)
      .then((rows) => {
        if (cancelled) return;
        loaded.mark(queryKey);
        // 먼저 들어온 것이 위다. 나눠 받은 차례를 따라 읽게 한다.
        setItems(
          [...(rows as EntryListItem[])].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          ),
        );
      })
      .catch((error) => {
        console.error('받은 페이백을 불러오지 못했습니다:', error);
        // 다시 받다 실패했다면 그려 둔 목록은 여전히 이 거래의 것이다.
        if (cancelled || isRefresh) return;
        setItems([]);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [originalId, projectId, mirrorVersion, reloadToken, loaded]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + toNumber(item.amount), 0),
    [items],
  );

  const byLine = useMemo(() => groupByLine(originalId ? whole : null, items), [originalId, whole, items]);

  return {
    items,
    byLine,
    hasDiscount: byLine.some((group) => group.discount !== null),
    total,
    isOver: whole !== null && total > toNumber(whole.amount),
    isLoading,
    failed,
  };
}

function groupByLine(original: EntryListItem | null, items: EntryListItem[]): PaybackLineGroup[] {
  if (!original) return [];
  const hasDiscount = original.lines.some((line) => line.discountAmount);
  if (!hasDiscount && (original.lines.length < 2 || items.length === 0)) return [];

  // 외화로 적은 거래의 차감은 결제 통화 그대로 온다 (entry-view 의 showDiscount).
  const discountCurrency = original.originalCurrency ?? null;
  const groups: PaybackLineGroup[] = [];
  for (const line of original.lines) {
    const own = items.filter((item) => item.paybackOfLineKey === line.lineKey);
    // 줄이 하나뿐이면 키가 어긋난 것도 그 줄의 것이다 (서버의 rebind 와 같은 판단).
    if (original.lines.length === 1) {
      own.push(...items.filter((item) => item.paybackOfLineKey !== line.lineKey));
    }
    const discount = line.discountAmount ? toNumber(line.discountAmount) : null;
    if (own.length === 0 && discount === null) continue;
    const amount = toNumber(line.amount);
    const received = own.reduce((sum, item) => sum + toNumber(item.amount), 0);
    groups.push({
      line,
      items: own,
      received,
      discount,
      discountCurrency,
      listPrice: discount !== null && !discountCurrency ? amount + discount : null,
      remaining: amount - received,
    });
  }
  if (original.lines.length === 1) return groups;

  // 원거래를 고쳐 줄이 사라졌는데 아직 옮겨지지 않은 것(다른 기기의 늦은 동기화)이다.
  const lineKeys = new Set(original.lines.map((line) => line.lineKey));
  const stray = items.filter((item) => !item.paybackOfLineKey || !lineKeys.has(item.paybackOfLineKey));
  if (stray.length > 0) {
    groups.push({
      line: null,
      items: stray,
      received: stray.reduce((sum, item) => sum + toNumber(item.amount), 0),
      discount: null,
      discountCurrency: null,
      listPrice: null,
      remaining: null,
    });
  }
  return groups;
}

/**
 * 줄 묶음 한 줄 요약. "정가 · 차감 · 돌려받음 · 남음" 중 있는 것만 잇는다. 웹과 앱이 같은 말을 한다.
 *
 * `money` 는 통화가 오면 그 통화로, 없으면 표시 통화로 적는다. 외화 차감은 정가를 되살릴 수
 * 없어 정가를 빼고 차감만 결제 통화로 적는다.
 */
export function paybackGroupSummary(
  group: PaybackLineGroup,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  money: (amount: number, currency?: string) => string,
): string {
  if (group.remaining === null) return '';
  return [
    group.listPrice !== null ? t('payback.sumListPrice', { amount: money(group.listPrice) }) : null,
    group.discount !== null
      ? t('payback.sumDiscount', { amount: money(group.discount, group.discountCurrency ?? undefined) })
      : null,
    group.received > 0 ? t('payback.sumReceived', { amount: money(group.received) }) : null,
    t('payback.sumRemaining', { amount: money(group.remaining) }),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * 원거래를 지울 때 함께 지워지는 환불·페이백의 수 (PAYBACK_DESIGN.md 7-6). 지우기 전에 묻는 말에 싣는다.
 *
 * 지출이 아니면 0 이다. 읽지 못하면 null -- 묻는 말은 "있으면 함께 지워진다"로 대신한다.
 * 0 으로 삼으면 걸린 것이 있는데도 아무 말 없이 지우게 된다.
 */
export async function paybackCountOf(
  entry: EntryListItem,
  projectId: string | null | undefined,
): Promise<number | null> {
  if (entry.kind !== 'expense') return 0;
  if (!projectId) return null;
  try {
    return (await homeDataPort().getAllEntries({ paybackOf: entry.id }, projectId)).length;
  } catch (error) {
    console.error('걸린 환불·페이백을 세지 못했습니다:', error);
    return null;
  }
}

/** 지우기 전에 묻는 말에 덧붙일 문장. 덧붙일 것이 없으면 빈 문자열이다. */
export function paybackDeleteNote(
  count: number | null,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (count === null) return t('payback.deleteWithUnknown');
  if (count === 0) return '';
  return t('payback.deleteWith', { count });
}
