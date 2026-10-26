/*
 * 자산 목록의 계좌 한 줄과 그 줄에 달려 내려오는 카드들.
 *
 * 자산 화면(AssetsScreen)에서 떼어 냈다 (2026-10-26). 사용자별·자산유형별 두 목록이 함께 쓴다.
 */
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { accountTypeLabel } from '@money/core/lib/account-type';
import { accountDueOf } from '@money/core/lib/card-settlement';
import { todayKey } from '@money/core/lib/datetime';
import {
  accountBalanceLine,
  accountMetaParts,
  type AssetMetaPart,
  type AssetMetaTone,
} from '@money/core/lib/asset-meta';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { Account, Card } from '@money/core/lib/types';
import { useProjectTimeZone } from '@money/core/store/project';

import DragList from './DragList';
import { usePressFade } from './usePressFade';

/**
 * 계좌 이름 밑에 한 줄로 이어 붙는 작은 글씨들 (core 의 `accountMetaParts`).
 *
 * 수익·계좌번호를 줄마다 하나씩 쌓으면 계좌 하나가 네 줄이 된다. 가운뎃점으로
 * 이어 한 줄에 두되, 좁은 화면에서는 접혀 내려가게 둔다 -- 잘라 내면 뒤에 선
 * 계좌번호가 통째로 사라진다.
 *
 * 무게는 조각마다 다르다. 셋을 같은 색으로 두면 한 줄에 모인 순간 어느 것이 큰 금액을
 * 설명하는 수인지 알 수 없다.
 */
const META_TONE_CLASS: Record<AssetMetaTone, string> = {
  profit: 'font-semibold text-green-600',
  loss: 'font-semibold text-red-600',
  maturity: 'font-semibold text-blue-600',
  muted: 'text-gray-400',
};

function AssetMetaLine({ parts }: { parts: AssetMetaPart[] }) {
  if (parts.length === 0) return null;

  return (
    <View className="shrink flex-row flex-wrap items-center">
      {parts.map((part, index) => (
        <View key={part.key} className="flex-row items-center">
          {/* 가운뎃점은 앞 조각의 색을 따르지 않는다. 이어 주는 표시일 뿐이다. */}
          {index > 0 ? <Text className="px-1.5 text-xs text-gray-300">·</Text> : null}
          <Text className={`text-xs ${META_TONE_CLASS[part.tone]}`}>{part.text}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * 카드 줄 오른쪽 끝의 남은 대금. 웹의 자산 목록과 같은 규칙이다.
 *
 * 아직 정산하지 않은 것이 있을 때만 적는다. 0원을 적어 두면 다 갚은 카드가 밀린
 * 카드와 같은 무게로 보인다. 체크카드는 결제 즉시 통장에서 빠져 갚을 것이 남지 않는다.
 *
 * 금액만 두면 이번 달 사용액인지 남은 대금인지 알 수 없어 앞에 이름을 붙인다.
 * 음수는 카드사가 갚을 돈이다(사용을 취소했거나 대금을 더 가져간 뒤). 부호만 바꿔
 * 적으면 빚으로 읽히므로 이름과 색을 함께 바꾼다 -- 정산 판과 같은 규칙이다.
 */
function CardOutstanding({ card, currency }: { card: Card; currency: string }) {
  // 훅은 이른 반환보다 앞이어야 한다.
  const { t } = useTranslation();

  if (card.cardType !== 'credit') return null;

  const outstanding = toNumber(card.currentUsage);
  if (outstanding === 0) return null;

  const refundPending = outstanding < 0;

  return (
    <Text
      className={`text-sm font-bold ${refundPending ? 'text-emerald-700' : 'text-red-600'}`}
    >
      <Text className="text-xs font-medium">
        {t(refundPending ? 'settlement.refundPending' : 'settlement.remaining')}{' '}
      </Text>
      {formatCurrency(Math.abs(outstanding), currency)}
    </Text>
  );
}

/**
 * 계좌 한 줄과 그 줄에 달려 내려오는 카드들.
 *
 * 왼쪽에 계좌명, 오른쪽 끝에 남은 금액을 둔다. 어느 계좌인지 먼저 알아야 하고, 금액은
 * 오른쪽 끝에 모여 있어야 위아래로 훑으며 견줄 수 있다. 유형은 총자산을 현금성·투자·
 * 부채로 나누는 기준이라 계좌명 옆에 붙인다.
 */
export default function AccountRow({
  account,
  ownerName,
  excluded,
  profit,
  cards,
  onOpen,
  onOpenCard,
  onReorderCards,
}: {
  account: Account;
  /** 있으면 계좌명 옆에 적는다. 여러 사람이 섞인 자산유형별 목록이 넘긴다. */
  ownerName?: string;
  /** 합계에서 뺀 계좌. 줄은 그대로 두고 "합계 제외"를 붙여 금액을 옅게 적는다 (웹과 같다). */
  excluded: boolean;
  profit?: string;
  cards: Card[];
  /** 이 계좌의 상세(잔액 추이)를 펼친다 */
  onOpen: () => void;
  /** 그 카드의 상세(실적, 주기별 사용액)를 펼친다 */
  onOpenCard: (card: Card) => void;
  onReorderCards: (id: string, toIndex: number) => void;
}) {
  const { t } = useTranslation();
  /* 이 통장으로 빠져나갈 카드 대금과, 그것을 뺀 남은 금액. 셈은 core 가 한다(웹과 같은 값). */
  const { due, remaining } = accountDueOf(account.balance, cards);
  const balanceLine = accountBalanceLine(account, { due, t });
  // 만기 D-day 는 가계부 타임존의 오늘과 견준다 (웹과 같다).
  const today = todayKey(useProjectTimeZone());
  const metaParts = accountMetaParts(account, { profit, today, t });
  const fade = usePressFade();

  /* 겉 상자는 목록(DragList)이 씌운다. 여기서 또 씌우면 테두리가 두 겹이 된다. */
  return (
    <>
      {/*
        계좌 칸 전체가 누를 자리다 (웹의 계좌 버튼과 같다). 예전에는 이름 줄만 받아서,
        정작 크게 적힌 금액이나 그 아래 줄을 눌러서는 상세가 열리지 않았다.

        줄의 여백(DragList 가 준 px-4 py-2)까지 누를 자리로 삼는다. 여백을 음수 여백으로 도로
        덮고 같은 크기의 안 여백을 주면, 보이는 모양은 그대로면서 손이 닿는 자리만 넓어진다.

        카드 묶음은 이 밖에 둔다. 그쪽을 함께 받으면 카드를 누른 것이 계좌 상세로 간다.
      */}
      <Pressable
        className="-mx-4 -mt-2 px-4 pt-2"
        onPressIn={fade.onPressIn}
        onPressOut={fade.onPressOut}
        onPress={onOpen}
      >
        {/*
          흐림은 안쪽에 준다. 겉의 Pressable 은 음수 여백으로 줄 밖까지 누를 자리를 넓혀
          두었는데, 그것을 다른 뷰로 감싸면 안드로이드는 감싼 뷰 밖의 손끝을 받지 않는다.
        */}
        <Animated.View style={fade.style}>
        <View className="flex-row items-center justify-between gap-3">
          <View className="shrink flex-row items-center gap-1.5">
            <Text numberOfLines={1} className="shrink text-sm font-medium text-gray-900">
              {account.name}
            </Text>
            <Text className="rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
              {accountTypeLabel(account.type)}
            </Text>
            {ownerName ? <Text className="text-xs text-gray-500">{ownerName}</Text> : null}
            {/* 유형 배지와 같은 자리·크기, 점선 테두리로 갈라 유형의 하나로 읽히지 않게 한다. */}
            {excluded ? (
              <Text className="rounded border border-dashed border-gray-400 px-1.5 py-px text-[11px] text-gray-500">
                {t('assets.excludedFromTotal')}
              </Text>
            ) : null}
          </View>
          {/*
            잔액이 아니라 카드 대금을 뺀 남은 금액이다. 통장에 찍힌 돈에는 카드사가
            이미 가져가기로 된 몫이 섞여 있어, 잔액만 보면 쓸 수 있는 돈을 그만큼
            부풀려 읽는다.

            마이너스면 빨강이다 (아래 잔액도 같다, 웹과 같다). 대출·마이너스통장처럼 갚을
            돈이 남은 계좌를 훑어보며 바로 가려낼 수 있어야 한다.
          */}
          <Text
            className={`text-base font-bold ${
              excluded ? 'text-gray-400' : remaining < 0 ? 'text-red-600' : 'text-gray-900'
            }`}
          >
            {formatCurrency(remaining, account.currency)}
          </Text>
        </View>

        {/*
          둘째 줄. 왼쪽에 수익·계좌번호, 오른쪽 끝에 잔액이다. 무엇을 적을지는 core 가
          정한다 (`accountMetaParts`·`accountBalanceLine` -- 웹과 같다).

          윗줄과 같은 짜임이라 이름 밑에 주인이, 큰 금액 밑에 잔액이 선다. 잔액을 따로 한
          줄 더 내리면 계좌 하나가 세 줄이 되고, 왼쪽에 끼워 넣으면 어느 수를 설명하는
          줄인지 사라진다.
        */}
        {metaParts.length > 0 || balanceLine ? (
          <View className="mt-0.5 flex-row items-center justify-between gap-3">
            {/*
              왼쪽이 비어도 자리는 남긴다. 적을 것이 잔액뿐일 때 감싸는 칸까지 사라지면
              잔액이 왼쪽으로 붙어, 윗줄의 큰 금액과 어긋난다.
            */}
            <View className="flex-1">
              <AssetMetaLine parts={metaParts} />
            </View>
            {balanceLine ? (
              <Text
                className={`text-xs font-medium ${
                  toNumber(account.balance) < 0 ? 'text-red-600' : 'text-gray-700'
                }`}
              >
                {balanceLine}
              </Text>
            ) : null}
          </View>
        ) : null}
        </Animated.View>
      </Pressable>

      {/*
        카드는 결제 통장에 **달려 내려온다.** 그 통장이 곧 이 계좌다.

        왼쪽의 세로줄 하나와 들여쓰기가 딸린 것임을 말한다. 예전에는 가름줄을 긋고 초록
        상자를 쌓았는데, 상자는 그 자체로 한 항목의 무게라 통장과 카드가 같은 층에 선
        것처럼 보였다. 세로줄은 자리를 거의 쓰지 않으면서 층을 만든다 (웹과 같다).
      */}
      {cards.length > 0 ? (
      /* 뺀 통장에 딸린 카드의 대금도 함께 빠진다. 옅게 그려 그것을 말한다 (웹과 같다). */
      <View className={`ml-1 mt-1 border-l border-gray-200 pl-3 ${excluded ? 'opacity-60' : ''}`}>
          <DragList
            items={cards}
            gap={0}
            /* 줄은 좁지만 손이 닿는 자리는 따로다. 글자 위아래로 조금 더 준다. */
            itemClassName="py-1"
            onPressItem={onOpenCard}
            onReorder={onReorderCards}
            /*
              한 줄에 다 넣는다. 갈래(신용·체크)를 아랫줄로 내리면 카드 하나가 두 줄이
              되어, 통장마다 카드가 둘씩만 있어도 목록이 화면을 훌쩍 넘는다. 갈래는 이름
              옆의 작은 배지다 -- 계좌 유형 배지와 같은 자리, 같은 모양이다 (웹과 같다).
            */
            renderItem={(card) => (
              <View className="flex-row items-center justify-between gap-2">
                <View className="shrink flex-row items-center gap-1.5">
                  <Text numberOfLines={1} className="shrink text-sm text-gray-700">
                    💳 {card.name}
                  </Text>
                  <Text className="rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
                    {t(card.cardType === 'debit' ? 'method.debit_card' : 'method.credit_card')}
                  </Text>
                </View>
                {/* 카드 금액은 전부 결제 통장의 통화다 (기준통화 환산액이 아니다). */}
                <CardOutstanding card={card} currency={account.currency} />
              </View>
            )}
          />
      </View>
      ) : null}
    </>
  );
}
