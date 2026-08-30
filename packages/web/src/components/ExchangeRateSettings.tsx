'use client';

import { useState } from 'react';
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
 * 프로젝트가 쓸 환율을 정한다.
 *
 * 거래 입력 화면에서는 환율을 받지 않는다. 사용자가 아는 값은 환율이 아니라
 * 실제로 빠진 금액이고, 환율은 그 둘의 비로 유도되기 때문이다. 그래서 환율을
 * 손으로 정하는 자리는 여기 하나뿐이다.
 *
 * 여기서 정한 값이 쓰이는 곳은 둘이다.
 *   - 아직 청구액을 모르는 거래(신용카드 결제)의 추정
 *   - 표시 통화로 리포트를 볼 때의 환산
 * 이미 확정된 거래의 금액은 건드리지 않는다. 그 금액은 실제로 빠진 돈이라
 * 환율을 바꾼다고 달라질 값이 아니다.
 */
export default function ExchangeRateSettings() {
  const { t } = useTranslation();
  /* 받아 오고 저장하는 일은 core 가 맡는다. 앱의 같은 칸도 이 훅을 쓴다. */
  const { ledgerCurrency, rates, savingPair, failure, save, reset } = useExchangeRateSettings();
  /** 입력 중인 값. 저장하기 전까지는 화면에만 있다. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});


  if (rates.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('exchangeRate.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('exchangeRate.description')}</p>

      <div className="mt-4 space-y-2">
        {rates.map((info: ExchangeRateInfo) => {
          const draft = drafts[info.from] ?? '';
          const isManual = info.source === 'manual';
          const isSaving = savingPair === info.from;

          return (
            <div
              key={`${info.from}-${info.to}`}
              className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg"
            >
              <span className="text-sm text-gray-700 w-28 shrink-0">
                1 {info.from} =
              </span>

              <input
                type="number"
                step="any"
                value={draft}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [info.from]: e.target.value }))}
                placeholder={info.rate}
                className="w-32 px-2 py-1 border border-gray-300 rounded text-sm text-right"
              />
              <span className="text-sm text-gray-700">{info.to}</span>

              <span
                className={`ml-auto text-xs ${isManual ? 'text-blue-600' : 'text-gray-500'}`}
              >
                {SOURCE_KEY[info.source] ? t(SOURCE_KEY[info.source]) : info.source}
                {info.date && ` · ${info.date}`}
              </span>

              <button
                type="button"
                onClick={() => save(info, draft).then(() => setDrafts({}))}
                disabled={toNumber(draft) <= 0 || isSaving}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
              >
                {t('common.save')}
              </button>

              {/* 직접 설정한 값이 있을 때만 되돌릴 것이 있다. */}
              {isManual && (
                <button
                  type="button"
                  onClick={() => reset(info)}
                  disabled={isSaving}
                  className="px-3 py-1 text-sm border rounded text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                >
                  {t('exchangeRate.reset')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {failure && <p className="mt-2 text-sm text-red-600">{t(FAILURE_KEY[failure])}</p>}

      <p className="mt-3 text-xs text-gray-500">
        {t('exchangeRate.ledgerNote', { currency: ledgerCurrency })}
      </p>
    </div>
  );
}
