/**
 * 가계부가 하나도 없는 사람이 처음 서는 자리.
 *
 * 두 길뿐이다. **만들거나, 들어가거나.** 첫 로그인 때 서버가 가계부를 만들어 주지
 * 않으므로(`auth.service` 의 `createGoogleUser`) 이 화면을 지나야 어디든 갈 수 있다.
 *
 * 웹과 앱이 같은 훅을 쓴다. 들어가는 절차에 걸음이 여럿이라(번호 확인 -> 무엇에
 * 들어가는지 보여 주기 -> 수락) 두 벌로 두면 한쪽만 고쳐져 다른 화면에서는 엉뚱한
 * 가계부에 들어가게 된다.
 *
 * 번호는 **즉시 참여**다. 소유자가 발급한 것을 받은 사람이고, 링크를 받은 것과 같은
 * 일이라 승인을 한 번 더 받지 않는다. 승인을 받는 길(참여 키 + 가입 요청)은 설정 >
 * 프로젝트 관리에 그대로 있다.
 */
import { useCallback, useState } from 'react';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { inviteCodeOf } from '../lib/invite';
import { useProject } from '../store/project';

/** 번호로 찾은 초대. 들어가기 전에 무엇에 들어가는지 보여 준다. */
export interface InvitePreview {
  code: string;
  projectId: string;
  projectName: string;
  ownerName: string | null;
  memberCount: number;
  role: 'owner' | 'editor' | 'viewer';
  /** pending 이 아니면 들어갈 수 없다 (만료·취소·이미 쓴 번호). */
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  /** 이미 이 가계부의 구성원이다. 다시 들어갈 것이 없다. */
  isMember: boolean;
}

export type StartResult = { ok: true } | { ok: false; message: string };

export interface ProjectStart {
  /** 새 가계부를 만든다. 만든 것을 곧바로 고른 상태가 된다. */
  create: (name: string) => Promise<StartResult>;
  /**
   * 번호를 확인한다. 링크나 QR 에서 읽은 글을 그대로 넘겨도 된다.
   *
   * 들어가기 전에 한 번 보여 주는 것은, 번호를 잘못 옮겨 적었을 때 엉뚱한 집의
   * 가계부에 들어가 버리는 일을 막기 위해서다.
   */
  preview: (codeOrUrl: string) => Promise<StartResult>;
  /** 확인한 초대에 들어간다. 먼저 `preview` 로 찾아 둔 것이 있어야 한다. */
  join: () => Promise<StartResult>;
  /** 확인해 둔 초대. 아직 확인하지 않았으면 null 이다. */
  invite: InvitePreview | null;
  /** 확인한 것을 물린다. 다른 번호를 치려고 할 때. */
  clearInvite: () => void;
  isBusy: boolean;
}

export function useProjectStart(): ProjectStart {
  const { messageOf } = useApiError();
  const setProjects = useProject((state) => state.setProjects);
  const setSelectedProjectId = useProject((state) => state.setSelectedProjectId);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /**
   * 목록을 다시 받아 스토어에 넣는다. 만들거나 들어간 **직후에** 부른다.
   *
   * 이것이 없으면 화면이 그대로 머무른다. "가계부가 없다"를 목록의 길이로 판단하는데
   * (`useProjectBootstrap`) 그 목록은 로그인 때 한 번 받아 둔 것이라, 방금 생긴 가계부가
   * 거기 없다 -- 서버에는 들어갔는데 화면은 시작 화면에 남는다(앱에서 실제로 그랬다).
   */
  const refreshProjects = useCallback(async () => {
    const rows = (await apiClient.getMyProjects()) ?? [];
    setProjects(rows);
  }, [setProjects]);

  const create = useCallback(
    async (name: string): Promise<StartResult> => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, message: '' };

      try {
        setIsBusy(true);
        const created = await apiClient.createProject(trimmed);
        /*
         * 만든 것을 곧바로 고른다. 여기서 고르지 않으면 목록을 다시 받을 때까지 화면이
         * 고른 가계부 없이 서 있고, 그 사이의 조회가 전부 빈손으로 돌아온다.
         */
        if (created?.id) setSelectedProjectId(created.id);
        await refreshProjects();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, 'projects.createFailed') };
      } finally {
        setIsBusy(false);
      }
    },
    [messageOf, refreshProjects, setSelectedProjectId],
  );

  const preview = useCallback(
    async (codeOrUrl: string): Promise<StartResult> => {
      const code = inviteCodeOf(codeOrUrl);
      if (!code) return { ok: false, message: '' };

      try {
        setIsBusy(true);
        const found = await apiClient.getInvitationByCode(code);
        setInvite({
          code,
          projectId: found.projectId,
          projectName: found.projectName,
          ownerName: found.ownerName ?? null,
          memberCount: found.memberCount ?? 0,
          role: found.role,
          status: found.status,
          isMember: Boolean(found.isMember),
        });
        return { ok: true };
      } catch (error) {
        setInvite(null);
        return { ok: false, message: messageOf(error, 'invite.loadFailed') };
      } finally {
        setIsBusy(false);
      }
    },
    [messageOf],
  );

  const join = useCallback(async (): Promise<StartResult> => {
    if (!invite) return { ok: false, message: '' };

    try {
      setIsBusy(true);
      /*
       * 이미 구성원이면 수락하지 않는다. 서버가 막는 자리이기도 하지만("이미 이
       * 프로젝트의 멤버입니다") 여기서 그 오류를 화면에 띄우는 것보다 그 가계부를
       * 골라 주고 들여보내는 편이 사람이 하려던 일에 가깝다.
       */
      if (!invite.isMember) await apiClient.acceptInvitation(invite.code);
      setSelectedProjectId(invite.projectId);
      await refreshProjects();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: messageOf(error, 'invite.acceptFailed') };
    } finally {
      setIsBusy(false);
    }
  }, [invite, messageOf, refreshProjects, setSelectedProjectId]);

  const clearInvite = useCallback(() => setInvite(null), []);

  return { create, preview, join, invite, clearInvite, isBusy };
}
