import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@money/types';

import { useProjectAdmin } from '@money/core/hooks/useProjectAdmin';
import { useTranslation } from '@money/core/lib/i18n';
import { currencyLabel } from '@money/core/lib/money';
import type { Project } from '@money/core/store/project';

import PageHeader from '../components/PageHeader';

/**
 * 프로젝트 관리. 웹의 /settings/projects 를 옮긴 것이다.
 *
 * 지금 옮긴 것은 목록·만들기·고르기·이름 고치기·표시 통화·나가기/삭제다. 멤버 관리,
 * 초대 링크, 프로젝트 키로 참여 요청, 타임존은 아직 웹에만 있다.
 */
export default function ProjectsScreen() {
  const { t } = useTranslation();
  const admin = useProjectAdmin();

  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  /** 지우기 전에 한 번 더 묻는다. 같은 버튼을 두 번 눌러야 지워진다. */
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const run = async (task: Promise<{ ok: boolean; message?: string }>) => {
    const result = await task;
    setError(result.ok ? '' : result.message ?? '');
    return result.ok;
  };

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

  return (
    <View className="gap-6">
      <PageHeader
        title={t('settings.projects.title')}
        showBack
        action={
          <Pressable
            onPress={() => setIsCreating((open) => !open)}
            className="rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="text-white">{t('projects.create')}</Text>
          </Pressable>
        }
      />

      {error ? (
        <View className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <Text className="text-red-600">{error}</Text>
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
                    {t('projects.rolePermission', { role: project.role })}
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
                      <Text className="rounded bg-gray-100 px-2 py-1 text-xs tracking-widest text-gray-700">
                        {project.projectKey}
                      </Text>
                    </View>
                  ) : null}
                </View>

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
                        run(admin.removeOrLeave(project.id, 'delete'));
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
                      onPress={() => run(admin.removeOrLeave(project.id, 'leave'))}
                      className="rounded bg-orange-600 px-3 py-1 active:bg-orange-700"
                    >
                      <Text className="text-sm text-white">{t('projects.leave')}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* 아직 웹에만 있는 것들. 없는 채로 두면 앱에서 할 수 있는 일로 오해한다. */}
      <Text className="text-xs text-gray-500">{t('projects.webOnlyRest')}</Text>
    </View>
  );
}
