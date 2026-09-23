/*
 * 거래 한 줄. 웹 목록의 TransactionItem 과 같은 규칙이다.
 *   1줄: 무슨 거래인가 + 붙은 태그 + 얼마
 *   2줄: 분류 · 쓴 자산 · 날짜 · 시각
 */
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Split } from 'lucide-react-native';
import type { EntryListItem, EntryRow } from '@money/types';

import { formatDate, formatTime } from '@money/core/lib/datetime';
import {
  categoryTitleOf,
  entryAmountLook,
  entryAssetName,
  type EntryAmountTone,
} from '@money/core/lib/entries';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, formatOriginal, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

/** 금액 색이 곧 "합계에 들어가는가"다. 이체와 카드사 이체는 회색이다. */
const AMOUNT_COLOR: Record<EntryAmountTone, string> = {
  income: 'text-green-600',
  expense: 'text-red-600',
  neutral: 'text-gray-500',
  adjustment: 'text-amber-600',
};

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
  row,
  onPress,
}: {
  entry: EntryListItem;
  /**
   * 이 줄이 가리키는 분류 줄. 나눈 거래를 줄로 펴서 그릴 때 준다.
   *
   * 없으면 거래 하나를 한 줄로 그린다 -- 계좌 관점으로 보는 화면이 그렇다.
   */
  row?: EntryRow;
  onPress?: (entry: EntryListItem, row?: EntryRow) => void;
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

  /*
   * 설명이 빈 거래의 이름으로 쓰는 분류 ("대분류 > 소분류").
   *
   * **그 줄의 분류를 쓴다.** 거래에 실린 대표 분류는 나눈 줄 중 첫 줄이라, 여행경비로
   * 좁혀 여행경비 한 줄만 서 있는데 제목에는 식비가 뜨는 일이 생긴다.
   *
   * 자산 상세의 원장 줄도 같은 것을 쓰므로 규칙은 core 에 있다.
   */
  const categoryLabel = categoryTitleOf(row?.line ?? entry);

  /*
   * 나눈 거래의 줄은 **아이콘 하나로** 표시한다. 웹의 한 줄과 같은 규칙이다.
   *
   * 줄마다 적는 것은 다르지 않다 -- 첫 줄이든 둘째 줄이든 가맹점명·날짜·시각을 그대로
   * 적고, 같은 아이콘이 "이 줄은 나눈 거래의 일부"라고 말한다.
   *
   * 기준은 화면에 몇 줄이 그려지는가가 아니라 **그 거래가 나뉘어 있는가**(`splitCount`)다.
   */
  const isSplitLine = Boolean(row?.line) && entry.splitCount > 1;
  const line = row?.line ?? null;

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
  // 부호와 색. 규칙은 core 에 있다 (웹의 한 줄과 같아야 한다).
  const look = entryAmountLook(entry, row?.amount ?? entry.amount);
  // 결제 자리에서 곧바로 빠진 금액 (포인트 사용·자동할인). 없으면 0 이다.
  const discount = toNumber(line ? line.discountAmount : entry.discountAmount);

  /*
   * 이체에 붙은 수수료.
   *
   * 이체는 "얼마를 어디로 보냈는가"와 "수수료를 얼마 냈는가"가 서로 다른 정보다. 위
   * 금액은 보낸 돈이라 회색으로 서고, 실제로 쓴 돈은 수수료뿐이므로 그것만 빨갛게 적는다.
   * 적지 않으면 통장에서 빠진 돈과 목록의 금액이 어긋나 보인다. 웹의 한 줄과 같다.
   */
  const fee = entry.kind === 'transfer' ? toNumber(entry.feeAmount) : 0;
  const hasFee = fee > 0;

  /*
   * 외화가 얽힌 거래의 원래 금액. 없으면 빈 글자다.
   *
   * 위 금액은 언제나 기준통화 환산액이라 그것만으로는 카드 명세서와 대조할 수 없다.
   * "$50.00 · 환율 1,380" 처럼 원래 금액과 환율을 함께 적는다. 웹의 한 줄과 같다.
   */
  const original = formatOriginal(entry);

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
    line?.categoryName ?? entry.categoryName,
    entryAssetName(entry, flow),
    formatDate(entry.date, timeZone),
    time,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress && (() => onPress(entry, row))}
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
          {/*
            나눈 거래의 줄. 제목 앞에 작게 세워 "이 줄은 그 결제의 일부"라고 말한다.
            줄마다 같은 아이콘이다 -- 나눈 줄 사이에 앞뒤가 없기 때문이다.
          */}
          {isSplitLine ? (
            <Split size={12} color="#9ca3af" accessibilityLabel={t('entry.split')} />
          ) : null}
          <Text numberOfLines={1} className="shrink text-[15px] font-medium text-gray-900">
            {title}
          </Text>
          {(line?.tags ?? entry.tags).map((tag) => (
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
        <Text className={`text-[15px] font-semibold ${AMOUNT_COLOR[look.tone]}`}>
          {look.sign}
          {formatCurrency(look.amount, displayCurrency)}
        </Text>
      </View>

      {meta || original || hasFee || discount > 0 ? (
        <View className="mt-0.5 flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-xs text-gray-500">
            {meta}
          </Text>
          {/*
            금액이 붙는 표시는 오른쪽 끝에 모은다. 위 줄의 금액과 같은 세로선에 선다.

            차례는 웹과 같다 -- 원래 금액, 수수료, 차감이다. 한 거래에 여럿이 함께 오는
            일은 드물지만(이체에는 차감 칸이 없다), 차례가 갈리면 두 화면을 견줄 때
            헷갈린다.
          */}
          {original || hasFee || discount > 0 ? (
            <View className="ml-auto flex-row items-center gap-1.5">
              {original ? (
                <Text className="text-xs text-gray-400">
                  {original}
                  {/*
                    청구액이 아직 카드사 확정 전이라는 표시. 이 값이 붙어 있는 동안 위
                    금액은 서버 추정 환율로 만든 값이고, 카드 화면에서 명세서의 실제
                    청구액으로 확정한다.
                  */}
                  {entry.rateProvisional ? (
                    <Text className="text-amber-600"> · {t('entry.provisional')}</Text>
                  ) : null}
                </Text>
              ) : null}
              {hasFee ? (
                <Text className="text-xs font-medium text-red-600">
                  {t('entry.fee', { amount: formatCurrency(fee, displayCurrency) })}
                </Text>
              ) : null}
              {/*
                회차 기준으로 볼 때의 할부 줄. 위 금액은 이미 그 회차 몫이다.

                이자는 **이체 수수료와 같은 모양으로** 적는다. 그 달에 나가는 돈 안에서
                원금이 아닌 부분이라, 내는 돈이 왜 회차 원금보다 큰지가 그 한 줄로 드러난다.
              */}
              {row?.installment ? (
                <>
                  <Text className="text-xs text-gray-500">
                    {t('entry.installmentRow', {
                      index: row.installment.index,
                      months: row.installment.months,
                    })}
                  </Text>
                  {Number(row.installment.interest) > 0 ? (
                    <Text className="text-xs font-medium text-red-600">
                      {t('entry.installmentInterest', {
                        amount: formatCurrency(Number(row.installment.interest), displayCurrency),
                      })}
                    </Text>
                  ) : null}
                </>
              ) : null}
              {/*
                결제 자리에서 깎인 금액. 위 금액은 이미 깎인 뒤라 이것이 없으면 정가를
                알 수 없다. 나간 돈이 아니므로 초록으로 적는다.
              */}
              {discount > 0 ? (
                <Text className="text-xs font-medium text-green-600">
                  {t('entry.discount', { amount: formatCurrency(discount, displayCurrency) })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
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
