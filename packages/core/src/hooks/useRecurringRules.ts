/**
 * 반복 등록. 정해 둔 날마다 보관함에 후보를 만드는 규칙의 목록과 손질.
 *
 * **서버에서 곧바로 읽고 쓴다.** 다른 목록과 달리 기기 사본에 두지 않는데, 반복은 한 번
 * 만들어 두고 몇 달을 그대로 쓰는 설정이라 오프라인에서 고칠 일이 드물기 때문이다.
 * 그렇게 만들어진 **후보는** 여느 후보와 같이 사본으로 내려오므로, 연결이 없어도
 * 보관함의 목록과 등록은 그대로 된다.
 *
 * 목록을 읽은 뒤 **밀린 회차를 여기서 만든다.** 규칙에서 날을 셈해(`recurringDraftItems`)
 * 알림·캡처 후보와 같은 창구로 담는다(`draftPort().add`). 사용자가 보관함을 여는 순간이
 * 가장 자연스러운 자리이고, 서버에 정기 작업을 걸어 두지 않아도 이것만으로 반복이 돈다.
 *
 * 몇 번을 열어도 후보가 늘지 않는다 -- 같은 회차는 중복 열쇠에 걸려 한 번만 담긴다.
 */
import { useCallback, useEffect, useState } from 'react';
import type { RecurringRuleDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { draftPort } from '../data/draft-port';
import { recurringDraftItems } from '../lib/recurring-drafts';
import { todayKey } from '../lib/datetime';
import { useProjectTimeZone } from '../store/project';

export interface UseRecurringRulesResult {
  rules: RecurringRuleDto.Response[];
  isLoading: boolean;
  /** 읽거나 저장하다 난 오류. 빈 글자면 아무 일도 없었다. */
  error: string;
  /** 방금 만들어진 후보 수. 화면이 "n건이 만들어졌습니다"로 적는다. */
  created: number;
  reload: () => Promise<void>;
  save: (
    rule: RecurringRuleDto.CreateRequest | (RecurringRuleDto.UpdateRequest & { id: string }),
  ) => Promise<boolean>;
  toggle: (id: string, isActive: boolean) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function useRecurringRules(projectId: string | null): UseRecurringRulesResult {
  const { messageOf } = useApiError();
  const timeZone = useProjectTimeZone();
  const [rules, setRules] = useState<RecurringRuleDto.Response[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(0);

  const reload = useCallback(async () => {
    if (!projectId) {
      setRules([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const rows = await apiClient.getRecurringRules(projectId);
      setRules(rows);
      setError('');

      const items = recurringDraftItems(rows, todayKey(timeZone), timeZone);
      if (items.length === 0) {
        setCreated(0);
        return;
      }

      /*
       * 밀린 회차를 올린다. 실패해도 목록은 그대로 둔다.
       *
       * 쓰기 권한이 없는 구성원(viewer)에게는 이 호출만 403 으로 돌아오고, 반복을
       * 보는 일은 그와 무관하다. 자정 무렵 기기 시계가 몇 분 빨라 거절될 수도 있는데,
       * 그때도 목록이 사라질 까닭은 없다 -- 다음에 열면 담긴다.
       */
      try {
        /*
         * 창구로 담는다. 앱에서는 사본에도 곧바로 들어간다.
         *
         * 서버에만 담으면 앱의 목록은 다음 동기화까지 비어 있어, "3건을 만들었습니다"
         * 라는 말과 빈 목록이 함께 보인다.
         */
        const result = await draftPort().add(projectId, items);
        setCreated(result.created);

        /*
         * 담은 것이 있으면 목록을 한 번 더 읽는다.
         *
         * 방금 만든 회차만큼 `lastMadeOn` 과 다음 예정일이 옮겨 갔다. 다시 읽지 않으면
         * 줄에는 이미 만들어진 날이 "다음 예정"으로 남는다.
         */
        if (result.created > 0) setRules(await apiClient.getRecurringRules(projectId));
      } catch (caught) {
        setCreated(0);
        setError(messageOf(caught, 'inbox.actionFailed'));
      }
    } catch (caught) {
      setRules([]);
      setError(messageOf(caught, 'inbox.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, timeZone, messageOf]);

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
          await apiClient.updateRecurringRule(id, patch);
        } else {
          await apiClient.createRecurringRule(rule as RecurringRuleDto.CreateRequest, projectId);
        }
        // 다시 읽으면서 밀린 회차까지 만든다("지난 25일부터 월세"로 만든 경우).
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
        await apiClient.updateRecurringRule(id, { isActive });
        await reload();
        return true;
      } catch (caught) {
        setError(messageOf(caught, 'inbox.actionFailed'));
        return false;
      }
    },
    [reload, messageOf],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await apiClient.deleteRecurringRule(id);
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

  return { rules, isLoading, error, created, reload, save, toggle, remove };
}
