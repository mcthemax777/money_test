/**
 * 반복 등록. 정해 둔 날마다 보관함에 후보를 만드는 규칙의 목록과 손질.
 *
 * **읽기는 `homeDataPort`, 쓰기는 `settingsWritePort` 를 거친다.** 앱은 기기 사본에서
 * 읽고 쓰므로 끊긴 동안에도 만들고 고치고 지운다 (명령은 연결이 돌아오면 간다).
 *
 * **밀린 회차는 서버가 만든다** (정각마다, 그리고 규칙을 저장할 때). 끊긴 동안 저장한
 * 반복의 후보는 명령이 닿은 뒤 pull 로 내려온다. 기기가 만드는 것은 주기 없는 반복의
 * "만들기"(`makeNow`) 하나다.
 */
import { useCallback, useEffect, useState } from 'react';
import type { RecurringRuleDto } from '@money/types';

import { useApiError } from '../lib/api-error';
import { draftPort } from '../data/draft-port';
import { homeDataPort } from '../data/home-port';
import { settingsWritePort } from '../data/settings-write-port';
import { useLoadedKey } from './useLoadedKey';
import { useMirrorVersion } from './useMirrorVersion';
import { manualDraftItem } from '../lib/recurring-drafts';
import { useProjectTimeZone } from '../store/project';

export interface UseRecurringRulesResult {
  rules: RecurringRuleDto.Response[];
  isLoading: boolean;
  /** 읽거나 저장하다 난 오류. 빈 글자면 아무 일도 없었다. */
  error: string;
  reload: () => Promise<void>;
  save: (
    rule: RecurringRuleDto.CreateRequest | (RecurringRuleDto.UpdateRequest & { id: string }),
  ) => Promise<boolean>;
  toggle: (id: string, isActive: boolean) => Promise<boolean>;
  /**
   * 지금 바로 후보 하나를 만든다. **주기 없는 반복**의 "만들기" 가 부른다.
   *
   * 날짜와 시각은 **누른 그 순간**이다(프로젝트 타임존). 여러 번 눌러도 그때마다
   * 하나가 생긴다 -- 열쇠 뒤에 그 누름을 가리키는 표가 붙어 날짜가 같아도 겹치지 않는다.
   */
  makeNow: (rule: RecurringRuleDto.Response) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function useRecurringRules(projectId: string | null): UseRecurringRulesResult {
  const { messageOf } = useApiError();
  const timeZone = useProjectTimeZone();
  const [rules, setRules] = useState<RecurringRuleDto.Response[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  // 사본이 바뀌면(pull·다른 화면의 저장) 다시 읽는다. 다음 예정일이 옮겨 갔을 수 있다.
  const mirrorVersion = useMirrorVersion();

  // 같은 가계부를 다시 읽을 때는 목록을 가리지 않는다 (useLoadedKey 주석).
  const loaded = useLoadedKey();

  const reload = useCallback(async () => {
    if (!projectId) {
      loaded.mark(null);
      setRules([]);
      setIsLoading(false);
      return;
    }

    const isRefresh = loaded.has(projectId);
    try {
      if (!isRefresh) setIsLoading(true);
      const rows = await homeDataPort().getRecurringRules(projectId);
      setRules(rows);
      setError('');
      loaded.mark(projectId);
    } catch (caught) {
      if (isRefresh) {
        // 그려 둔 규칙은 여전히 이 가계부의 것이다. 다음 신호에 다시 읽는다.
        console.error('반복 규칙 다시 읽기 실패:', caught);
        return;
      }
      setRules([]);
      setError(messageOf(caught, 'inbox.loadFailed', 'online.viewOnlyOnline'));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrorVersion 은 다시 읽는 신호다
  }, [projectId, messageOf, mirrorVersion, loaded]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 만들거나 고친다. `id` 가 있으면 고치기다. */
  const save = useCallback(
    async (
      rule: RecurringRuleDto.CreateRequest | (RecurringRuleDto.UpdateRequest & { id: string }),
    ): Promise<boolean> => {
      if (!projectId) return false;

      try {
        if ('id' in rule && rule.id) {
          const { id, ...patch } = rule;
          await settingsWritePort().updateRecurringRule(id, patch);
        } else {
          await settingsWritePort().createRecurringRule(
            rule as RecurringRuleDto.CreateRequest,
            projectId,
          );
        }
        // 다음 예정일이 옮겨 갔으니 다시 읽는다 (온라인이면 밀린 회차도 서버가 만들었다).
        await reload();
        return true;
      } catch (caught) {
        setError(messageOf(caught, 'inbox.actionFailed'));
        return false;
      }
    },
    [projectId, reload, messageOf],
  );

  const toggle = useCallback(
    async (id: string, isActive: boolean): Promise<boolean> => {
      try {
        await settingsWritePort().updateRecurringRule(id, { isActive });
        await reload();
        return true;
      } catch (caught) {
        setError(messageOf(caught, 'inbox.actionFailed'));
        return false;
      }
    },
    [reload, messageOf],
  );

  const makeNow = useCallback(
    async (rule: RecurringRuleDto.Response): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const item = manualDraftItem(rule, timeZone);
        const result = await draftPort().add(projectId, [item]);
        /*
         * 담겼을 때만 true. 화면이 이 값을 보고 "1건을 만들었습니다"를 적는다. 0 이면
         * 무언가 겹친 것이라 그 말을 하지 않아야 한다 -- 열쇠에 표가 붙으므로 여기서 0 이
         * 나오는 일은 사실상 없지만, 없다고 단정하고 적으면 틀린 말이 남는다.
         */
        setError('');
        return result.created > 0;
      } catch (caught) {
        setError(messageOf(caught, 'inbox.actionFailed'));
        return false;
      }
    },
    [projectId, timeZone, messageOf],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await settingsWritePort().removeRecurringRule(id);
        setRules((previous) => previous.filter((rule) => rule.id !== id));
        setError('');
        return true;
      } catch (caught) {
        setError(messageOf(caught, 'inbox.actionFailed'));
        return false;
      }
    },
    [messageOf],
  );

  return { rules, isLoading, error, reload, save, toggle, makeNow, remove };
}
