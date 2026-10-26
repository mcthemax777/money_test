'use client';

/*
 * 할부 칸. 개월수, 수수료가 붙는지, 회차 원금, 유이자면 이자를 정하는 방식과 회차 이자.
 *
 * 신용카드 지출에만 뜬다(부르는 쪽의 canInstall). 체크카드는 결제 즉시 통장에서 빠지고
 * 통장에는 갚을 빚이 없어 나눌 청구가 없다 (서버도 같은 규칙으로 막는다).
 */
import { useTranslation } from '@money/core/lib/i18n';
import { installmentShareTotal, type InstallmentInterestMode } from '@money/core/lib/period-ledger';
import { INSTALLMENT_MAX_MONTHS } from '@money/types';
import type { EntryFormValues, SetEntryForm } from './editor-form';

export default function InstallmentFields({
  formData,
  setFormData,
  installmentBase,
  shareInputs,
  interestInputs,
}: {
  formData: EntryFormValues;
  setFormData: SetEntryForm;
  /** 할부가 나누는 금액 (금액 − 차감). */
  installmentBase: string;
  /** 회차 원금 칸에 보일 값. 적어 둔 것이 없으면 개월수로 나눈 기본값이다. */
  shareInputs: string[];
  /** 회차 이자 칸에 보일 값. 고른 방식으로 계산한 기본값이고, 고치면 그 값이 남는다. */
  interestInputs: string[];
}) {
  const { t } = useTranslation();

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.installment')}</label>
      {/*
        개월수는 직접 적는다 -- 2개월부터 50개월까지 (2026-10-10 사용자 요청). 비우면 일시불이다.
      */}
      <input
        type="number"
        inputMode="numeric"
        min={2}
        max={INSTALLMENT_MAX_MONTHS}
        step={1}
        value={formData.installmentMonths}
        onChange={(e) => {
          const value = e.target.value;
          setFormData({
            ...formData,
            installmentMonths: value,
            // 일시불로 되돌리면 고른 종류도 함께 떨어진다.
            installmentInterest: Number(value) >= 2 ? formData.installmentInterest : '',
            // 개월수가 바뀌면 적어 둔 회차 금액은 개수가 맞지 않는다.
            installmentShares: [],
            installmentInterestShares: [],
            /*
             * 월 납입액도 함께 비운다. **개월수와 한 쌍인 값**이라서다 --
             * "10,000원을 3개월, 매달 4,000원"의 4,000원은 3개월일 때의
             * 사실이고, 6개월로 바꾸면 그 값으로는 표가 풀리지 않는다.
             * 그대로 두면 저장할 때 "매달 내는 금액 x 개월수가 결제 금액보다
             * 적습니다"로 막혀, 어디를 고쳐야 하는지 알 수 없다.
             *
             * 연이율은 개월수와 무관해 그대로 둔다.
             */
            installmentMonthlyPayment: '',
          });
        }}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder={t('editor.installmentMonthsInput')}
      />
      <p className="mt-1 text-xs text-gray-500">{t('editor.installmentHint')}</p>

      {/*
        수수료가 붙는 할부인가. 개월수를 고른 뒤에만 묻는다.

        기본값을 두지 않는다. 무이자로 두면 유이자 할부가 조용히 수수료 없이
        지나가고, 유이자로 두면 무이자 결제마다 "수수료 미입력"이 쌓인다.
      */}
      {Number(formData.installmentMonths) >= 2 && (
        <div className="mt-2">
          <div className="flex gap-2">
            {(['free', 'interest'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() =>
                  setFormData({
                    ...formData,
                    installmentInterest: choice,
                    /*
                     * 무이자로 되돌리면 이자 쪽을 통째로 비운다. 남겨 두면
                     * 수수료가 없는 할부에 이자가 붙어 보이고, 회차 기준으로
                     * 볼 때 그 달 지출이 실제보다 커진다.
                     */
                    ...(choice === 'interest'
                      ? {}
                      : {
                          installmentInterestMode: '' as InstallmentInterestMode,
                          installmentMonthlyPayment: '',
                          installmentAnnualRate: '',
                          installmentInterestShares: [],
                        }),
                  })
                }
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                  formData.installmentInterest === choice
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700'
                }`}
              >
                {t(choice === 'free' ? 'editor.installmentFree' : 'editor.installmentInterest')}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {t(
              formData.installmentInterest === 'interest'
                ? 'editor.installmentInterestHint'
                : 'editor.installmentFreeHint',
            )}
          </p>

          {/*
            회차 금액. 기본값을 채워 두고 다른 자리만 고치게 한다.

            끝수를 어느 회차에 붙이는지가 카드사마다 다르다 -- 1,000원
            3개월이 334/333/333 일 수도 334/334/332 일 수도 있어, 계산만으로는
            명세서와 맞출 수 없다.
          */}
          <div className="mt-3 space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-gray-700">{t('editor.installmentShares')}</span>
              {formData.installmentShares.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, installmentShares: [] })}
                  className="text-xs text-blue-600"
                >
                  {t('editor.installmentSharesReset')}
                </button>
              )}
            </div>

            {shareInputs.map((share, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-16 text-xs text-gray-500">
                  {t('editor.installmentShareRow', { index: index + 1 })}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={share}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      installmentShares: shareInputs.map((old, at) => (at === index ? e.target.value : old)),
                    })
                  }
                  className="flex-1 px-2 py-1 border rounded text-sm text-right"
                />
              </div>
            ))}

            <p className="text-right text-xs text-gray-500">
              {t('editor.installmentSharesSum', {
                total: installmentShareTotal(shareInputs),
                amount: installmentBase || '0',
              })}
            </p>
            <p className="text-xs text-gray-500">{t('editor.installmentSharesHint')}</p>
          </div>

          {/*
            이자. 유이자 할부에만 묻는다.

            카드사가 정하는 방식이 둘이다. 매달 같은 금액을 내는 할부는 낸
            돈에서 이자를 먼저 떼어 앞 회차일수록 이자가 크고, 연이율만
            정해진 할부는 남은 원금에 매달 이자가 붙어 뒤로 갈수록 가볍다.
            어느 쪽도 아니면 빈 칸으로 두고 명세서를 보고 적는다.
          */}
          {formData.installmentInterest === 'interest' && (
            <div className="mt-3 space-y-1">
              <span className="text-xs font-medium text-gray-700">{t('editor.installmentInterestMode')}</span>
              <div className="flex gap-2">
                {(['fixed', 'rate', ''] as const).map((mode) => (
                  <button
                    key={mode || 'manual'}
                    type="button"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        installmentInterestMode: mode,
                        // 방식을 바꾸면 계산이 다시 채운다. 고친 값은 그 방식의 것이다.
                        installmentInterestShares: [],
                      })
                    }
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                      formData.installmentInterestMode === mode
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    {t(
                      mode === 'fixed'
                        ? 'editor.installmentModeFixed'
                        : mode === 'rate'
                          ? 'editor.installmentModeRate'
                          : 'editor.installmentModeManual',
                    )}
                  </button>
                ))}
              </div>

              {formData.installmentInterestMode === 'fixed' && (
                <>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.installmentMonthlyPayment}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        installmentMonthlyPayment: e.target.value,
                        installmentInterestShares: [],
                      })
                    }
                    placeholder={t('editor.installmentMonthlyPayment')}
                    className="w-full px-2 py-1 border rounded text-sm text-right"
                  />
                  <p className="text-xs text-gray-500">{t('editor.installmentMonthlyPaymentHint')}</p>
                </>
              )}

              {formData.installmentInterestMode === 'rate' && (
                <>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.installmentAnnualRate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        installmentAnnualRate: e.target.value,
                        installmentInterestShares: [],
                      })
                    }
                    placeholder={t('editor.installmentAnnualRate')}
                    className="w-full px-2 py-1 border rounded text-sm text-right"
                  />
                  <p className="text-xs text-gray-500">{t('editor.installmentAnnualRateHint')}</p>
                </>
              )}

              <div className="flex items-baseline justify-between pt-2">
                <span className="text-xs font-medium text-gray-700">
                  {t('editor.installmentInterestShares')}
                </span>
                {formData.installmentInterestShares.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, installmentInterestShares: [] })}
                    className="text-xs text-blue-600"
                  >
                    {t('editor.installmentInterestReset')}
                  </button>
                )}
              </div>

              {interestInputs.map((interest, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-20 text-xs text-gray-500">
                    {t('editor.installmentInterestRow', { index: index + 1 })}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={interest}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        installmentInterestShares: interestInputs.map((old, at) =>
                          at === index ? e.target.value : old,
                        ),
                      })
                    }
                    className="flex-1 px-2 py-1 border rounded text-sm text-right"
                  />
                </div>
              ))}

              <p className="text-right text-xs text-gray-500">
                {t('editor.installmentInterestTotal', {
                  total: installmentShareTotal(interestInputs),
                })}
              </p>
              {/*
                카드에 갚을 돈. 이자가 금액에 더해져 거래에 적힌다.

                금액 칸은 산 값 그대로 두고 여기서만 밝힌다 -- 사용자가 적은
                숫자를 화면이 말없이 올리면 무엇을 저장하는지 알 수 없다.
              */}
              <p className="text-right text-xs font-medium text-gray-700">
                {t('editor.installmentTotalDue', {
                  total: installmentShareTotal([installmentBase || '0', installmentShareTotal(interestInputs)]),
                  amount: installmentBase || '0',
                })}
              </p>
              <p className="text-xs text-gray-500">{t('editor.installmentInterestSharesHint')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
