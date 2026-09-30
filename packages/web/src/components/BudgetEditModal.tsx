'use client';

import type { BudgetEditor, BudgetScope } from '@money/core/hooks/useBudgetEditor';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';

import BudgetScheduleList from './BudgetScheduleList';
import Modal from './Modal';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const BUDGET_FORM_ID = 'budget-edit-form';

/**
 * 여러 달을 한꺼번에 바꾸는 두 가지 방법.
 *
 * 서버가 다르게 처리한다. 'all'은 규칙의 금액을 고치고, 'from'은 규칙을 앞
 * 달까지로 끊은 뒤 그 달부터 새 규칙을 만든다.
 *
 * 한 달만 바꾸는 일은 여기 없다. 아래 월별 목록에서 그 줄을 직접 고친다.
 * 같은 입력 칸이 "모든 달"도 되고 "이 달만"도 되면 어느 쪽이 걸리는지 알 수 없다.
 */
const BUDGET_SCOPE_OPTIONS: Array<{
  value: BudgetScope;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}> = [
  { value: 'all', labelKey: 'budget.scopeAll', descriptionKey: 'budget.scopeAllHint' },
  { value: 'from', labelKey: 'budget.scopeFrom', descriptionKey: 'budget.scopeFromHint' },
];

/**
 * 분류 하나(또는 합계)의 예산 팝업. 분류가 정해져 있으므로 금액과 적용 범위만 받는다.
 *
 * 가계 화면의 분류별 상세와 홈의 예산 설정 화면이 함께 쓴다. 상태와 저장은
 * core 의 useBudgetEditor 가 들고, 앱의 같은 팝업도 그 훅을 쓴다.
 */
export default function BudgetEditModal({
  editor,
  projectId,
  name,
  yearMonth,
}: {
  editor: BudgetEditor;
  projectId: string | null;
  /** 제목에 들어갈 분류 이름 ("식비 예산") */
  name: string;
  /** 보고 있는 달. 월별 목록이 여기서 시작한다. */
  yearMonth: string;
}) {
  const { t } = useTranslation();
  const editingBudget = editor.target?.existing;

  return (
    <Modal
      isOpen={editor.isOpen}
      onClose={editor.close}
      title={t('budget.modalTitle', { name })}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={editor.close}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form={BUDGET_FORM_ID}
            disabled={editor.isSubmitting}
            className={`flex-1 px-4 py-2 text-white rounded-lg transition disabled:opacity-50 ${
              editor.isDeleting ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {editor.isSubmitting
              ? t('common.saving')
              : editor.isDeleting
                ? t('budget.deleteAction')
                : t('common.save')}
          </button>
        </div>
      }
    >
      <form
        id={BUDGET_FORM_ID}
        onSubmit={(e) => {
          e.preventDefault();
          editor.submit();
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('budget.monthlyAmount')}
          </label>
          <input
            type="number"
            min="0"
            autoFocus
            value={editor.amount}
            onChange={(e) => editor.setAmount(parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/*
          적용 범위.

          규칙이 아직 없으면 고를 것이 없다. 새로 만드는 예산은 모든 달에 적용된다.
          (기간을 나누는 것은 이미 있는 규칙을 끊는 일이라 끊을 규칙이 있어야 한다)
        */}
        {editingBudget ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('budget.scope')}</label>
            <div className="space-y-2">
              {BUDGET_SCOPE_OPTIONS.map((option) => (
                <div key={option.value}>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="budget-scope"
                      value={option.value}
                      checked={editor.scope === option.value}
                      onChange={() => editor.setScope(option.value)}
                      className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm">
                      <span className="text-gray-900">{t(option.labelKey)}</span>
                      <span className="block text-xs text-gray-500">
                        {t(option.descriptionKey)}
                      </span>
                    </span>
                  </label>

                  {/*
                    시작 월 선택. label 밖에 둔다. 안에 넣으면 달을 고르려고 누른
                    클릭이 라디오까지 눌러 버린다.

                    고를 수 있는 달을 가두지 않는다. 지나간 달의 예산을 고치는 일도
                    있고, 몇 달 뒤부터 줄이겠다고 미리 넣는 일도 있다.
                  */}
                  {option.value === 'from' && editor.scope === 'from' && (
                    <input
                      type="month"
                      value={editor.fromMonth}
                      onChange={(e) => editor.setFromMonth(e.target.value)}
                      className="mt-2 ml-6 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {editor.scope === 'all' ? t('budget.zeroHintAll') : t('budget.zeroHintFrom')}
            </p>
          </div>
        ) : (
          <p className="text-xs text-gray-500">{t('budget.newHint')}</p>
        )}

        {editor.error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded text-sm">
            {editor.error}
          </div>
        )}
      </form>

      {/*
        월별 목록.

        규칙이 있어야 달마다 얼마인지가 정해진다. 아직 없으면 보여 줄 것이 없다.

        form 밖에 둔다. 안에 두면 목록의 금액 칸에서 Enter를 쳤을 때 위쪽 폼이
        제출되어, "이 달만" 고치려던 값이 모든 달에 걸린다.
      */}
      {editingBudget && editor.target && (
        <div className="mt-4">
          <BudgetScheduleList
            projectId={projectId}
            categoryId={editor.target.apiCategoryId}
            tagId={editor.target.tagId}
            type={editor.target.type}
            startMonth={yearMonth}
            reloadToken={editor.scheduleToken}
            onChange={editor.reload}
          />
        </div>
      )}
    </Modal>
  );
}
