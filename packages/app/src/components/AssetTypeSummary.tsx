import { useMemo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ReportDto } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';
import { formatAmountWithUnit, formatCurrency } from '@money/core/lib/money';
import { ASSET_TYPE_GROUPS, assetGroupAmount } from '@money/core/lib/net-worth';
import { useAssetTypeFilter } from '@money/core/store/asset-type-filter';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/**
 * 첫 줄 인사와 유형별 소계. 웹의 AssetTypeSummary 와 같다.
 *
 * "○○님의 자산은 1억 2,345만 원입니다"로 시작한다. 카드를 눌러 끄면 그 유형을 뺀
 * 금액이 문장에 나온다. 어느 것을 켜 뒀는지는 기기에 남는다.
 */
export default function AssetTypeSummary({
  byType,
  scopeTitle,
  hasNoScope,
}: {
  byType: ReportDto.NetWorthByType | undefined;
  /** 문장 앞머리에 들어가는 자산주인 제목. 이 화면의 제목을 겸한다. */
  scopeTitle: ReactNode;
  /** 자산주인을 하나도 고르지 않았는지. 그때는 금액 대신 그 사실을 적는다. */
  hasNoScope: boolean;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const { selectedKeys, toggleKey } = useAssetTypeFilter();

  /* 켜 둔 유형의 합과 그 이름. 화면에 늘어놓은 차례를 그대로 따른다. */
  const { total, label } = useMemo(() => {
    const selected = ASSET_TYPE_GROUPS.filter((group) => selectedKeys.includes(group.key));
    return {
      total: selected.reduce((acc, group) => acc + assetGroupAmount(byType, group.types), 0),
      label: selected.map((group) => t(group.labelKey)).join(', '),
    };
  }, [byType, selectedKeys, t]);

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
          <Text className="mt-1 text-4xl font-bold text-gray-900">
            {/* 문장으로 읽히는 자리라 기호 대신 이름을 뒤에 붙인다. */}
            {formatAmountWithUnit(total, displayCurrency)}
            <Text className="text-xl font-medium text-gray-500"> {t('assetSummary.suffix')}</Text>
          </Text>
        )}

        {/* 무엇을 더한 금액인지. 카드를 끄면 이 줄도 함께 줄어든다. */}
        <Text className="mt-1 text-sm text-gray-500">{label || t('assetSummary.noType')}</Text>
      </View>

      {/*
        유형 넷. 눌러서 위 금액에서 빼고 더한다.
        넷이 한눈에 들어와야 해서 좁은 화면에서는 두 줄로 접는다.
      */}
      <View className="flex-row flex-wrap">
        {ASSET_TYPE_GROUPS.map((group) => {
          const amount = assetGroupAmount(byType, group.types);
          const isSelected = selectedKeys.includes(group.key);

          return (
            <View key={group.key} className="w-1/2 p-1 sm:w-1/4">
              <Pressable
                onPress={() => toggleKey(group.key)}
                /* 고른 표시는 가계의 분류별 목록과 같은 파란 바탕이다. */
                className={`rounded-lg border p-3 ${
                  isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <View className="flex-row items-center gap-1.5">
                  {/* 켜 둔 것을 색으로도 알린다. */}
                  <View
                    className={`h-1.5 w-1.5 rounded-full ${
                      isSelected ? 'bg-blue-500' : 'bg-gray-300'
                    }`}
                  />
                  <Text numberOfLines={1} className="text-xs text-gray-600">
                    {t(group.labelKey)}
                  </Text>
                </View>
                <Text
                  className={`mt-1 text-base font-semibold ${
                    amount < 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {formatCurrency(amount, displayCurrency)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
