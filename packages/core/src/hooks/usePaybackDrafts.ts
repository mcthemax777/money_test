/**
 * 거래 폼에서 함께 적는 페이백의 상태와 저장 (규칙은 lib/payback-drafts).
 *
 * 웹과 앱의 거래 편집기가 함께 쓴다. 두 편집기는 폼 상태를 서로 다르게 들고 있어서, 이
 * 훅은 원거래의 값(id·사람·설명·줄)을 저장하는 순간에 받는다.
 */
import { useCallback, useState } from 'react';
import { entryWritePort } from '../data/entry-write-port';
import { useApiError, apiErrorCode } from '../lib/api-error';
import { useTranslation } from '../lib/i18n';
import {
  checkPaybackDrafts,
  filledDrafts,
  newPaybackDraft,
  paybackDraftRequest,
  type PaybackDraft,
  type PaybackDraftViolation,
  type PaybackLine,
} from '../lib/payback-drafts';
import { ENTRY_FORM_VIOLATION_KEY } from '../lib/entry-form-messages';

export function usePaybackDrafts(timeZone: string) {
  const [drafts, setDrafts] = useState<PaybackDraft[]>([]);
  const [violation, setViolation] = useState<PaybackDraftViolation | null>(null);
  const { messageOf } = useApiError();
  const { t } = useTranslation();

  const add = useCallback(
    (defaults: { method: string; lineKey?: string }) => {
      setDrafts((previous) => [...previous, newPaybackDraft(timeZone, defaults)]);
    },
    [timeZone],
  );

  const update = useCallback((key: string, patch: Partial<Omit<PaybackDraft, 'key'>>) => {
    setDrafts((previous) => previous.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
    setViolation(null);
  }, []);

  const remove = useCallback((key: string) => {
    setDrafts((previous) => previous.filter((draft) => draft.key !== key));
    setViolation(null);
  }, []);

  /** 폼을 새로 열 때. 남은 초안은 다른 거래의 것이다. */
  const reset = useCallback(() => {
    setDrafts([]);
    setViolation(null);
  }, []);

  /**
   * 지출을 저장하기 **전에** 부른다. 막을 것이 있으면 그 문구를, 없으면 빈 글자를 준다.
   */
  const check = useCallback(
    (lines: readonly PaybackLine[]): string => {
      const found = checkPaybackDrafts(drafts, lines);
      setViolation(found);
      if (!found) return '';
      const key = ENTRY_FORM_VIOLATION_KEY[found.code];
      return key ? t(key) : found.code;
    },
    [drafts, t],
  );

  /**
   * 지출을 저장한 **뒤에** 부른다. 적어 둔 것을 하나씩 저장하고, 저장한 것은 목록에서 뺀다.
   *
   * 실패하면 남은 것을 그대로 두고 그 까닭을 돌려준다. 지출은 이미 저장되었으므로 부르는
   * 쪽은 창을 닫지 않고 알린다 -- 다시 누르면 남은 것만 다시 저장한다.
   */
  const saveFor = useCallback(
    async (original: {
      id: string;
      personId: string | null;
      description: string;
      lines: readonly PaybackLine[];
    }): Promise<{ saved: number; error: string }> => {
      let saved = 0;
      for (const draft of filledDrafts(drafts)) {
        try {
          await entryWritePort().createEntry(paybackDraftRequest(draft, original, timeZone));
          saved += 1;
          setDrafts((previous) => previous.filter((row) => row.key !== draft.key));
        } catch (caught) {
          const reason = apiErrorCode(caught)
            ? messageOf(caught, 'payback.saveFailed')
            : caught instanceof Error
              ? caught.message
              : String(caught);
          return { saved, error: t('payback.partialSaved', { reason }) };
        }
      }
      // 금액을 적지 않은 줄은 저장하지 않고 치운다.
      setDrafts([]);
      return { saved, error: '' };
    },
    [drafts, messageOf, t, timeZone],
  );

  return { drafts, violation, add, update, remove, reset, check, saveFor };
}
