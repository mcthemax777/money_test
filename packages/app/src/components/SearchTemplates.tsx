/*
 * 검색 창 맨 위의 템플릿 줄 (웹의 SearchTemplates 와 같은 짝).
 *
 * 이름 붙여 둔 조건을 알약으로 늘어놓는다. 누르면 그 조건과 묶는 단위가 **바로 걸리고** 창이
 * 닫힌다(2026-10-08 사용자 요청 -- "바로바로 템플릿으로 필터 세팅"). 고르는 중인 조건은 "지금
 * 조건 저장"으로 남기고, 편집을 누르면 이름 바꾸기·지우기가 선다. 남기는 자리는 core 의
 * `useFilterTemplates`(기기, 가계부별)다 -- 끊겨 있어도 그대로 돈다.
 */
import { useState } from 'react';
import { Alert, LayoutAnimation, Pressable, Text, TextInput, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import type { EntryPeriodUnit } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';
import type { TransactionSearch } from '@money/core/hooks/useTransactions';
import {
  templateMatches,
  useFilterTemplates,
  type FilterTemplate,
} from '@money/core/store/filter-templates';

import { Chip } from './FormFields';

/** 칸이 열리고 닫히는 움직임. 다른 화면의 펼침과 같은 180ms 투명도다. */
const FOLD = LayoutAnimation.create(180, 'easeInEaseOut', 'opacity');

/** 저장·편집 칸의 글자 입력. 검색 창의 글자 칸과 같은 모양이다. */
const INPUT_CLASS =
  'flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900';

export default function SearchTemplates({
  draft,
  draftUnit,
  canSaveDraft,
  applied,
  onPick,
}: {
  /** 저장할 조건. 검색 창이 감춘 쪽 값을 비운 것을 넘긴다 (`withSearchPeriodMode`). */
  draft: TransactionSearch;
  draftUnit: EntryPeriodUnit;
  /** 지금 조건을 남길 수 있는가. 기간을 잘못 골랐으면 남기지 않는다. */
  canSaveDraft: boolean;
  /** 지금 걸린 조건. 같은 템플릿을 켜 보인다. */
  applied: { search: TransactionSearch; unit: EntryPeriodUnit };
  onPick: (template: FilterTemplate) => void;
}) {
  const { t } = useTranslation();
  const { templates, canSave, save, rename, remove } = useFilterTemplates();
  /** idle 은 알약, saving 은 이름 적기, managing 은 이름 바꾸기·지우기다. */
  const [mode, setModeState] = useState<'idle' | 'saving' | 'managing'>('idle');
  const [name, setName] = useState('');
  /** 이름을 고치는 중인 템플릿과 적고 있는 이름. */
  const [renaming, setRenamingState] = useState<{ id: string; name: string } | null>(null);

  /* 칸이 바뀌면 높이가 밀린다. 툭 바뀌지 않게 다음 그림을 옅게 잇는다. */
  const setMode = (next: 'idle' | 'saving' | 'managing') => {
    LayoutAnimation.configureNext(FOLD);
    setModeState(next);
  };
  const setRenaming = (next: { id: string; name: string } | null) => {
    if ((next === null) !== (renaming === null)) LayoutAnimation.configureNext(FOLD);
    setRenamingState(next);
  };

  // 가계부를 고르지 않았으면 남길 자리가 없다.
  if (!canSave) return null;

  const trimmed = name.trim();
  const willOverwrite = templates.some((item) => item.name === trimmed);
  const renameTaken =
    renaming !== null &&
    templates.some((item) => item.id !== renaming.id && item.name === renaming.name.trim());

  const submitSave = () => {
    if (!trimmed || !canSaveDraft) return;
    save(trimmed, draft, draftUnit);
    setName('');
    setMode('idle');
  };

  const submitRename = () => {
    if (!renaming || !renaming.name.trim() || renameTaken) return;
    rename(renaming.id, renaming.name);
    setRenaming(null);
  };

  // 지우기 전에 한 번 묻는다. 되돌릴 자리가 없다.
  const confirmRemove = (template: FilterTemplate) => {
    Alert.alert(t('tx.search.templateDeleteConfirm', { name: template.name }), '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('tx.search.templateDelete'),
        style: 'destructive',
        onPress: () => {
          LayoutAnimation.configureNext(FOLD);
          remove(template.id);
          if (renaming?.id === template.id) setRenamingState(null);
        },
      },
    ]);
  };

  return (
    <View className="mb-5">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wider text-gray-600">
          {t('tx.search.templates')}
        </Text>
        {templates.length > 0 ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              setMode(mode === 'managing' ? 'idle' : 'managing');
              setRenamingState(null);
            }}
          >
            <Text className="text-xs font-medium text-blue-600">
              {t(mode === 'managing' ? 'tx.search.templateDone' : 'tx.search.templateManage')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {mode === 'managing' ? (
        /* 편집. 한 줄에 템플릿 하나 -- 이름을 고치는 칸이 알약 안에는 들어가지 않는다. */
        <View className="rounded-lg border border-gray-200">
          {templates.map((template, index) => (
            <View
              key={template.id}
              className={`flex-row items-center gap-3 px-3 py-2 ${
                index > 0 ? 'border-t border-gray-100' : ''
              }`}
            >
              {renaming?.id === template.id ? (
                <>
                  <TextInput
                    autoFocus
                    value={renaming.name}
                    onChangeText={(text) => setRenamingState({ id: template.id, name: text })}
                    onSubmitEditing={submitRename}
                    returnKeyType="done"
                    placeholder={t('tx.search.templateName')}
                    placeholderTextColor="#9ca3af"
                    className={INPUT_CLASS}
                  />
                  <Pressable
                    hitSlop={6}
                    disabled={!renaming.name.trim() || renameTaken}
                    onPress={submitRename}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        !renaming.name.trim() || renameTaken ? 'text-gray-300' : 'text-blue-600'
                      }`}
                    >
                      {t('common.save')}
                    </Text>
                  </Pressable>
                  <Pressable hitSlop={6} onPress={() => setRenaming(null)}>
                    <Text className="text-sm text-gray-500">{t('common.cancel')}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text className="flex-1 text-sm text-gray-900" numberOfLines={1}>
                    {template.name}
                  </Text>
                  <Pressable
                    hitSlop={6}
                    onPress={() => setRenaming({ id: template.id, name: template.name })}
                  >
                    <Text className="text-sm text-blue-600">{t('tx.search.templateRename')}</Text>
                  </Pressable>
                  <Pressable hitSlop={6} onPress={() => confirmRemove(template)}>
                    <Text className="text-sm text-red-600">{t('tx.search.templateDelete')}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ))}
          {renameTaken ? (
            <Text className="border-t border-gray-100 px-3 py-2 text-xs text-red-600">
              {t('tx.search.templateDuplicate')}
            </Text>
          ) : null}
        </View>
      ) : (
        <View>
          <View className="flex-row flex-wrap gap-2">
            {templates.map((template) => (
              <Chip
                key={template.id}
                label={template.name}
                selected={templateMatches(template, applied.search, applied.unit)}
                onPress={() => onPick(template)}
              />
            ))}
            {mode === 'idle' ? (
              <Pressable
                disabled={!canSaveDraft}
                onPress={() => setMode('saving')}
                className="flex-row items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-3 py-1.5 active:bg-gray-50"
              >
                <Plus size={14} color={canSaveDraft ? '#4b5563' : '#d1d5db'} />
                <Text className={`text-sm ${canSaveDraft ? 'text-gray-600' : 'text-gray-300'}`}>
                  {t('tx.search.templateSave')}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {templates.length === 0 && mode === 'idle' ? (
            <Text className="mt-2 text-xs leading-5 text-gray-500">
              {t('tx.search.templateEmpty')}
            </Text>
          ) : null}
          {mode === 'saving' ? (
            <View className="mt-3">
              <View className="flex-row items-center gap-2">
                <TextInput
                  autoFocus
                  value={name}
                  onChangeText={setName}
                  onSubmitEditing={submitSave}
                  returnKeyType="done"
                  placeholder={t('tx.search.templateName')}
                  placeholderTextColor="#9ca3af"
                  className={INPUT_CLASS}
                />
                <Pressable
                  disabled={!trimmed || !canSaveDraft}
                  onPress={submitSave}
                  className={`rounded-lg px-3 py-2 ${
                    !trimmed || !canSaveDraft ? 'bg-gray-300' : 'bg-blue-600 active:bg-blue-700'
                  }`}
                >
                  <Text className="text-sm font-semibold text-white">{t('common.save')}</Text>
                </Pressable>
                <Pressable
                  hitSlop={6}
                  onPress={() => {
                    setName('');
                    setMode('idle');
                  }}
                >
                  <Text className="text-sm text-gray-500">{t('common.cancel')}</Text>
                </Pressable>
              </View>
              {willOverwrite ? (
                <Text className="mt-2 text-xs leading-5 text-gray-500">
                  {t('tx.search.templateOverwrite')}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
