/*
 * 태그를 만들고 고치고 지우는 자리.
 *
 * 카테고리 화면 안의 한 탭으로 산다. 둘 다 "거래를 무엇으로 묶어 보나"를 정하는 일이고,
 * 태그는 계층이 없어 화면 하나를 따로 둘 만큼 크지 않다.
 *
 * 카테고리와 달리 **지우기를 막지 않는다.** 태그를 떼어 내도 거래는 온전하고 분류별
 * 합계도 그대로다. 막아 두면 오래된 태그를 영영 정리하지 못한다.
 *
 * 대신 붙은 데가 있으면 **무엇을 할지 묻는다**(`TagDeleteModal`). 붙은 데가 없으면
 * 지금까지처럼 한 번 물어보고 지운다 -- 고를 것이 하나뿐인 물음은 물음이 아니다.
 */
import { useEffect, useState } from 'react';
import { Alert, LayoutAnimation, Pressable, Text, View } from 'react-native';
import { Receipt, X } from 'lucide-react-native';
import type { TagDto } from '@money/types';

import { EMPTY_TAG_FORM, useTagManager, type TagFormValues } from '@money/core/hooks/useTagManager';
import { EMPTY_SEARCH } from '@money/core/hooks/useTransactions';
import { useTranslation } from '@money/core/lib/i18n';
import { useEntryFocus } from '@money/core/store/entry-focus';

import { useNavigation } from '../shell/navigation';
import Modal from './Modal';
import TagDeleteModal from './TagDeleteModal';
import AddButton from './AddButton';
import MoveRow from './MoveRow';
import DragList from './DragList';
import { TagFields } from './TagFields';

/** 목록이 늘고 줄 때의 움직임. 새 줄은 옅은 데서 떠오르고 아래는 밀려 내려간다. */
const SHIFT = LayoutAnimation.create(180, 'easeInEaseOut', 'opacity');

export default function TagsPanel({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation();
  const manager = useTagManager(projectId);
  const nav = useNavigation();
  /** 거래 화면과 주고받는 쪽지. 분류 화면의 것과 같은 자리를 쓴다. */
  const focusEntries = useEntryFocus((state) => state.focusEntries);
  const reopen = useEntryFocus((state) => state.reopen);
  const clearReopen = useEntryFocus((state) => state.clearReopen);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<TagFormValues>(EMPTY_TAG_FORM);
  const [error, setError] = useState('');

  const openNew = () => {
    setEditingId(null);
    setValues(EMPTY_TAG_FORM);
    setError('');
    setIsFormOpen(true);
  };

  const openEdit = (tag: TagDto.Response) => {
    setEditingId(tag.id);
    setValues(manager.formValuesOf(tag));
    setError('');
    setIsFormOpen(true);
  };

  /*
   * 거래 화면에서 ←로 돌아왔을 때 떠나온 태그 창을 다시 편다.
   *
   * 목록이 도착해야 그 태그를 찾을 수 있으므로 올 때까지 기다린다. 지운 태그로
   * 돌아오는 일도 있어(다른 기기에서 지웠다) 못 찾으면 아무것도 하지 않는다.
   */
  useEffect(() => {
    if (reopen?.kind !== 'tag') return;

    const tag = manager.tags.find((item) => item.id === reopen.id);
    if (!tag) return;

    openEdit(tag);
    clearReopen();
    // openEdit 은 렌더마다 새로 만들어지는 함수라 의존성에 넣지 않는다. 여는 일은
    // 쪽지와 목록이 갖춰졌을 때 한 번이면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen, manager.tags, clearReopen]);

  /** 이 태그가 붙은 거래내역을 본다. */
  const showEntriesOf = (tag: TagDto.Response) => {
    focusEntries({ kind: 'tag', id: tag.id }, { ...EMPTY_SEARCH, tagIds: [tag.id] });
    setIsFormOpen(false);
    nav.go('/transactions');
  };

  const submit = async () => {
    const result = await manager.save(editingId, values);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // 목록이 한 줄 늘거나 이름이 바뀐다. 그 자리가 움직이는 것을 보이게 한다.
    LayoutAnimation.configureNext(SHIFT);
    setIsFormOpen(false);
  };

  /** 없애려던 태그와 그 태그가 붙은 자리의 수. 둘 다 있을 때만 묻는 창이 열린다. */
  const [removing, setRemoving] = useState<{
    tag: TagDto.Response;
    usage: TagDto.UsageResponse;
  } | null>(null);

  /** 지운 뒤의 뒷정리. 목록이 한 줄 줄어드는 것을 보이게 한다. */
  const afterRemoved = (result: { ok: boolean; message?: string }) => {
    if (!result.ok) return result;
    LayoutAnimation.configureNext(SHIFT);
    return result;
  };

  /**
   * 없애기를 누르면 먼저 센다.
   *
   * 붙은 데가 없으면 물어볼 것이 없어 지금까지처럼 한 번 묻고 지운다. 세지 못하면
   * (연결이 없다) 그 길로 간다 -- 옮기기는 어차피 서버가 있어야 하고, 떼고 없애기는
   * 사본에서도 된다.
   */
  const remove = async (tag: TagDto.Response) => {
    const usage = await manager.usageOf(tag.id);
    const attached = usage ? usage.entries + usage.drafts + usage.rules : 0;

    if (!usage || attached === 0) {
      Alert.alert(t('tags.deleteConfirm', { name: tag.name }), t('tags.deleteConfirmBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('entryForm.delete'),
          style: 'destructive',
          onPress: () => {
            void manager.remove(tag.id).then((result) => {
              if (!result.ok) setError(result.message);
              else afterRemoved(result);
            });
          },
        },
      ]);
      return;
    }

    setError('');
    setRemoving({ tag, usage });
  };

  return (
    <View className="gap-4">
      {error ? (
        <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <Text className="text-sm text-red-600">{error}</Text>
        </View>
      ) : null}

      {/* 추가 버튼은 목록 바로 위다 (자산·분류 화면과 같은 규칙). */}
      <AddButton label={t('tags.add')} onPress={openNew} />

      {/*
        다시 읽는 동안에는 목록을 치우지 않는다.

        치우면 그 순간 화면이 짧아져 스크롤이 맨 위로 튄다. 끌어다 놓은 직후가 바로 그
        자리다 -- 방금 옮긴 줄을 보고 있어야 하는데 목록의 처음으로 되돌아간다.
      */}
      {manager.isLoading && manager.tags.length === 0 ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : manager.tags.length === 0 ? (
        <Text className="text-gray-600">{t('tags.empty')}</Text>
      ) : (
        /* 길게 누르면 끌어서 자리를 바꾼다. 짧게 누르면 여느 때처럼 고치기가 열린다. */
        <DragList
          items={manager.tags}
          itemClassName="flex-row items-center gap-3 rounded-lg bg-white p-4 shadow-sm active:bg-gray-50"
          onPressItem={openEdit}
          onReorder={(id, toIndex) => {
            void manager.moveTo(id, toIndex).then((result) => {
              setError(result.ok ? '' : result.message);
            });
          }}
          renderItem={(tag) => (
            <>
              {/* 색을 정한 태그는 점으로 보인다. 이름만으로는 목록에서 찾기 어렵다. */}
              <View
                className={`h-3 w-3 rounded-full ${tag.color ? '' : 'border border-gray-300'}`}
                style={tag.color ? { backgroundColor: tag.color } : undefined}
              />
              <Text className="flex-1 font-medium text-gray-900">{tag.name}</Text>
              <Pressable
                onPress={() => void remove(tag)}
                hitSlop={8}
                accessibilityLabel={t('entryForm.delete')}
                className="p-1"
              >
                <X size={18} color="#9ca3af" />
              </Pressable>
            </>
          )}
        />
      )}

      <TagDeleteModal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        tag={removing?.tag ?? null}
        tags={manager.tags}
        usage={removing?.usage ?? { entries: 0, drafts: 0, rules: 0 }}
        isSubmitting={manager.isSubmitting}
        onMove={(toId) => manager.merge(removing!.tag.id, toId).then(afterRemoved)}
        onDrop={() => manager.remove(removing!.tag.id).then(afterRemoved)}
        /*
          거래내역으로 건너갈 때는 없애지 않는다. 손으로 손보고 돌아와 다시 누르는
          길이라, 여기서 지우면 돌아올 태그가 없다.
        */
        onVisit={() => {
          const tag = removing?.tag;
          setRemoving(null);
          if (tag) showEntriesOf(tag);
        }}
      />

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={t(editingId ? 'tags.edit' : 'tags.add')}
        /*
          이 태그가 붙은 거래내역으로 건너간다. 새로 만드는 중에는 볼 것이 없으므로
          고치는 창에만 선다.
        */
        headerAction={
          editingId ? (
            <Pressable
              onPress={() => {
                const tag = manager.tags.find((item) => item.id === editingId);
                if (tag) showEntriesOf(tag);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('tags.viewEntries')}
              className="h-8 w-8 items-center justify-center rounded-lg active:bg-gray-100"
            >
              <Receipt size={18} color="#111827" />
            </Pressable>
          ) : null
        }
        footer={
          <Pressable
            disabled={manager.isSubmitting}
            onPress={submit}
            className={`items-center rounded-lg bg-blue-600 px-4 py-3 ${
              manager.isSubmitting ? 'opacity-50' : ''
            }`}
          >
            <Text className="text-base font-semibold text-white">
              {t(manager.isSubmitting ? 'common.saving' : 'common.save')}
            </Text>
          </Pressable>
        }
      >
        <View className="gap-5">
          {/* 창이 열려 있으면 아래 목록의 알림줄은 가려진다. 여기에도 적는다. */}
          {error ? (
            <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          ) : null}

          <TagFields values={values} onChange={setValues} />

          {/*
            순서는 **만든 뒤에** 옮긴다. 아직 없는 줄에는 이웃이 없다.

            이름·색과 달리 누르는 즉시 저장된다. 그래야 목록이 곧바로 그 자리로 움직이는
            것이 보이고, 저장 버튼이 이름과 순서 둘을 함께 지고 있지 않게 된다.
          */}
          {editingId ? (
            <MoveRow
              disabled={manager.isSubmitting}
              onMove={(step) => {
                LayoutAnimation.configureNext(SHIFT);
                void manager.move(editingId, step).then((result) => {
                  setError(result.ok ? '' : result.message);
                });
              }}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
