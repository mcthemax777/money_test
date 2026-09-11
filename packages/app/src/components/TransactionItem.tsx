/*
 * 거래 한 줄. 웹 목록의 TransactionItem 과 같은 규칙이다.
 *   1줄: 무슨 거래인가 + 붙은 태그 + 얼마
 *   2줄: 분류 · 쓴 자산 · 날짜 · 시각
 */
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { EntryListItem } from '@money/types';

import { formatDate, formatTime } from '@money/core/lib/datetime';
import { entryAssetName } from '@money/core/lib/entries';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

/** 금액 색이 곧 "합계에 들어가는가"다. 이체와 카드사 이체는 회색이다. */
const AMOUNT_COLOR: Record<EntryListItem['kind'], string> = {
  income: 'text-green-600',
  expense: 'text-red-600',
  transfer: 'text-gray-500',
  card_payment: 'text-gray-500',
  adjustment: 'text-amber-600',
};

const SIGN: Partial<Record<EntryListItem['kind'], string>> = { income: '+', expense: '-' };

/** 계좌 사이를 오가는 거래. 이것들만 "A → B" 로 적는다. */
const TWO_SIDED: Array<EntryListItem['kind']> = ['transfer', 'card_payment', 'adjustment'];

/*
 * 누름은 거래를 되돌려 준다.
 *
 * 부르는 쪽이 `() => onPress(entry)` 를 만들어 넘기면 그릴 때마다 새 함수라 아래
 * `memo` 가 늘 헛돈다. 거래 화면은 한 달을 통째로 펼치면 이 줄이 200개까지 서므로,
 * 함수 하나 때문에 200줄이 다시 그려지는 일을 두면 안 된다.
 */
function TransactionItemView({
  entry,
  onPress,
}: {
  entry: EntryListItem;
  onPress?: (entry: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();

  const flowTo = entry.toAccountName ?? entry.cardName;

  /*
   * "보낸 곳 -> 받은 곳". 계좌 사이를 오가는 거래에만 만든다. 한쪽 이름이라도 비면
   * 만들지 않는다 -- "농협 → " 같은 반쪽짜리 화살표는 받는 곳이 지워진 것처럼 읽힌다.
   */
  const flow =
    TWO_SIDED.includes(entry.kind) && entry.accountName && flowTo
      ? `${entry.accountName} → ${flowTo}`
      : '';

  // 설명이 빈 거래의 이름으로 쓰는 분류. 이름 자리에는 "대분류 > 소분류"를 다 적는다
  // -- 그 줄에서 유일하게 무슨 거래인지 말하는 글자라 좁히지 않는다. 아래 부속 정보
  // 줄의 분류는 이와 달리 잎사귀 하나만 적는다.
  const categoryLabel = entry.parentCategoryName
    ? `${entry.parentCategoryName} > ${entry.categoryName}`
    : entry.categoryName;

  const title = (() => {
    if (entry.kind === 'card_payment') {
      const name = entry.cardName ?? t('editor.methodCard');
      return t(entry.cardTransferDirection === 'refund' ? 'entry.cardRefund' : 'entry.cardPayment', {
        name,
      });
    }
    if (entry.kind === 'transfer' && flow) return flow;
    if (entry.kind === 'transfer') return t('entry.transfer');
    if (entry.kind === 'adjustment') return t('entry.adjustment');
    return entry.description || categoryLabel || t('entry.noTitle');
  })();

  const time = formatTime(entry.date, timeZone);

  /*
   * 2줄에 들어가는 부속 정보. 있는 것만 " · "로 잇는다.
   *
   * 분류 · 쓴 자산 · 날짜 · 시각의 차례다. 무엇에 썼는가가 먼저 읽히고, 언제인가가
   * 뒤따른다. 분류는 **잎사귀 하나만** 적는다 -- 소분류가 있으면 소분류, 없으면
   * 대분류다. 둘을 다 적으면 좁은 화면에서 뒤의 것들이 잘려 나간다.
   *
   * 날짜는 날짜별로 묶인 목록에서는 머리글과 겹치지만, 분류·결제수단으로 묶어 볼
   * 때는 이 줄에만 있다. 어느 묶음에서 보든 같은 줄이 서는 쪽을 택한다.
   *
   * 쓴 자산의 규칙은 core 의 entryAssetName 이 갖는다. 웹의 한 줄도 같은 것을 쓴다.
   */
  const meta = [
    entry.categoryName,
    entryAssetName(entry, flow),
    formatDate(entry.date, timeZone),
    time,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress && (() => onPress(entry))}
      disabled={!onPress}
      className="border-b border-gray-100 px-3 py-2.5 active:bg-gray-50"
    >
      <View className="flex-row items-baseline gap-3">
        {/*
          제목과 태그를 한 덩어리로 묶어 왼쪽을 채운다.

          태그는 제목 바로 오른쪽에 붙는다 -- "이 거래가 어느 일에 딸렸나"는 거래
          이름에 이어 읽히는 곁말이다. 이름만 작게 적는다. 제목만큼 크면 무엇이
          거래인지 흐려진다.

          넘치면 제목이 먼저 줄고(shrink + numberOfLines), 그래도 넘치는 태그는 잘라
          낸다(overflow-hidden). 금액은 줄어들지 않아 오른쪽 끝에 그대로 선다.
        */}
        <View className="flex-1 flex-row items-baseline gap-1.5 overflow-hidden">
          <Text numberOfLines={1} className="shrink text-[15px] font-medium text-gray-900">
            {title}
          </Text>
          {entry.tags.map((tag) => (
            <View
              key={tag.id}
              className="flex-row items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5"
            >
              {tag.color ? (
                <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              ) : null}
              <Text className="text-[11px] text-gray-600">{tag.name}</Text>
            </View>
          ))}
        </View>
        <Text className={`text-[15px] font-semibold ${AMOUNT_COLOR[entry.kind]}`}>
          {SIGN[entry.kind]}
          {formatCurrency(entry.amount, displayCurrency)}
        </Text>
      </View>

      {meta ? (
        <Text numberOfLines={1} className="mt-0.5 text-xs text-gray-500">
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * 값이 그대로면 다시 그리지 않는다.
 *
 * 한 줄을 그리는 값이 싸지 않다. 시각 표기만 해도 거래마다 Intl 을 두 번 거친다.
 * 거래 화면은 줄 하나가 도착할 때마다 상태가 바뀌는데, 그때 이미 서 있는 줄까지 전부
 * 다시 그리면 한 달 펼치기가 눈에 보이게 밀린다.
 */
export default memo(TransactionItemView);
