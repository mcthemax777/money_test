import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ExchangeRateInfo } from '@money/types';

import { useExchangeRateSettings } from '@money/core/hooks/useExchangeRates';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { toNumber } from '@money/core/lib/money';

/** 무엇을 하다 실패했는지에 따른 문구. */
const FAILURE_KEY = {
  load: 'exchangeRate.loadFailed',
  save: 'exchangeRate.saveFailed',
  reset: 'exchangeRate.resetFailed',
} as const;

/** 어디서 온 환율인지. 사용자가 정한 값과 서버 기본값을 구분해 보여 준다. */
const SOURCE_KEY: Record<string, MessageKey> = {
  manual: 'exchangeRate.source.manual',
  fallback: 'exchangeRate.source.fallback',
  identity: 'exchangeRate.source.identity',
};

/**
 * 프로젝트가 쓸 환율을 정한다. 웹의 ExchangeRateSettings 와 같다.
 *
 * 환율을 손으로 정하는 자리는 여기 하나뿐이다. 거래 입력에서는 실제로 빠진 금액만
 * 받고 환율은 그 둘의 비로 유도한다. 여기서 정한 값은 아직 청구액을 모르는 거래의
 * 추정과 표시 통화 환산에만 쓰이고, 이미 확정된 거래의 금액은 건드리지 않는다.
 */
export default function ExchangeRateSettings() {
  const { t } = useTranslation();
  /* 받아 오고 저장하는 일은 core 가 맡는다. 웹의 같은 칸도 이 훅을 쓴다. */
  const { ledgerCurrency, rates, savingPair, failure, save, reset } = useExchangeRateSettings();
  /** 입력 중인 값. 저장하기 전까지는 화면에만 있다. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (rates.length === 0) return null;

  return (
    <View className="rounded-lg bg-white p-6 shadow-sm">
      <Text className="text-lg font-semibold text-gray-900">{t('exchangeRate.title')}</Text>
      <Text className="mt-1 text-sm text-gray-600">{t('exchangeRate.description')}</Text>

      <View className="mt-4 gap-2">
        {rates.map((info: ExchangeRateInfo) => {
          const draft = drafts[info.from] ?? '';
          const isManual = info.source === 'manual';
          const isSaving = savingPair === info.from;
          const canSave = toNumber(draft) > 0 && !isSaving;

          return (
            <View key={`${info.from}-${info.to}`} className="gap-2 rounded-lg bg-gray-50 px-3 py-2">
              <View className="flex-row items-center gap-2">
                <Text className="w-28 shrink-0 text-sm text-gray-700">1 {info.from} =</Text>
                <TextInput
                  value={draft}
                  onChangeText={(value) => setDrafts((prev) => ({ ...prev, [info.from]: value }))}
                  placeholder={info.rate}
                  keyboardType="decimal-pad"
                  className="w-32 rounded border border-gray-300 px-2 py-1 text-right text-sm text-gray-900"
                />
                <Text className="text-sm text-gray-700">{info.to}</Text>
              </View>

              <View className="flex-row items-center gap-2">
                <Text className={`text-xs ${isManual ? 'text-blue-600' : 'text-gray-500'}`}>
                  {SOURCE_KEY[info.source] ? t(SOURCE_KEY[info.source]) : info.source}
                  {info.date ? ` · ${info.date}` : ''}
                </Text>

                <View className="ml-auto flex-row gap-2">
                  <Pressable
                    onPress={() => save(info, draft).then(() => setDrafts({}))}
                    disabled={!canSave}
                    className={`rounded bg-blue-600 px-3 py-1 ${canSave ? 'active:bg-blue-700' : 'opacity-40'}`}
                  >
                    <Text className="text-sm text-white">{t('common.save')}</Text>
                  </Pressable>

                  {/* 직접 설정한 값이 있을 때만 되돌릴 것이 있다. */}
                  {isManual ? (
                    <Pressable
                      onPress={() => reset(info)}
                      disabled={isSaving}
                      className={`rounded border border-gray-300 px-3 py-1 ${
                        isSaving ? 'opacity-40' : ''
                      }`}
                    >
                      <Text className="text-sm text-gray-700">{t('exchangeRate.reset')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {failure ? (
        <Text className="mt-2 text-sm text-red-600">{t(FAILURE_KEY[failure])}</Text>
      ) : null}

      <Text className="mt-3 text-xs text-gray-500">
        {t('exchangeRate.ledgerNote', { currency: ledgerCurrency })}
      </Text>
    </View>
  );
}
