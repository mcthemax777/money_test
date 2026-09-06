import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { DEFAULT_TIME_ZONE, SUPPORTED_CURRENCIES, type CurrencyCode } from '@money/types';

import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { useProjectAdmin } from '@money/core/hooks/useProjectAdmin';
import {
  useProjectMembership,
  type ProjectSearchResult,
} from '@money/core/hooks/useProjectMembership';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { currencyLabel } from '@money/core/lib/money';
import { TIME_ZONE_OPTIONS } from '@money/core/lib/time-zones';
import type { Project } from '@money/core/store/project';

import PageHeader from '../components/PageHeader';
import { useConnectivity } from '@money/core/store/connectivity';

/**
 * 프로젝트 관리. 웹의 /settings/projects 와 같은 것을 한다.
 *
 * 규칙은 훅 둘에 있다. 프로젝트 자체(만들기·이름·타임존·표시 통화·삭제)는
 * `useProjectAdmin`, 그 프로젝트에 누가 들어오고 나가는가(초대·가입 요청·멤버·"나")는
 * `useProjectMembership` 이다. 웹은 아직 제 화면 안에서 같은 API 를 직접 부른다.
 *
 * 복사 버튼은 없다. 앱에는 클립보드를 만지는 자리가 없어(네이티브 모듈을 더 넣어야 한다)
 * 참여 키와 초대 코드를 고를 수 있는 글자로 두고 길게 눌러 복사하게 했다.
 */
export default function ProjectsScreen() {
  const { t, tag } = useTranslation();
  const admin = useProjectAdmin();
  const membership = useProjectMembership();
  const mirrorVersion = useMirrorVersion();

  /*
   * 프로젝트·멤버·초대는 온라인에서만 한다.
   *
   * 여러 사람이 함께 보는 값이라 기기가 혼자 정할 수 없다 -- 초대와 승인은 서버가 지금
   * 상태를 보고 답해야 한다. 큐에 담아 두었다가 며칠 뒤에 보내면 그 사이 달라진 멤버
   * 위에서 다른 결과가 나온다 (설계 문서의 D12).
   */
  const isOffline = useConnectivity((state) => state.isOffline);

  const [error, setError] = useState('');
  /** 성공을 알리는 한 줄. 가입 요청처럼 화면이 곧바로 달라지지 않는 일에 쓴다. */
  const [notice, setNotice] = useState('');

  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [isJoining, setIsJoining] = useState(false);
  const [joinForm, setJoinForm] = useState({ key: '', message: '' });
  const [searchResult, setSearchResult] = useState<ProjectSearchResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  /** 지우기 전에 한 번 더 묻는다. 같은 버튼을 두 번 눌러야 지워진다. */
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  /** 초대 링크를 만들 때 줄 권한. 프로젝트마다 따로 고른다. */
  const [inviteRole, setInviteRole] = useState<Record<string, 'editor' | 'viewer'>>({});

  /*
   * 곁가지(멤버·초대·요청·구성원)는 프로젝트 목록이 정해진 뒤에 받는다. id 를 이어 붙인
   * 것을 보는 이유는, 목록을 다시 받을 때마다 배열이 새로 만들어져도 내용이 같으면 다시
   * 묻지 않기 위해서다.
   */
  const projectIds = admin.projects.map((project) => project.id).join(',');
  useEffect(() => {
    if (admin.projects.length > 0) membership.load(admin.projects);
    // 남이 멤버를 넣고 빼거나 가입 요청을 보낸 것도 이 자리에서 따라온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds, mirrorVersion]);

  const roleLabel = (role: 'owner' | 'editor' | 'viewer') => t(`role.${role}` as MessageKey);

  /** 손질 하나. 실패하면 이유를 적고, 성공하면 곁가지를 다시 받는다. */
  const run = async (
    task: Promise<{ ok: boolean; message?: string }>,
    onDone?: () => unknown | Promise<unknown>,
  ) => {
    const result = await task;
    setError(result.ok ? '' : result.message ?? '');
    if (!result.ok) return false;

    setNotice('');
    await onDone?.();
    return true;
  };

  /** 멤버·초대·요청을 다시 받는다. 프로젝트 목록 자체는 그대로다. */
  const reloadSide = () => membership.load(admin.projects);

  /**
   * 되돌리기 어려운 일은 한 번 더 묻는다.
   *
   * 물음은 제목이 아니라 본문에 넣는다. 안드로이드는 제목을 두 줄에서 잘라, 강퇴나
   * 무효화처럼 긴 문장이 "...참여할 수 없게 ..." 로 끝나 무엇에 답하는지 알 수 없다.
   */
  const confirm = (question: string, onYes: () => void) =>
    Alert.alert('', question, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: onYes },
    ]);

  const createProject = async () => {
    const ok = await run(admin.create(createForm.name, createForm.description));
    if (!ok) return;
    setCreateForm({ name: '', description: '' });
    setIsCreating(false);
  };

  const saveEdit = async (project: Project) => {
    const ok = await run(
      admin.update(project.id, { name: editForm.name, description: editForm.description }),
    );
    if (ok) setEditingId(null);
  };

  const searchProject = async () => {
    const result = await membership.searchByKey(joinForm.key);
    if (!result.ok) {
      setSearchResult(null);
      setError(result.message);
      return;
    }
    setError('');
    setSearchResult(result.value ?? null);
  };

  const requestJoin = async () => {
    if (!searchResult) return;

    const ok = await run(membership.requestToJoin(searchResult.id, joinForm.message), reloadSide);
    if (!ok) return;

    setNotice(t('projects.requestSent'));
    setSearchResult(null);
    setJoinForm({ key: '', message: '' });
    setIsJoining(false);
  };

  return (
    <View className="gap-6">
      <PageHeader
        title={t('settings.projects.title')}
        showBack
        action={
          <>
            <Pressable
              onPress={() => setIsJoining((open) => !open)}
              disabled={isOffline}
              className={`rounded-lg bg-gray-800 px-4 py-2 active:bg-gray-900 ${
                isOffline ? 'opacity-40' : ''
              }`}
            >
              <Text className="text-white">{t('projects.join')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setIsCreating((open) => !open)}
              disabled={isOffline}
              className={`rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700 ${
                isOffline ? 'opacity-40' : ''
              }`}
            >
              <Text className="text-white">{t('projects.create')}</Text>
            </Pressable>
          </>
        }
      />

      {isOffline ? (
        <View className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <Text className="text-gray-600">{t('online.onlyOnline')}</Text>
        </View>
      ) : null}

      {error ? (
        <View className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <Text className="text-red-600">{error}</Text>
        </View>
      ) : null}

      {notice ? (
        <View className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <Text className="text-blue-700">{notice}</Text>
        </View>
      ) : null}

      {isCreating ? (
        <View className="gap-4 rounded-lg border border-blue-200 bg-blue-50 p-6">
          <Text className="text-lg font-semibold text-gray-900">{t('projects.create')}</Text>
          <TextInput
            value={createForm.name}
            onChangeText={(name) => setCreateForm({ ...createForm, name })}
            placeholder={t('projects.namePlaceholder')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
          />
          <TextInput
            value={createForm.description}
            onChangeText={(description) => setCreateForm({ ...createForm, description })}
            placeholder={t('projects.descriptionPlaceholder')}
            multiline
            className="min-h-20 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
          />
          <View className="flex-row gap-2">
            <Pressable
              onPress={createProject}
              disabled={admin.isSubmitting}
              className="flex-1 items-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
            >
              <Text className="text-white">{t('projects.createSubmit')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setIsCreating(false);
                setCreateForm({ name: '', description: '' });
              }}
              className="flex-1 items-center rounded-lg bg-gray-200 px-4 py-2"
            >
              <Text className="text-gray-700">{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* 참여 키로 찾아 가입을 요청한다. 승인은 소유자가 한다. */}
      {isJoining ? (
        <View className="gap-4 rounded-lg border border-gray-200 bg-white p-6">
          <View>
            <Text className="text-lg font-semibold text-gray-900">{t('projects.join')}</Text>
            <Text className="mt-1 text-sm text-gray-600">{t('projects.joinHint')}</Text>
          </View>

          <View className="flex-row gap-2">
            <TextInput
              value={joinForm.key}
              onChangeText={(key) => setJoinForm({ ...joinForm, key: key.toUpperCase() })}
              placeholder={t('projects.keyPlaceholder')}
              autoCapitalize="characters"
              maxLength={8}
              onSubmitEditing={searchProject}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 tracking-widest text-gray-900"
            />
            <Pressable
              onPress={searchProject}
              disabled={membership.isSubmitting}
              className="items-center justify-center rounded-lg bg-gray-800 px-4 py-2 active:bg-gray-900"
            >
              <Text className="text-white">
                {membership.isSubmitting ? t('projects.searching') : t('projects.search')}
              </Text>
            </Pressable>
          </View>

          {searchResult ? (
            <View className="gap-3 rounded-lg border border-gray-200 p-4">
              <View>
                <Text className="font-semibold text-gray-900">{searchResult.name}</Text>
                {searchResult.description ? (
                  <Text className="mt-1 text-sm text-gray-600">{searchResult.description}</Text>
                ) : null}
                <Text className="mt-2 text-xs text-gray-500">
                  {t('projects.ownerAndMembers', {
                    owner: searchResult.ownerName ?? t('projects.unknownOwner'),
                    count: searchResult.memberCount,
                  })}
                </Text>
              </View>

              {searchResult.isMember ? (
                <Text className="text-sm text-green-700">{t('projects.alreadyMember')}</Text>
              ) : searchResult.myRequestStatus === 'pending' ? (
                <Text className="text-sm text-blue-700">{t('projects.waitingApproval')}</Text>
              ) : (
                <>
                  <TextInput
                    value={joinForm.message}
                    onChangeText={(message) => setJoinForm({ ...joinForm, message })}
                    placeholder={t('projects.messagePlaceholder')}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                  />
                  {searchResult.myRequestStatus === 'rejected' ? (
                    <Text className="text-xs text-orange-600">{t('projects.rejectedBefore')}</Text>
                  ) : null}
                  <Pressable
                    onPress={requestJoin}
                    disabled={membership.isSubmitting}
                    className="items-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
                  >
                    <Text className="text-white">{t('projects.sendRequest')}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 내가 보낸 가입 요청. 대기 중인 것은 취소할 수 있다. */}
      {membership.myRequests.length > 0 ? (
        <View className="rounded-lg border border-gray-200 bg-white p-6">
          <Text className="mb-4 text-lg font-semibold text-gray-900">{t('projects.myRequests')}</Text>
          <View className="gap-2">
            {membership.myRequests.map((request) => (
              <View
                key={request.id}
                className="flex-row items-center justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3"
              >
                <View className="flex-1">
                  <Text className="font-medium text-gray-900">{request.projectName}</Text>
                  <Text className="mt-1 text-xs text-gray-500">
                    {t('projects.requestedOn', {
                      date: new Date(request.createdAt).toLocaleDateString(tag),
                    })}
                  </Text>
                </View>
                <View className="flex-row items-center gap-3">
                  <Text
                    className={`rounded px-2 py-1 text-xs ${
                      request.status === 'pending'
                        ? 'bg-blue-100 text-blue-700'
                        : request.status === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {request.status === 'pending'
                      ? t('projects.statusPending')
                      : request.status === 'approved'
                        ? t('projects.statusApproved')
                        : t('projects.statusRejected')}
                  </Text>
                  {request.status === 'pending' ? (
                    <Pressable
                      onPress={() =>
                        confirm(t('projects.cancelRequestConfirm'), () => {
                          run(membership.cancelMyRequest(request.id), reloadSide);
                        })
                      }
                    >
                      <Text className="text-xs text-gray-500">{t('common.cancel')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {admin.isLoading && admin.projects.length === 0 ? (
        <Text className="py-8 text-center text-gray-500">{t('common.loading')}</Text>
      ) : admin.projects.length === 0 ? (
        <View className="items-center gap-4 rounded-lg bg-gray-50 p-8">
          <Text className="text-gray-600">{t('projects.empty')}</Text>
          <Pressable
            onPress={() => setIsCreating(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="text-white">{t('projects.createFirst')}</Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-4">
          {admin.projects.map((project) => {
            const isSelected = admin.selectedProjectId === project.id;
            const isOwner = project.role === 'owner';
            const members = membership.members[project.id] ?? [];
            const invitations = membership.invitations[project.id] ?? [];
            const requests = membership.joinRequests[project.id] ?? [];
            const people = membership.people[project.id] ?? [];

            return (
              <View
                key={project.id}
                className={`rounded-lg bg-white p-6 shadow-sm ${
                  isSelected ? 'border-2 border-blue-500' : ''
                }`}
              >
                {editingId === project.id ? (
                  <View className="gap-2">
                    <TextInput
                      value={editForm.name}
                      onChangeText={(name) => setEditForm({ ...editForm, name })}
                      placeholder={t('projects.namePlaceholder')}
                      autoFocus
                      className="rounded border border-gray-300 px-2 py-1 text-lg font-semibold text-gray-900"
                    />
                    <TextInput
                      value={editForm.description}
                      onChangeText={(description) => setEditForm({ ...editForm, description })}
                      placeholder={t('projects.descriptionEditPlaceholder')}
                      className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
                    />
                    <View className="flex-row gap-2">
                      <Pressable
                        onPress={() => saveEdit(project)}
                        disabled={admin.isSubmitting}
                        className="rounded bg-blue-600 px-3 py-1 active:bg-blue-700"
                      >
                        <Text className="text-sm text-white">
                          {admin.isSubmitting ? t('common.saving') : t('common.save')}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setEditingId(null)}
                        className="rounded bg-gray-200 px-3 py-1"
                      >
                        <Text className="text-sm text-gray-700">{t('common.cancel')}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <>
                    <View className="flex-row items-center gap-2">
                      <Text className="text-lg font-semibold text-gray-900">{project.name}</Text>
                      {isOwner ? (
                        <Pressable
                          onPress={() => {
                            setEditingId(project.id);
                            setEditForm({
                              name: project.name,
                              description: project.description ?? '',
                            });
                          }}
                        >
                          <Text className="text-xs text-blue-600">
                            {t('projects.editNameDescription')}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {project.description ? (
                      <Text className="mt-1 text-sm text-gray-600">{project.description}</Text>
                    ) : null}
                  </>
                )}

                <View className="mt-3 flex-row flex-wrap items-center gap-4">
                  <Text className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">
                    {t('projects.rolePermission', { role: roleLabel(project.role) })}
                  </Text>

                  {isSelected ? (
                    <Text className="rounded bg-green-100 px-2 py-1 text-xs text-green-700">
                      {t('projects.selected')}
                    </Text>
                  ) : (
                    <Pressable onPress={() => admin.select(project.id)}>
                      <Text className="text-xs text-blue-600">{t('projects.selectThis')}</Text>
                    </Pressable>
                  )}

                  {project.projectKey ? (
                    <View className="flex-row items-center gap-2">
                      <Text className="text-xs text-gray-600">{t('projects.key')}</Text>
                      {/* 길게 누르면 복사할 수 있다. 앱에는 복사 버튼을 둘 자리가 없다. */}
                      <Text
                        selectable
                        className="rounded bg-gray-100 px-2 py-1 text-xs tracking-widest text-gray-700"
                      >
                        {project.projectKey}
                      </Text>
                      <Text className="text-xs text-gray-400">{t('projects.selectToCopy')}</Text>
                    </View>
                  ) : null}
                </View>

                {/* 집계의 기준이 되는 타임존. 구성원 모두에게 함께 적용된다. */}
                {isOwner ? (
                  <View className="mt-4 border-t border-gray-100 pt-4">
                    <Text className="text-sm font-semibold text-gray-900">
                      {t('projects.timezone')}
                    </Text>
                    <Text className="mt-1 text-xs text-gray-500">{t('projects.timezoneHint')}</Text>
                    <View className="mt-2 flex-row flex-wrap gap-2">
                      {TIME_ZONE_OPTIONS.map((option) => {
                        const active = (project.timezone ?? DEFAULT_TIME_ZONE) === option.id;

                        return (
                          <Pressable
                            key={option.id}
                            onPress={() => run(admin.update(project.id, { timezone: option.id }))}
                            className={`rounded-lg border px-3 py-1 ${
                              active ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
                            }`}
                          >
                            <Text
                              className={`text-xs ${active ? 'text-blue-600' : 'text-gray-700'}`}
                            >
                              {option.nameKey ? t(option.nameKey) : option.id}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {/* 표시 통화. 저장값은 그대로 두고 읽을 때만 환산한다. */}
                {isOwner ? (
                  <View className="mt-4 border-t border-gray-100 pt-4">
                    <Text className="text-sm font-semibold text-gray-900">
                      {t('projects.displayCurrency')}
                    </Text>
                    <Text className="mt-1 text-xs text-gray-500">
                      {t('projects.displayCurrencyHint')}
                    </Text>
                    <View className="mt-2 flex-row flex-wrap gap-2">
                      {SUPPORTED_CURRENCIES.map((code: CurrencyCode) => {
                        const active = (project.displayCurrency ?? project.ledgerCurrency) === code;

                        return (
                          <Pressable
                            key={code}
                            onPress={() => run(admin.update(project.id, { displayCurrency: code }))}
                            className={`rounded-lg border px-3 py-1 ${
                              active ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
                            }`}
                          >
                            <Text
                              className={`text-xs ${active ? 'text-blue-600' : 'text-gray-700'}`}
                            >
                              {code} · {currencyLabel(code)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text className="mt-2 text-xs text-gray-400">
                      {t('projects.ledgerCurrencyNote', {
                        currency: project.ledgerCurrency ?? 'KRW',
                      })}
                    </Text>
                  </View>
                ) : null}

                {/* 구성원 중 나. 프로젝트가 아니라 내 멤버십에 붙는 값이라 사람마다 다르다. */}
                <View className="mt-4 border-t border-gray-100 pt-4">
                  <Text className="text-sm font-semibold text-gray-900">
                    {t('projects.myPerson')}
                  </Text>
                  <Text className="mt-1 text-xs text-gray-500">{t('projects.myPersonHint')}</Text>
                  <View className="mt-2 flex-row flex-wrap gap-2">
                    {[{ id: '', name: t('projects.myPersonNone') }, ...people].map((person) => {
                      const active = (project.myPersonId ?? '') === person.id;

                      return (
                        <Pressable
                          key={person.id || 'none'}
                          onPress={() =>
                            run(membership.setMyPerson(project.id, person.id || null), () =>
                              admin.reload(),
                            )
                          }
                          className={`rounded-lg border px-3 py-1 ${
                            active ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
                          }`}
                        >
                          <Text className={`text-xs ${active ? 'text-blue-600' : 'text-gray-700'}`}>
                            {person.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {/* 초대 링크. 소유자만 만들고 볼 수 있다. */}
                {isOwner ? (
                  <View className="mt-4 border-t border-gray-100 pt-4">
                    <View className="flex-row flex-wrap items-center justify-between gap-2">
                      <Text className="text-sm font-semibold text-gray-900">
                        {t('projects.inviteLink')}
                      </Text>
                      <View className="flex-row items-center gap-2">
                        {(['editor', 'viewer'] as const).map((role) => {
                          const active = (inviteRole[project.id] ?? 'editor') === role;

                          return (
                            <Pressable
                              key={role}
                              onPress={() => setInviteRole({ ...inviteRole, [project.id]: role })}
                              className={`rounded-lg border px-3 py-1 ${
                                active ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
                              }`}
                            >
                              <Text
                                className={`text-xs ${active ? 'text-blue-600' : 'text-gray-700'}`}
                              >
                                {roleLabel(role)}
                              </Text>
                            </Pressable>
                          );
                        })}
                        <Pressable
                          onPress={() =>
                            run(
                              membership.createInvitation(
                                project.id,
                                inviteRole[project.id] ?? 'editor',
                              ),
                              reloadSide,
                            )
                          }
                          className="rounded-lg bg-blue-600 px-3 py-1 active:bg-blue-700"
                        >
                          <Text className="text-xs text-white">{t('projects.createLink')}</Text>
                        </Pressable>
                      </View>
                    </View>

                    {invitations.length === 0 ? (
                      <Text className="mt-3 text-xs text-gray-500">{t('projects.noInvite')}</Text>
                    ) : (
                      <View className="mt-3 gap-2">
                        {invitations.map((invitation) => (
                          <View
                            key={invitation.id}
                            className="flex-row flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-4 py-3"
                          >
                            <View className="flex-1">
                              <Text selectable className="text-xs text-gray-700">
                                /join?code={invitation.invitationCode}
                              </Text>
                              <Text className="mt-1 text-xs text-gray-500">
                                {t('projects.rolePermission', { role: roleLabel(invitation.role) })}
                                {invitation.expiresAt
                                  ? t('projects.until', {
                                      date: new Date(invitation.expiresAt).toLocaleDateString(tag),
                                    })
                                  : ''}
                              </Text>
                              <Text className="mt-1 text-xs text-gray-400">
                                {t('projects.selectToCopy')}
                              </Text>
                            </View>
                            <Pressable
                              onPress={() =>
                                confirm(t('projects.revokeConfirm'), () => {
                                  run(membership.revokeInvitation(invitation.id), reloadSide);
                                })
                              }
                              className="rounded border border-red-300 bg-white px-3 py-1 active:bg-red-50"
                            >
                              <Text className="text-xs text-red-600">{t('projects.revoke')}</Text>
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ) : null}

                {/* 멤버. 소유자는 소유자 자신을 뺀 나머지를 내보낼 수 있다. */}
                {members.length > 0 ? (
                  <View className="mt-4 border-t border-gray-100 pt-4">
                    <Text className="mb-3 text-sm font-semibold text-gray-900">
                      {t('projects.memberCount', { count: members.length })}
                    </Text>
                    <View className="gap-2">
                      {members.map((member) => (
                        <View
                          key={member.id}
                          className="flex-row items-center justify-between gap-4 rounded-lg border border-gray-100 px-4 py-3"
                        >
                          <View className="flex-1">
                            <Text className="text-sm font-medium text-gray-900">
                              {member.name}
                              <Text className="text-xs text-gray-500"> {roleLabel(member.role)}</Text>
                            </Text>
                            <Text className="text-xs text-gray-500">{member.email}</Text>
                          </View>
                          {isOwner && member.role !== 'owner' ? (
                            <Pressable
                              onPress={() =>
                                confirm(t('projects.kickConfirm', { name: member.name }), () => {
                                  run(membership.removeMember(project.id, member.id), reloadSide);
                                })
                              }
                              className="rounded border border-red-300 bg-white px-3 py-1 active:bg-red-50"
                            >
                              <Text className="text-xs text-red-600">{t('projects.kick')}</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                {/* 받은 가입 요청. 승인하면 그 자리에서 권한이 정해진다. */}
                {isOwner && requests.length > 0 ? (
                  <View className="mt-4 border-t border-gray-100 pt-4">
                    <Text className="mb-3 text-sm font-semibold text-gray-900">
                      {t('projects.pendingRequests', { count: requests.length })}
                    </Text>
                    <View className="gap-2">
                      {requests.map((request) => (
                        <View key={request.id} className="gap-3 rounded-lg bg-gray-50 px-4 py-3">
                          <View>
                            <Text className="text-sm font-medium text-gray-900">{request.name}</Text>
                            <Text className="text-xs text-gray-500">{request.email}</Text>
                            {request.message ? (
                              <Text className="mt-1 text-xs text-gray-700">
                                “{request.message}”
                              </Text>
                            ) : null}
                          </View>
                          <View className="flex-row flex-wrap gap-2">
                            <Pressable
                              onPress={() =>
                                run(membership.approveRequest(request.id, 'editor'), reloadSide)
                              }
                              className="rounded bg-blue-600 px-3 py-1 active:bg-blue-700"
                            >
                              <Text className="text-xs text-white">
                                {t('projects.approveEditor')}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                run(membership.approveRequest(request.id, 'viewer'), reloadSide)
                              }
                              className="rounded bg-gray-600 px-3 py-1 active:bg-gray-700"
                            >
                              <Text className="text-xs text-white">
                                {t('projects.approveViewer')}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                confirm(t('projects.rejectConfirm'), () => {
                                  run(membership.rejectRequest(request.id), reloadSide);
                                })
                              }
                              className="rounded border border-gray-300 bg-white px-3 py-1 active:bg-gray-100"
                            >
                              <Text className="text-xs text-gray-700">{t('projects.reject')}</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                <View className="mt-4 flex-row justify-end">
                  {isOwner ? (
                    <Pressable
                      onPress={() => {
                        if (deleteConfirmId !== project.id) {
                          setDeleteConfirmId(project.id);
                          return;
                        }
                        setDeleteConfirmId(null);
                        run(admin.removeOrLeave(project.id, 'delete'), reloadSide);
                      }}
                      className="rounded bg-red-600 px-3 py-1 active:bg-red-700"
                    >
                      <Text className="text-sm text-white">
                        {deleteConfirmId === project.id
                          ? t('common.confirm')
                          : t('projects.deleteAction')}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() =>
                        confirm(t('projects.leaveConfirm'), () => {
                          run(admin.removeOrLeave(project.id, 'leave'), reloadSide);
                        })
                      }
                      className="rounded bg-orange-600 px-3 py-1 active:bg-orange-700"
                    >
                      <Text className="text-sm text-white">{t('projects.leave')}</Text>
                    </Pressable>
                  )}
                </View>

                {deleteConfirmId === project.id ? (
                  <View className="mt-4 rounded border border-red-200 bg-red-50 p-3">
                    <Text className="text-sm text-red-700">{t('projects.deleteQuestion')}</Text>
                    <Text className="mt-1 text-xs text-red-600">{t('projects.deleteWarning')}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
