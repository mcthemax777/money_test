import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ExchangeRateInfo } from '@money/types';

import { useExchangeRateSettings } from '@money/core/hooks/useExchangeRates';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { toNumber } from '@money/core/lib/money';
import { useConnectivity } from '@money/core/store/connectivity';

import Modal from './Modal';
import { SettingRow } from './SettingPicker';

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
 *
 * 설정 화면에는 지금 환율을 한 줄로만 적고, 고치는 칸은 눌러서 뜨는 팝업에 둔다.
 */
export default function ExchangeRateSettings() {
  /*
   * 환율 설정은 온라인에서만 한다.
   *
   * 이 값은 아직 청구액을 모르는 카드 결제를 추정하고 표시 통화를 환산하는 데 쓰인다.
   * 오프라인에서 바꿔 두었다가 며칠 뒤에 보내면, 그 사이에 적힌 거래들이 어떤 환율로
   * 계산된 것인지가 갈린다. 큐에 담아 두는 대신 지금 막고 이유를 말한다 (D12).
   */
  const isOffline = useConnectivity((state) => state.isOffline);

  const { t } = useTranslation();
  /* 받아 오고 저장하는 일은 core 가 맡는다. 웹의 같은 칸도 이 훅을 쓴다. */
  const { ledgerCurrency, rates, savingPair, failure, save, reset } = useExchangeRateSettings();
  /** 입력 중인 값. 저장하기 전까지는 화면에만 있다. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isOpen, setIsOpen] = useState(false);

  /* 닫으면 적다 만 값은 버린다. 다시 열었을 때 저장하지 않은 숫자가 남아 있으면 저장된 값으로 읽힌다. */
  const close = () => {
    setIsOpen(false);
    setDrafts({});
  };

  /*
   * 목록이 비었다. 쓰는 외화가 없으면 칸을 두지 않지만, **받지 못해서** 빈 것이면
   * 칸을 두고 이유를 적는다 -- 오프라인에서 칸이 통째로 사라지면 설정이 없어진 줄 안다.
   */
  if (rates.length === 0) {
    if (failure !== 'load') return null;
    return (
      <View className="rounded-lg bg-white p-6 shadow-sm">
        <Text className="text-lg font-semibold text-gray-900">{t('exchangeRate.title')}</Text>
        <Text className="mt-2 text-sm text-gray-500">
          {t(isOffline ? 'online.onlyOnline' : 'exchangeRate.loadFailed')}
        </Text>
      </View>
    );
  }

  return (
    <>
      <SettingRow
        title={t('exchangeRate.title')}
        description={t('exchangeRate.description')}
        /* 줄에는 "1 USD = 1,350" 처럼 외화마다 한 토막씩 잇는다. 길면 줄이 자른다. */
        value={rates.map((info: ExchangeRateInfo) => `${info.from} ${info.rate}`).join(' · ')}
        onPress={() => setIsOpen(true)}
      >
        {/* 팝업을 닫은 뒤에도 실패는 보여야 한다. */}
        {failure && !isOpen ? (
          <Text className="text-sm text-red-600">{t(FAILURE_KEY[failure])}</Text>
        ) : null}
      </SettingRow>

      <Modal isOpen={isOpen} onClose={close} title={t('exchangeRate.title')}>
        <Text className="text-sm text-gray-600">{t('exchangeRate.description')}</Text>

        <View className="mt-4 gap-2">
          {rates.map((info: ExchangeRateInfo) => {
            const draft = drafts[info.from] ?? '';
            const isManual = info.source === 'manual';
            const isSaving = savingPair === info.from;
            // 끊겨 있어도 저장된다 -- 사본에 곧바로 적고 명령으로 쌓는다 (환율 명령).
            const canSave = toNumber(draft) > 0 && !isSaving;

            return (
              <View
                key={`${info.from}-${info.to}`}
                className="gap-2 rounded-lg bg-gray-50 px-3 py-2"
              >
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
      </Modal>
    </>
  );
}
