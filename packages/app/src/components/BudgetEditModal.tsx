import { Pressable, Text, TextInput, View } from 'react-native';

import type { BudgetEditor, BudgetScope } from '@money/core/hooks/useBudgetEditor';
import { formatMonthShort, formatYearOnly } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';

import BudgetScheduleList from './BudgetScheduleList';
import { Select } from './FormFields';
import Modal from './Modal';

/** 여러 달을 한꺼번에 바꾸는 두 가지 방법 (웹의 BudgetEditModal 과 같다). */
const BUDGET_SCOPE_OPTIONS: Array<{
  value: BudgetScope;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}> = [
  { value: 'all', labelKey: 'budget.scopeAll', descriptionKey: 'budget.scopeAllHint' },
  { value: 'from', labelKey: 'budget.scopeFrom', descriptionKey: 'budget.scopeFromHint' },
];

/**
 * 고를 수 있는 연도. 올해 앞뒤로 다섯 해씩이다.
 *
 * 지나간 달의 예산을 고치는 일도, 몇 달 뒤부터 줄이겠다고 미리 넣는 일도 있어 양쪽을 둔다.
 * 들고 있는 값의 연도는 언제나 목록에 넣는다 -- 목록 밖이면 고른 값이 사라져 보인다.
 */
function yearOptions(current: number): number[] {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, index) => thisYear - 5 + index);
  if (!years.includes(current)) years.push(current);
  return years.sort((a, b) => a - b);
}

/**
 * 분류 하나(또는 합계)의 예산 팝업. 웹의 BudgetEditModal 과 같은 모양과 같은 훅이다.
 */
export default function BudgetEditModal({
  editor,
  projectId,
  name,
  yearMonth,
}: {
  editor: BudgetEditor;
  projectId: string | null;
  name: string;
  yearMonth: string;
}) {
  const { t } = useTranslation();
  const editingBudget = editor.target?.existing;

  /* '고른 달부터'의 시작 달. 웹의 <input type="month"> 자리를 연·월 두 칸으로 대신한다. */
  const [fromYear, fromMonth] = (editor.fromMonth || yearMonth).split('-').map(Number);
  const pickFrom = (nextYear: number, nextMonth: number) =>
    editor.setFromMonth(`${nextYear}-${String(nextMonth).padStart(2, '0')}`);

  return (
    <Modal
      isOpen={editor.isOpen}
      onClose={editor.close}
      title={t('budget.modalTitle', { name })}
      footer={
        <View className="flex-row gap-2">
          <Pressable
            onPress={editor.close}
            className="flex-1 items-center rounded-lg border border-gray-300 px-4 py-2 active:bg-gray-50"
          >
            <Text className="text-gray-700">{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            onPress={editor.submit}
            disabled={editor.isSubmitting}
            className={`flex-1 items-center rounded-lg px-4 py-2 ${
              editor.isDeleting ? 'bg-red-600' : 'bg-blue-600'
            } ${editor.isSubmitting ? 'opacity-50' : editor.isDeleting ? 'active:bg-red-700' : 'active:bg-blue-700'}`}
          >
            <Text className="text-white">
              {editor.isSubmitting
                ? t('common.saving')
                : editor.isDeleting
                  ? t('budget.deleteAction')
                  : t('common.save')}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View className="gap-4">
        <View>
          <Text className="mb-2 text-sm font-medium text-gray-700">{t('budget.monthlyAmount')}</Text>
          <TextInput
            value={String(editor.amount)}
            onChangeText={(text) => editor.setAmount(parseInt(text, 10) || 0)}
            keyboardType="number-pad"
            autoFocus
            onSubmitEditing={editor.submit}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
          />
        </View>

        {/*
          적용 범위. 규칙이 아직 없으면 고를 것이 없다. 새로 만드는 예산은 모든 달에
          적용된다 (기간을 나누는 것은 이미 있는 규칙을 끊는 일이다).
        */}
        {editingBudget ? (
          <View>
            <Text className="mb-2 text-sm font-medium text-gray-700">{t('budget.scope')}</Text>
            <View className="gap-2">
              {BUDGET_SCOPE_OPTIONS.map((option) => {
                const selected = editor.scope === option.value;
                return (
                  <View key={option.value}>
                    <Pressable
                      onPress={() => editor.setScope(option.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      className="flex-row items-start gap-2"
                    >
                      {/* 동그라미 단추. 웹의 라디오와 같은 자리, 같은 파랑이다. */}
                      <View
                        className={`mt-0.5 h-4 w-4 items-center justify-center rounded-full border ${
                          selected ? 'border-blue-600' : 'border-gray-300'
                        }`}
                      >
                        {selected ? <View className="h-2 w-2 rounded-full bg-blue-600" /> : null}
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm text-gray-900">{t(option.labelKey)}</Text>
                        <Text className="text-xs text-gray-500">{t(option.descriptionKey)}</Text>
                      </View>
                    </Pressable>

                    {option.value === 'from' && selected ? (
                      <View className="ml-6 mt-2 flex-row gap-2">
                        <View className="flex-1">
                          <Select
                            value={String(fromYear)}
                            options={yearOptions(fromYear).map((year) => ({
                              value: String(year),
                              label: formatYearOnly(year),
                            }))}
                            onSelect={(next) => pickFrom(Number(next), fromMonth)}
                          />
                        </View>
                        <View className="flex-1">
                          <Select
                            value={String(fromMonth)}
                            options={Array.from({ length: 12 }, (_, index) => ({
                              value: String(index + 1),
                              label: formatMonthShort(index + 1),
                            }))}
                            onSelect={(next) => pickFrom(fromYear, Number(next))}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <Text className="mt-2 text-xs text-gray-500">
              {editor.scope === 'all' ? t('budget.zeroHintAll') : t('budget.zeroHintFrom')}
            </Text>
          </View>
        ) : (
          <Text className="text-xs text-gray-500">{t('budget.newHint')}</Text>
        )}

        {editor.error ? (
          <View className="rounded border border-red-200 bg-red-50 p-3">
            <Text className="text-sm text-red-600">{editor.error}</Text>
          </View>
        ) : null}

        {/* 월별 목록. 규칙이 있어야 달마다 얼마인지가 정해진다. */}
        {editingBudget && editor.target ? (
          <BudgetScheduleList
            projectId={projectId}
            categoryId={editor.target.apiCategoryId}
            tagId={editor.target.tagId}
            type={editor.target.type}
            startMonth={yearMonth}
            reloadToken={editor.scheduleToken}
            onChange={editor.reload}
          />
        ) : null}
      </View>
    </Modal>
  );
}
