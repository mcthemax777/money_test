/**
 * 거래를 적다가 그 자리에서 만드는 것들 -- 구성원·통장·카드·분류·태그.
 *
 * 거래 폼은 있는 것 중에서 고르는 자리다. 그런데 적으려는 순간에야 "이 카드가 아직
 * 없다"를 알게 되는 일이 잦고, 그때 폼을 닫고 자산 화면으로 건너가 만들고 돌아오면
 * 적던 내용이 사라진다. 그래서 고르는 칸마다 만드는 길을 붙인다.
 *
 * **만들고 나서 그 값을 바로 고르는 것이 요점이다.** 그러려면 만들어진 id 가 필요한데,
 * 자산 화면의 `useAssetsData` 는 목록을 통째로 다시 읽고 ok 만 돌려준다(총자산까지 함께
 * 움직이는 화면이라 그쪽은 그것이 맞다). 여기서는 창구가 주는 id 를 그대로 넘긴다.
 *
 * 창구(`settings-write-port`)를 거치므로 웹은 서버로 곧바로 가고 앱은 사본에 먼저
 * 커밋한 뒤 명령을 쌓는다 -- 오프라인에서도 만들 수 있다 (설계 문서의 D3).
 */
import { useCallback, useState } from 'react';
import type { AccountDto, CardDto, CategoryDto, PersonDto, TagDto } from '@money/types';

import { settingsWritePort } from '../data/settings-write-port';
import { useApiError } from '../lib/api-error';
import type { MessageKey } from '../lib/i18n';
import type { AssetSaveResult } from './useAssetsData';

/** 만들기의 결과. 성공하면 만들어진 것의 id 가 함께 온다. */
export interface QuickAddResult extends AssetSaveResult {
  /** 폼이 곧바로 고르는 데 쓴다. 실패하면 없다. */
  id?: string;
}

export function useQuickAdd(projectId?: string | null) {
  const { messageOf } = useApiError();
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * 하나를 만든다. 실패를 던지지 않고 폼이 적을 문구로 돌려준다.
   *
   * 창을 닫는 일은 부르는 쪽이 한다 -- 실패했으면 적던 것을 그대로 둔 채 그 자리에
   * 이유만 적어야 한다.
   */
  const run = useCallback(
    async (
      make: () => Promise<{ id: string }>,
      fallbackKey: MessageKey,
    ): Promise<QuickAddResult> => {
      try {
        setIsSubmitting(true);
        const { id } = await make();
        return { ok: true, id };
      } catch (error) {
        return { ok: false, message: messageOf(error, fallbackKey) };
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageOf],
  );

  /** 프로젝트를 함께 실어 보낸다. 고른 가계부가 없으면 서버가 기본 가계부로 본다. */
  const withProject = <T extends object>(input: T) => ({
    ...input,
    ...(projectId ? { projectId } : {}),
  });

  return {
    isSubmitting,

    addPerson: useCallback(
      (input: Omit<PersonDto.CreateRequest, 'projectId'>) =>
        run(() => settingsWritePort().addPerson(withProject(input)), 'person.addFailed'),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [run, projectId],
    ),

    addAccount: useCallback(
      (input: Omit<AccountDto.CreateRequest, 'projectId'>) =>
        run(() => settingsWritePort().addAccount(withProject(input)), 'account.addFailed'),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [run, projectId],
    ),

    addCard: useCallback(
      (input: Omit<CardDto.CreateRequest, 'projectId'>) =>
        run(() => settingsWritePort().addCard(withProject(input)), 'card.addFailed'),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [run, projectId],
    ),

    /** 대분류든 소분류든 한 줄이다. `parentId` 가 있으면 그 아래에 붙는다. */
    addCategory: useCallback(
      (input: Omit<CategoryDto.CreateRequest, 'projectId'>) =>
        run(() => settingsWritePort().addCategory(withProject(input)), 'categories.addFailed'),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [run, projectId],
    ),

    addTag: useCallback(
      (input: Omit<TagDto.CreateRequest, 'projectId'>) =>
        run(() => settingsWritePort().addTag(withProject(input)), 'tags.saveFailed'),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [run, projectId],
    ),
  };
}

export type QuickAdd = ReturnType<typeof useQuickAdd>;
