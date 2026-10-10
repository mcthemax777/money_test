import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, Minus } from 'lucide-react-native';

import type { AccountExclusion, GroupSelection } from '@money/core/hooks/useAccountExclusion';
import { useTranslation } from '@money/core/lib/i18n';
import { formatAmountWithUnit, formatCurrency } from '@money/core/lib/money';
import {
  ASSET_TYPE_GROUPS,
  assetGroupAmount,
  type AssetGroupKey,
  type NetWorthParts,
} from '@money/core/lib/net-worth';
import type { Account } from '@money/core/lib/types';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import Modal from './Modal';

/**
 * 첫 줄 인사와 유형별 소계. 웹의 AssetTypeSummary 와 같다.
 *
 * "○○님의 자산은 1억 2,345만 원입니다"로 시작한다. 칸을 누르면 그 유형의 계좌 목록이
 * 열리고, 거기서 뺀 계좌는 문장의 금액·아래 추이·목록의 소계에서 빠진다
 * (`useAccountExclusion`). 뺀 것은 기기에 남는다.
 */
export default function AssetTypeSummary({
  parts,
  rawParts,
  scopeTitle,
  hasNoScope,
  accountsOf,
  ownerNameOf,
  exclusion,
}: {
  /** 총자산 응답(또는 고른 사람들의 합). 합계 제외를 덜어 낸 값이다. */
  parts: Pick<NetWorthParts, 'byType' | 'byGroup'> | undefined;
  /** 덜어 내기 전의 같은 값. 계좌를 모두 뺀 유형 칸이 원래 금액을 지운 줄로 보인다. */
  rawParts: Pick<NetWorthParts, 'byType' | 'byGroup'> | undefined;
  /** 유형 칸을 눌렀을 때 목록에 설 계좌 (고른 자산주인의 그 묶음) */
  accountsOf: (group: AssetGroupKey) => Account[];
  ownerNameOf: (account: Account) => string | undefined;
  exclusion: AccountExclusion;
  /** 문장 앞머리에 들어가는 자산주인 제목. 이 화면의 제목을 겸한다. */
  scopeTitle: ReactNode;
  /** 자산주인을 하나도 고르지 않았는지. 그때는 금액 대신 그 사실을 적는다. */
  hasNoScope: boolean;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  /** 계좌 목록을 펼친 유형. 없으면 닫혀 있다. */
  const [openGroup, setOpenGroup] = useState<AssetGroupKey | null>(null);

  /* 묶음마다 합계에 든 정도. 칸의 표시와 문장 아래 줄이 함께 쓴다. */
  const selectionByGroup = useMemo(
    () =>
      new Map(
        ASSET_TYPE_GROUPS.map((group) => [
          group.key,
          exclusion.selectionOf(accountsOf(group.key).map((account) => account.id)),
        ]),
      ),
    [accountsOf, exclusion],
  );

  /* 합계와 그 이름. 일부만 든 묶음은 "(일부)"를 붙인다 (웹과 같다). */
  const { total, label } = useMemo(() => {
    const counted = ASSET_TYPE_GROUPS.filter((group) => selectionByGroup.get(group.key) !== 'none');
    return {
      total: ASSET_TYPE_GROUPS.reduce((acc, group) => acc + assetGroupAmount(parts, group), 0),
      label: counted
        .map((group) =>
          selectionByGroup.get(group.key) === 'some'
            ? t('assetSummary.partialGroup', { name: t(group.labelKey) })
            : t(group.labelKey),
        )
        .join(', '),
    };
  }, [parts, selectionByGroup, t]);

  const pickerGroup = ASSET_TYPE_GROUPS.find((group) => group.key === openGroup);

  return (
    <View className="gap-4">
      <View>
        {/* 제목과 조사가 한 문장으로 읽히도록 같은 줄에 둔다. */}
        <View className="flex-row flex-wrap items-center">
          {scopeTitle}
          {/* 조사는 언어마다 있고 없다. 영어 사전은 이 자리를 비워 둔다. */}
          <Text className="-ml-2 text-2xl font-bold text-gray-900">
            {t('assetSummary.particle')}
          </Text>
        </View>

        {hasNoScope ? (
          <Text className="mt-1 text-lg text-gray-600">{t('assetSummary.noScope')}</Text>
        ) : (
          /*
            가진 돈은 파랑, 모자란 돈은 먹색이다.

            수입·지출처럼 방향이 있는 값이 아니라 "지금 얼마 있는가"라서 초록·빨강으로
            가르지 않는다. 파랑은 그 "가지고 있다"를 말하는 색이다.

            음수는 다르다. 대출만 켜거나 빚이 자산을 넘으면 이 값이 음수가 되는데, 그때
            파랑을 그대로 쓰면 가진 돈처럼 읽힌다. 빨강으로 적으면 이번 달 잘못했다는
            뜻이 되어 그것도 아니다. 그래서 색을 빼고 먹색으로 적는다 -- 무엇을 더한
            값인지는 아래 줄이 말해 준다.
          */
          <Text
            className={`mt-1 text-4xl font-bold ${total < 0 ? 'text-gray-900' : 'text-blue-600'}`}
          >
            {/* 문장으로 읽히는 자리라 기호 대신 이름을 뒤에 붙인다. */}
            {formatAmountWithUnit(total, displayCurrency)}
            <Text className="text-xl font-medium text-gray-500"> {t('assetSummary.suffix')}</Text>
          </Text>
        )}

        {/* 무엇을 더한 금액인지. 카드를 끄면 이 줄도 함께 줄어든다. */}
        <Text className="mt-1 text-sm text-gray-500">{label || t('assetSummary.noType')}</Text>
      </View>

      {/*
        유형 넷. 누르면 그 묶음의 계좌 목록이 열린다. 칸의 모양이 세 상태를 말한다 --
        모두 듦(파란 바탕·채운 체크), 일부 듦(옅은 파랑·점선·빼기), 하나도 안 듦(흰 바탕·
        빈 칸·지운 금액). 웹과 같다.
      */}
      <View className="flex-row flex-wrap">
        {ASSET_TYPE_GROUPS.map((group) => {
          const selection = selectionByGroup.get(group.key) ?? 'all';
          const amount =
            selection === 'none'
              ? assetGroupAmount(rawParts, group)
              : assetGroupAmount(parts, group);

          return (
            <View key={group.key} className="w-1/2 p-1 sm:w-1/4">
              <Pressable
                onPress={() => setOpenGroup(group.key)}
                className={`rounded-lg border p-3 ${
                  selection === 'all'
                    ? 'border-blue-300 bg-blue-50'
                    : selection === 'some'
                      ? 'border-dashed border-blue-300 bg-blue-50/40'
                      : 'border-gray-200 bg-white'
                }`}
              >
                <View className="flex-row items-center gap-1.5">
                  <TriCheck selection={selection} size="sm" />
                  <Text numberOfLines={1} className="text-xs text-gray-600">
                    {t(group.labelKey)}
                  </Text>
                </View>
                <Text
                  className={`mt-1 text-base font-semibold ${
                    selection === 'none'
                      ? 'text-gray-400 line-through'
                      : amount < 0
                        ? 'text-red-600'
                        : 'text-gray-900'
                  }`}
                >
                  {formatCurrency(amount, displayCurrency)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/*
        열 때만 만든다. 자산 화면의 다른 창과 같은 규칙이다 -- 숨긴 채로 붙여 두면
        열리지 않는 일이 있었다(안드로이드).
      */}
      {pickerGroup ? (
        <AccountPicker
          title={t(pickerGroup.labelKey)}
          accounts={accountsOf(pickerGroup.key)}
          ownerNameOf={ownerNameOf}
          exclusion={exclusion}
          onClose={() => setOpenGroup(null)}
        />
      ) : null}
    </View>
  );
}

/** 세 상태 체크 칸. 채운 체크 = 모두 듦, 빼기 = 일부 듦, 빈 칸 = 하나도 안 듦 (웹과 같다). */
function TriCheck({ selection, size = 'md' }: { selection: GroupSelection; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  const icon = size === 'sm' ? 10 : 14;
  return (
    <View
      className={`items-center justify-center rounded border ${box} ${
        selection === 'none' ? 'border-gray-300 bg-white' : 'border-blue-600 bg-blue-600'
      }`}
    >
      {selection === 'all' && <Check size={icon} color="#ffffff" strokeWidth={3} />}
      {selection === 'some' && <Minus size={icon} color="#ffffff" strokeWidth={3} />}
    </View>
  );
}

/**
 * 한 유형의 계좌 목록. 계좌마다 합계에 넣고 뺀다 (웹의 AccountPicker 와 같다).
 *
 * 맨 위 "전체 선택"은 세 상태다 -- 일부만 든 때 누르면 모두 넣는다. 고른 것은 곧바로
 * 위 합계와 그래프에 반영되어 따로 저장 단추가 없다.
 */
function AccountPicker({
  title,
  accounts,
  ownerNameOf,
  exclusion,
  onClose,
}: {
  title: string;
  accounts: Account[];
  ownerNameOf: (account: Account) => string | undefined;
  exclusion: AccountExclusion;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const ids = accounts.map((account) => account.id);
  const selection = exclusion.selectionOf(ids);
  const countedCount = ids.filter((id) => !exclusion.isExcluded(id)).length;

  return (
    <Modal isOpen onClose={onClose} title={title}>
      {accounts.length === 0 ? (
        <Text className="py-6 text-center text-sm text-gray-600">
          {t('assetSummary.noAccounts')}
        </Text>
      ) : (
        /* 줄이 창 끝까지 닿도록 본문 여백(p-6)을 걷어 낸다. 글은 줄 안의 px-6 이 받친다. */
        <View className="-mx-6 -my-2">
          <Text className="px-6 text-xs text-gray-500">{t('assetSummary.pickerHint')}</Text>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: selection === 'all' ? true : selection === 'some' ? 'mixed' : false,
            }}
            onPress={() => exclusion.setIncluded(ids, selection !== 'all')}
            className="mt-2 flex-row items-center gap-3 border-b border-gray-100 px-6 py-3 active:bg-gray-50"
          >
            <TriCheck selection={selection} />
            <Text className="flex-1 text-sm font-semibold text-gray-900">
              {t('assetSummary.selectAll')}
            </Text>
            <Text className="text-xs text-gray-500">
              {t('assetSummary.countIncluded', { count: countedCount, total: ids.length })}
            </Text>
          </Pressable>

          {accounts.map((account) => {
            const included = !exclusion.isExcluded(account.id);
            const amount = exclusion.countedAmountOf(account.id);
            const owner = ownerNameOf(account);
            return (
              <Pressable
                key={account.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: included }}
                onPress={() => exclusion.setIncluded([account.id], !included)}
                className="flex-row items-center gap-3 px-6 py-2.5 active:bg-gray-50"
              >
                <TriCheck selection={included ? 'all' : 'none'} />
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={1}
                    className={`text-sm ${included ? 'text-gray-900' : 'text-gray-400'}`}
                  >
                    {account.name}
                  </Text>
                  {owner ? <Text className="text-xs text-gray-500">{owner}</Text> : null}
                </View>
                {/* 표시 통화의 값이다. 빼면 위 합계가 꼭 이만큼 줄어든다 (카드 대금 포함). */}
                <Text
                  className={`text-sm ${
                    !included
                      ? 'text-gray-400 line-through'
                      : amount < 0
                        ? 'text-red-600'
                        : 'text-gray-900'
                  }`}
                >
                  {formatCurrency(amount, displayCurrency)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Modal>
  );
}
