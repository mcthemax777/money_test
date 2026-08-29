'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ExchangeRateInfo } from '@money/types';
import { apiClient } from '@/lib/api-client';
import { useTranslation, type MessageKey } from '@/lib/i18n';
import { toAmountString, toNumber } from '@/lib/money';
import { useProject } from '@/store/project';
import { clearExchangeRateCache } from '@/hooks/useExchangeRates';

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
  const { selectedProjectId } = useProject();
  const [ledgerCurrency, setLedgerCurrency] = useState('KRW');
  const [rates, setRates] = useState<ExchangeRateInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingPair, setSavingPair] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await apiClient.getExchangeRates(selectedProjectId);
      setLedgerCurrency(data.ledgerCurrency);
      setRates(data.rates ?? []);
      setDrafts({});
    } catch (err) {
      console.error('환율 조회 실패:', err);
      setError(t('exchangeRate.loadFailed'));
    }
  }, [selectedProjectId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (info: ExchangeRateInfo) => {
    const value = drafts[info.from];
    if (toNumber(value) <= 0) return;

    try {
      setSavingPair(info.from);
      setError('');
      await apiClient.setExchangeRate(
        { from: info.from, to: info.to, rate: toAmountString(value) },
        selectedProjectId,
      );
      // 거래 입력 폼이 들고 있는 캐시를 버린다. 안 버리면 폼에 옛 환율이 남는다.
      clearExchangeRateCache();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || t('exchangeRate.saveFailed'));
    } finally {
      setSavingPair(null);
    }
  };

  const reset = async (info: ExchangeRateInfo) => {
    try {
      setSavingPair(info.from);
      setError('');
      await apiClient.clearExchangeRate(info.from, info.to, selectedProjectId);
      clearExchangeRateCache();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || t('exchangeRate.resetFailed'));
    } finally {
      setSavingPair(null);
    }
  };

  if (rates.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('exchangeRate.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('exchangeRate.description')}</p>

      <div className="mt-4 space-y-2">
        {rates.map((info) => {
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
                onClick={() => save(info)}
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

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <p className="mt-3 text-xs text-gray-500">
        {t('exchangeRate.ledgerNote', { currency: ledgerCurrency })}
      </p>
    </div>
  );
}
