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
 * 번호는 두 가지를 받는다 (2026-10-25).
 *   - **초대 번호**: 즉시 참여다. 소유자가 발급한 것을 받은 사람이고, 링크를 받은 것과 같은
 *     일이라 승인을 한 번 더 받지 않는다.
 *   - **참여 키**: 가계부마다 하나인 8자 키다. 가입 요청을 보내고 소유자가 승인하면 들어간다.
 *     예전에는 이 화면이 초대 번호만 받아, 키를 친 사람은 "초대를 찾을 수 없다"만 보았다.
 * 요청을 보낸 뒤에는 이 화면이 목록을 주기적으로 다시 받아, 승인되는 대로 들어간다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiClient } from '../lib/api-client';
import { track } from '../lib/analytics';
import { apiErrorCode, useApiError } from '../lib/api-error';
import { inviteCodeOf } from '../lib/invite';
import type { MessageKey } from '../lib/i18n';
import { useProject, type Project } from '../store/project';

/** 승인을 기다리는 동안 목록을 다시 받는 간격. */
const APPROVAL_POLL_MS = 15_000;

/** 번호로 찾은 초대(또는 참여 키로 찾은 가계부). 들어가기 전에 무엇에 들어가는지 보여 준다. */
export interface InvitePreview {
  /** 초대 번호로 찾았나, 참여 키로 찾았나. 키면 들어가는 대신 가입 요청을 보낸다. */
  via: 'invite' | 'key';
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
  /** 참여 키로 찾았을 때 내 가입 요청의 상태. 초대 번호면 늘 null 이다. */
  requestStatus: 'pending' | 'rejected' | null;
}

/** `waiting` 은 가입 요청을 보내고 승인을 기다리는 중이라는 뜻이다. 화면은 아직 넘어가지 않는다. */
export type StartResult = { ok: true; waiting?: boolean } | { ok: false; message: string };

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
  /**
   * 확인한 초대에 들어간다. 먼저 `preview` 로 찾아 둔 것이 있어야 한다.
   * 참여 키로 찾았으면 가입 요청을 보내고 `waiting` 을 돌려준다.
   */
  join: () => Promise<StartResult>;
  /** 승인을 기다리던 가입 요청이 받아들여져 그 가계부를 골랐다. 웹은 이것을 보고 첫 화면으로 간다. */
  entered: boolean;
  /** 확인해 둔 초대. 아직 확인하지 않았으면 null 이다. */
  invite: InvitePreview | null;
  /** 확인한 것을 물린다. 다른 번호를 치려고 할 때. */
  clearInvite: () => void;
  isBusy: boolean;
}

/** 찾아 둔 초대 카드에 무엇을 보일지. 웹과 앱의 시작 화면이 같은 규칙으로 그린다. */
export interface InviteAction {
  /** 단추 글. null 이면 단추를 두지 않는다 (승인을 기다리는 중). */
  buttonKey: MessageKey | null;
  canSubmit: boolean;
  /** 카드 아래 한 줄. `isError` 면 붉게 쓴다. */
  noteKey: MessageKey | null;
  isError: boolean;
}

export function inviteActionOf(invite: InvitePreview, isBusy: boolean): InviteAction {
  if (invite.isMember) {
    return {
      buttonKey: isBusy ? 'start.joining' : 'start.joinSubmit',
      canSubmit: !isBusy,
      noteKey: 'start.alreadyMember',
      isError: false,
    };
  }
  if (invite.via === 'key') {
    if (invite.requestStatus === 'pending') {
      return { buttonKey: null, canSubmit: false, noteKey: 'start.keyWaiting', isError: false };
    }
    const isRejected = invite.requestStatus === 'rejected';
    return {
      buttonKey: isBusy
        ? 'start.keyRequesting'
        : isRejected
          ? 'start.keyRequestAgain'
          : 'start.keyRequest',
      canSubmit: !isBusy,
      noteKey: isRejected ? 'start.keyRejected' : 'start.keyHint',
      isError: isRejected,
    };
  }
  const usable = invite.status === 'pending';
  return {
    buttonKey: isBusy ? 'start.joining' : 'start.joinSubmit',
    canSubmit: usable && !isBusy,
    noteKey: usable ? null : 'start.inviteUnusable',
    isError: !usable,
  };
}

export function useProjectStart(): ProjectStart {
  const { messageOf } = useApiError();
  const setProjects = useProject((state) => state.setProjects);
  const setSelectedProjectId = useProject((state) => state.setSelectedProjectId);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [entered, setEntered] = useState(false);
  /**
   * 만들기가 나가 있는가 (2026-10-16). 상태(isBusy)는 다시 그린 뒤에야 단추를 막아, 두 번 누르면 가계부가
   * 둘 생겼다. 곧바로 바뀌는 ref 로 막는다.
   */
  const creatingRef = useRef(false);

  /**
   * 목록을 다시 받아 스토어에 넣는다. 만들거나 들어간 **직후에** 부른다.
   *
   * 이것이 없으면 화면이 그대로 머무른다. "가계부가 없다"를 목록의 길이로 판단하는데
   * (`useProjectBootstrap`) 그 목록은 로그인 때 한 번 받아 둔 것이라, 방금 생긴 가계부가
   * 거기 없다 -- 서버에는 들어갔는데 화면은 시작 화면에 남는다(앱에서 실제로 그랬다).
   */
  const refreshProjects = useCallback(async () => {
    const rows = ((await apiClient.getMyProjects()) ?? []) as Project[];
    setProjects(rows);
    return rows;
  }, [setProjects]);

  const create = useCallback(
    async (name: string): Promise<StartResult> => {
      const trimmed = name.trim();
      if (!trimmed || creatingRef.current) return { ok: false, message: '' };

      creatingRef.current = true;
      try {
        setIsBusy(true);
        const created = await apiClient.createProject(trimmed);
        /*
         * 만든 것을 곧바로 고른다. 여기서 고르지 않으면 목록을 다시 받을 때까지 화면이
         * 고른 가계부 없이 서 있고, 그 사이의 조회가 전부 빈손으로 돌아온다.
         */
        track({ name: 'project_create' });
        if (created?.id) setSelectedProjectId(created.id);
        /*
         * 목록을 못 받아도 만들기는 성공이다. 실패로 알리면 사람이 다시 눌러 가계부가 둘 생긴다.
         * 받은 답(만든 가계부)으로 목록을 채워 화면을 넘긴다. 다음 받기가 제 모양으로 덮는다.
         */
        await refreshProjects().catch(() => {
          if (created?.id) setProjects([{ ...created, role: 'owner' }]);
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, 'projects.createFailed') };
      } finally {
        creatingRef.current = false;
        setIsBusy(false);
      }
    },
    [messageOf, refreshProjects, setProjects, setSelectedProjectId],
  );

  /** 참여 키로 가계부를 찾는다. 초대 번호로 찾지 못했을 때와, 기다리던 요청을 되살릴 때 쓴다. */
  const previewByKey = useCallback(async (key: string): Promise<InvitePreview> => {
    const found = await apiClient.findProjectByKey(key);
    return {
      via: 'key',
      code: key,
      projectId: found.id,
      projectName: found.name,
      ownerName: found.ownerName ?? null,
      memberCount: found.memberCount ?? 0,
      // 요청으로 들어가면 소유자가 승인할 때 역할을 정한다. 여기서는 보여 주지 않는다.
      role: 'editor',
      status: 'pending',
      isMember: Boolean(found.isMember),
      // 승인된 요청은 목록에 이미 들어 있다. 여기서는 기다리거나 거절된 것만 본다.
      requestStatus:
        found.myRequestStatus === 'pending' || found.myRequestStatus === 'rejected'
          ? found.myRequestStatus
          : null,
    };
  }, []);

  const preview = useCallback(
    async (codeOrUrl: string): Promise<StartResult> => {
      const code = inviteCodeOf(codeOrUrl);
      if (!code) return { ok: false, message: '' };

      try {
        setIsBusy(true);
        const found = await apiClient.getInvitationByCode(code).catch(async (error: unknown) => {
          // 초대가 아니면 참여 키일 수 있다. 키로도 없으면 처음 오류(초대 없음)를 그대로 알린다.
          if (apiErrorCode(error) !== 'INVITATION_NOT_FOUND') throw error;
          const byKey = await previewByKey(code).catch(() => {
            throw error;
          });
          return { byKey };
        });
        if ('byKey' in found) {
          setInvite(found.byKey);
          return { ok: true };
        }
        setInvite({
          via: 'invite',
          code,
          projectId: found.projectId,
          projectName: found.projectName,
          ownerName: found.ownerName ?? null,
          memberCount: found.memberCount ?? 0,
          role: found.role,
          status: found.status,
          isMember: Boolean(found.isMember),
          requestStatus: null,
        });
        return { ok: true };
      } catch (error) {
        setInvite(null);
        return { ok: false, message: messageOf(error, 'invite.loadFailed') };
      } finally {
        setIsBusy(false);
      }
    },
    [messageOf, previewByKey],
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
      if (invite.via === 'key' && !invite.isMember) {
        // 키는 요청이다. 소유자가 승인할 때까지 기다린다 (아래의 주기적 받기가 넘겨 준다).
        await apiClient.requestToJoinProject(invite.projectId);
        setInvite({ ...invite, requestStatus: 'pending' });
        return { ok: true, waiting: true };
      }
      if (!invite.isMember) {
        await apiClient.acceptInvitation(invite.code);
        track({ name: 'project_join' });
      }
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

  /*
   * 전에 보낸 요청이 남아 있으면 그 자리로 돌아온다. 앱을 닫았다 열어도 "기다리는 중"이 보이고,
   * 그 사이 승인되었으면 목록을 다시 받는 것으로 바로 들어간다.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await refreshProjects();
        if (cancelled || rows.length > 0) return;
        const mine = ((await apiClient.getMyJoinRequests()) ?? []) as Array<{
          status: string;
          projectKey: string;
        }>;
        const waiting = mine.find((row) => row.status === 'pending');
        if (!waiting || cancelled) return;
        const found = await previewByKey(waiting.projectKey);
        // 그 사이 사람이 다른 번호를 찾아 두었으면 덮지 않는다.
        if (!cancelled) setInvite((current) => current ?? found);
      } catch {
        // 되살리지 못해도 화면은 처음 모양으로 선다. 사람이 키를 다시 치면 된다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewByKey, refreshProjects]);

  /*
   * 승인을 기다리는 동안 목록을 다시 받는다. 승인되면 목록에 그 가계부가 생기고, 그것을 골라
   * 화면을 넘긴다 (앱은 목록이 생기면 껍데기로 바뀌고, 웹은 `entered` 를 보고 간다).
   */
  const waitingProjectId =
    invite?.via === 'key' && invite.requestStatus === 'pending' ? invite.projectId : null;
  useEffect(() => {
    if (!waitingProjectId) return;
    const timer = setInterval(() => {
      void refreshProjects()
        .then((rows) => {
          if (!rows.some((row) => row.id === waitingProjectId)) return;
          setSelectedProjectId(waitingProjectId);
          setEntered(true);
        })
        .catch(() => undefined);
    }, APPROVAL_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshProjects, setSelectedProjectId, waitingProjectId]);

  return { create, preview, join, entered, invite, clearInvite, isBusy };
}
