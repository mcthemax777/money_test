/**
 * 프로젝트의 사람과 문 (멤버·초대 링크·가입 요청·"구성원 중 나").
 *
 * 프로젝트 자체를 만들고 고치는 일은 `useProjectAdmin` 이 맡는다. 여기는 그 프로젝트에
 * **누가 들어오고 나가는가**를 다룬다. 승인·강퇴처럼 되돌리기 어려운 일이 화면마다 다르게
 * 움직이지 않도록 조회와 손질을 한곳에 둔다.
 *
 * 지금은 앱의 프로젝트 관리 화면이 이것을 쓴다. 웹은 아직 제 화면 안에서 같은 API 를
 * 직접 부른다 -- 옮기면 한곳이 된다.
 *
 * 조회는 **소유한 프로젝트만** 하는 것이 둘 있다. 초대 링크와 가입 요청은 소유자만 볼 수
 * 있어서, 참여자로 들어간 프로젝트까지 물으면 403 이 줄줄이 돌아온다.
 */
import { useCallback, useState } from 'react';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { translate, type MessageKey } from '../lib/i18n';
import { useLocaleStore } from '../store/locale';
import type { Project } from '../store/project';

/** 손질의 결과. 실패하면 화면에 그대로 적을 문장이 함께 온다 (useProjectAdmin 과 같다). */
export type MembershipResult = { ok: true } | { ok: false; message: string };

/**
 * 프로젝트에 든 사람 한 줄 (화면이 그리는 모양).
 *
 * 엔티티의 `ProjectMember` 와 다른 것이다. 그쪽은 저장된 행이고, 이쪽은 서버가
 * 사용자 이름·이메일을 붙여 내려 주는 목록이다.
 */
export interface MemberRow {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string;
}

/** 아직 살아 있는 초대 링크 한 줄. */
export interface InviteRow {
  id: string;
  invitationCode: string;
  role: 'editor' | 'viewer';
  expiresAt: string | null;
  createdAt: string;
}

/** 소유자가 받은 가입 요청 한 줄. */
export interface JoinRequestRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  message: string | null;
  createdAt: string;
}

/** 내가 보낸 가입 요청 한 줄. */
export interface MyJoinRequestRow {
  id: string;
  projectId: string;
  projectName: string;
  projectKey: string | null;
  status: 'pending' | 'approved' | 'rejected';
  message: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** 참여 키로 찾은 프로젝트. 들어갈 수 있는지까지 서버가 알려 준다. */
export interface ProjectSearchResult {
  id: string;
  projectKey: string;
  name: string;
  description?: string | null;
  ownerName: string | null;
  memberCount: number;
  isMember: boolean;
  myRequestStatus: 'pending' | 'approved' | 'rejected' | null;
}

/** 방금 만든 초대 링크. 목록의 한 줄과 같은 모양이되 만든 시각은 오지 않는다. */
export type CreatedInvite = Omit<InviteRow, 'createdAt'>;

/** 승인의 결과. 누구를 들였는지 화면이 알려 주려고 이름을 받는다. */
export interface ApprovedMember {
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  role: 'owner' | 'editor' | 'viewer';
}

/** 이름만 필요한 구성원. "나" 지정 목록에 쓴다. */
export interface PersonOption {
  id: string;
  name: string;
}

export function useProjectMembership() {
  const { messageOf } = useApiError();
  const locale = useLocaleStore((state) => state.locale);
  const say = useCallback((key: MessageKey) => translate(locale, key), [locale]);

  const [members, setMembers] = useState<Record<string, MemberRow[]>>({});
  const [invitations, setInvitations] = useState<Record<string, InviteRow[]>>({});
  const [joinRequests, setJoinRequests] = useState<Record<string, JoinRequestRow[]>>({});
  const [people, setPeople] = useState<Record<string, PersonOption[]>>({});
  const [myRequests, setMyRequests] = useState<MyJoinRequestRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * 프로젝트별 곁가지를 한 번에 받는다.
   *
   * 하나가 실패해도 나머지는 그린다. 한 프로젝트의 초대 목록을 못 받았다고 화면 전체가
   * 비면, 정작 볼 수 있는 다른 프로젝트까지 손댈 수 없게 된다.
   */
  const load = useCallback(async (projects: Project[]) => {
    const owned = projects.filter((project) => project.role === 'owner');

    const gather = async <T,>(
      list: Project[],
      fetch: (projectId: string) => Promise<T[]>,
    ): Promise<Record<string, T[]>> => {
      const entries = await Promise.all(
        list.map(async (project) => {
          try {
            return [project.id, (await fetch(project.id)) ?? []] as const;
          } catch {
            return [project.id, [] as T[]] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    };

    const [memberRows, invitationRows, requestRows, personRows, mine] = await Promise.all([
      gather(projects, (id) => apiClient.getProjectMembers(id) as Promise<MemberRow[]>),
      // 초대와 가입 요청은 소유자만 볼 수 있다.
      gather(owned, (id) => apiClient.getProjectPendingInvitations(id) as Promise<InviteRow[]>),
      gather(owned, (id) => apiClient.getProjectJoinRequests(id) as Promise<JoinRequestRow[]>),
      gather(projects, async (id) => (await apiClient.getPeople(id)) as PersonOption[]),
      apiClient.getMyJoinRequests().catch(() => [] as MyJoinRequestRow[]),
    ]);

    setMembers(memberRows);
    setInvitations(invitationRows);
    setJoinRequests(requestRows);
    setPeople(personRows);
    setMyRequests((mine ?? []) as MyJoinRequestRow[]);
  }, []);

  /** 손질 하나. 실패는 던지지 않고 화면이 적을 문장으로 돌려준다. */
  const submit = useCallback(
    async <T,>(
      run: () => Promise<T>,
      fallbackKey: MessageKey,
    ): Promise<MembershipResult & { value?: T }> => {
      try {
        setIsSubmitting(true);
        const value = await run();
        return { ok: true, value };
      } catch (error) {
        return { ok: false, message: messageOf(error, fallbackKey) };
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageOf],
  );

  return {
    members,
    invitations,
    joinRequests,
    people,
    myRequests,
    isSubmitting,
    load,

    /** 초대 링크를 새로 낸다. 돌려준 코드로 링크를 만든다(주소는 화면이 정한다). */
    createInvitation: (projectId: string, role: 'editor' | 'viewer') =>
      submit(
        async () => (await apiClient.generateInvitationLink(projectId, role)) as CreatedInvite,
        'projects.inviteFailed',
      ),
    revokeInvitation: (invitationId: string) =>
      submit(() => apiClient.revokeInvitation(invitationId), 'projects.revokeFailed'),

    /** 강퇴. 소유자는 강퇴할 수 없다(서버가 막는다). */
    removeMember: (projectId: string, userId: string) =>
      submit(() => apiClient.removeProjectMember(projectId, userId), 'projects.kickFailed'),

    approveRequest: (requestId: string, role: 'editor' | 'viewer') =>
      submit(
        async () => (await apiClient.approveJoinRequest(requestId, role)) as ApprovedMember,
        'projects.approveFailed',
      ),
    rejectRequest: (requestId: string) =>
      submit(() => apiClient.rejectJoinRequest(requestId), 'projects.rejectFailed'),
    cancelMyRequest: (requestId: string) =>
      submit(() => apiClient.cancelJoinRequest(requestId), 'projects.cancelRequestFailed'),

    /** 참여 키로 찾기. 키가 비었으면 서버를 부르지 않는다. */
    searchByKey: async (
      key: string,
    ): Promise<MembershipResult & { value?: ProjectSearchResult }> => {
      if (!key.trim()) return { ok: false, message: say('projects.keyRequired') };
      return submit(
        async () => (await apiClient.findProjectByKey(key.trim())) as ProjectSearchResult,
        'projects.notFound',
      );
    },
    requestToJoin: (projectId: string, message?: string) =>
      submit(
        () => apiClient.requestToJoinProject(projectId, message?.trim() || undefined),
        'projects.requestFailed',
      ),

    /** "구성원 중 나". 프로젝트가 아니라 내 멤버십에 붙는 값이다. */
    setMyPerson: (projectId: string, personId: string | null) =>
      submit(() => apiClient.setMyPerson(projectId, personId), 'projects.meFailed'),
  };
}
