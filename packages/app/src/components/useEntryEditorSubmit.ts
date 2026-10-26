/*
 * 거래 입력의 저장과 지우기. 지출과 함께 적은 페이백까지 이어 저장하고, 두 번 눌러도 한 번만 나가게 막는다.
 *
 * 거래 입력(EntryEditor)에서 떼어 냈다 (2026-10-26).
 */
import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { EntryListItem } from '@money/types';

import type { useTranslation } from '@money/core/lib/i18n';
import type { useEntryForm } from '@money/core/hooks/useEntryForm';
import type { usePaybackDrafts } from '@money/core/hooks/usePaybackDrafts';
import { paybackCountOf, paybackDeleteNote } from '@money/core/hooks/usePaybacks';

type PaybackLines = Parameters<ReturnType<typeof usePaybackDrafts>['check']>[0];

export function useEntryEditorSubmit({
  form,
  paybackDrafts,
  paybackLines,
  setPaybackError,
  editing,
  projectId,
  onClose,
  t,
}: {
  form: ReturnType<typeof useEntryForm>;
  paybackDrafts: ReturnType<typeof usePaybackDrafts>;
  /** 함께 적는 페이백이 고를 원거래의 줄. 지출에만 있다. */
  paybackLines: PaybackLines;
  /** 함께 적은 페이백을 저장하다 난 오류를 화면에 올린다. */
  setPaybackError: (message: string) => void;
  editing?: EntryListItem | null;
  projectId: string | null;
  onClose: () => void;
  /** 부르는 쪽의 번역. 훅을 하나 더 걸지 않으려고 받아 쓴다. */
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const { values } = form;

  /*
   * 저장. 지출과 함께 적은 페이백은 지출이 저장된 뒤에 건다.
   *
   * 페이백을 저장하다 실패하면 창을 닫지 않는다. 지출은 이미 저장되었고 폼은 그 지출을
   * 고치는 폼이 되어 있다(useEntryForm.save) -- 다시 누르면 남은 페이백만 저장한다.
   */
  /*
   * 저장·지우기가 나가 있는가 (2026-10-16).
   *
   * form.isSubmitting 은 지출 저장이 끝나면 풀리는데, 그 뒤에 페이백 저장이 이어진다. 그 사이 다시
   * 누르면 같은 페이백을 또 만든다. 상태는 다시 그린 뒤에야 단추를 막으므로 곧바로 바뀌는 ref 로도
   * 막는다. 지우기는 확인 창을 띄우기 전에 페이백 수를 세느라 기다리므로, 두 번 누르면 창이 둘 뜬다.
   */
  const busyRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const isBusy = form.isSubmitting || isSaving;

  const save = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsSaving(true);
    try {
      await saveAll();
    } finally {
      busyRef.current = false;
      setIsSaving(false);
    }
  };

  const saveAll = async () => {
    setPaybackError('');
    if (values.kind === 'expense') {
      const found = paybackDrafts.check(paybackLines);
      if (found) {
        setPaybackError(found);
        return;
      }
    }
    const savedId = await form.save();
    if (!savedId) return;
    if (values.kind === 'expense' && paybackDrafts.drafts.length > 0) {
      const result = await paybackDrafts.saveFor({
        id: savedId,
        personId: values.personId,
        description: values.description.trim(),
        lines: paybackLines,
      });
      if (result.error) {
        setPaybackError(result.error);
        return;
      }
    }
    onClose();
  };

  /**
   * 지우기 전에 한 번 묻는다.
   *
   * 웹도 같은 자리에서 묻는다(web 의 EntryEditor). 앱에서는 더 필요하다. 손가락이
   * 닿는 버튼이고, 되돌리는 길이 없으며, 오프라인이면 툼스톤이 먼저 나가 다음 동기화
   * 에서 서버의 거래까지 지운다. 문구는 계좌·카드가 쓰는 것을 함께 쓴다.
   */
  const remove = async () => {
    if (busyRef.current) return;
    // 원거래면 걸린 환불·페이백도 함께 지워진다. 그 수를 함께 묻는다 (7-6).
    busyRef.current = true;
    let note = '';
    try {
      note = editing ? paybackDeleteNote(await paybackCountOf(editing, projectId), t) : '';
    } finally {
      busyRef.current = false;
    }
    Alert.alert(t('account.deleteConfirm'), note, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('entryForm.delete'),
        style: 'destructive',
        onPress: () => {
          void form.remove().then((done) => {
            if (done) onClose();
          });
        },
      },
    ]);
  };

  return { isBusy, save, remove };
}
