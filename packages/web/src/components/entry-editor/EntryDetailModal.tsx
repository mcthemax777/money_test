'use client';

/*
 * 거래 상세 팝업. 가계·자산 화면에서 거래 한 줄을 누르면 뜬다.
 *
 * 읽기만 한다. 고치기·베끼기·지우기·페이백 추가는 부르는 쪽(EntryEditor)이 받아 처리한다.
 */
import { Copy } from 'lucide-react';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';
import { useTranslation } from '@money/core/lib/i18n';
import { entryAmountLook } from '@money/core/lib/entries';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { formatDateTime } from '@money/core/lib/datetime';
import type { Account, Card } from '@money/core/lib/types';
import DetailField from '@/components/DetailField';
import Modal from '@/components/Modal';
import PaybackSection from '@/components/PaybackSection';
import type { EntryListItem } from '@/components/TransactionItem';
import { ENTRY_KIND_KEY, isCopyableEntry, isEditableEntry, isSplitEntry } from './editor-form';

export default function EntryDetailModal({
  isOpen,
  onClose,
  entry,
  canEdit,
  isSubmitting,
  accounts,
  cards,
  paybackReload,
  onCopy,
  onEdit,
  onDelete,
  onAddPayback,
  onOpenPayback,
}: {
  isOpen: boolean;
  onClose: () => void;
  entry: EntryListItem | null;
  /** 읽기 전용 구성원이면 false. 아래 단추와 베끼기가 사라진다. */
  canEdit: boolean;
  isSubmitting: boolean;
  accounts: Account[];
  cards: Card[];
  /** 페이백을 저장한 횟수. 받은 페이백을 다시 읽게 한다. */
  paybackReload: number;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddPayback: (original: EntryListItem) => void;
  onOpenPayback: (payback: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('editor.detailTitle')}
      /*
        내용 복사. 머리글 오른쪽에 둔다 -- 아래 단추 자리는 이 거래를 고치고 지우는
        자리이고, 베끼기는 이 거래를 건드리지 않는 다른 일이다.
      */
      headerAction={
        entry && canEdit && isCopyableEntry(entry) ? (
          <button
            type="button"
            onClick={onCopy}
            aria-label={t('tx.detail.copy')}
            title={t('tx.detail.copy')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-900 transition-colors hover:bg-gray-100"
          >
            <Copy className="h-4 w-4" aria-hidden />
          </button>
        ) : null
      }
      footer={
        /*
          읽기 전용 구성원에게는 아래 단추가 없다. 상세는 그대로 읽을 수 있고,
          고치기와 지우기만 사라진다.
        */
        entry && canEdit ? (
          <div className="flex gap-2">
            {/*
              카드대금 결제와 잔액 조정은 이 폼으로 만들 수 없는 종류다.
              수정 폼에 담으면 지출로 바뀌어 버리므로 버튼 자체를 감춘다.
            */}
            {isEditableEntry(entry) ? (
              <button
                onClick={onEdit}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('account.editSubmit')}
              </button>
            ) : (
              <div className="flex-1 px-4 py-2 text-sm text-gray-500 bg-gray-50 rounded-lg text-center">
                {t('editor.adjustmentNotEditable')}
              </div>
            )}
            {/* 카드 거래도 계좌 거래와 똑같이 지운다. 청구서 잠금은 없다. */}
            <button
              onClick={onDelete}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              disabled={isSubmitting}
            >
              {t('account.deleteSubmit')}
            </button>
          </div>
        ) : null
      }
    >
      {entry && (
        <div className="space-y-4">
          <DetailField label={t('editor.methodLabel')}>
            {entry.cardId
              ? t('editor.methodCard')
              : entry.accountId
                ? t('editor.methodAccount')
                : t('editor.noMethod')}
          </DetailField>

          {/* 결제수단을 고르지 않은 거래는 이름을 적을 칸이 없다. */}
          {(entry.cardId || entry.accountId) && (
            <DetailField label={t(entry.cardId ? 'editor.methodCard' : 'editor.methodAccount')}>
              {entry.cardId
                ? cards.find((c) => c.id === entry.cardId)?.name || '-'
                : accounts.find((a) => a.id === entry.accountId)?.name || '-'}
            </DetailField>
          )}

          <DetailField label={t('editor.person')}>{entry.personName || t('editor.personNone')}</DetailField>

          {/*
            붙은 태그. 다른 칸과 달리 글자가 아니라 알약이다 -- 여럿이라 쉼표로 이으면
            어디까지가 태그 하나인지 읽어야 알 수 있다.
          */}
          {entry.tags.length > 0 && (
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('tags.pick')}</span>
              <div className="flex flex-wrap gap-1.5 rounded-lg bg-gray-50 px-3 py-2">
                {entry.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[13px] text-gray-700 shadow-sm"
                  >
                    {tag.color && (
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    )}
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <DetailField label={t('editor.kindLabel')}>
            {/* 환불도 갈래는 페이백이다. 종류로 이름을 고른다. */}
            {entry.kind === 'payback' && entry.paybackType === 'refund'
              ? t('editor.kind.refund')
              : ENTRY_KIND_KEY[entry.kind]
                ? t(ENTRY_KIND_KEY[entry.kind])
                : entry.kind}
          </DetailField>

          {/* 지출이면 받은 페이백과 "페이백 추가", 페이백이면 원거래의 날짜. */}
          <PaybackSection
            entry={entry}
            canEdit={canEdit}
            reloadToken={paybackReload}
            onAdd={onAddPayback}
            onOpen={onOpenPayback}
          />

          {/*
            나눈 거래는 줄을 그대로 풀어서 보여 준다.

            예전에는 "분할 N건"으로 뭉쳐 대표 분류 하나만 적었다. 목록이 줄로 펴 보여
            주는데 상세에서 다시 뭉치면, 눌러서 연 화면이 눌렀던 줄보다 적게 말한다.
            태그도 줄마다 다를 수 있어 여기서 함께 적는다. 차감은 아래 "차감·환불·페이백" 칸에 있다.
          */}
          {isSplitEntry(entry) ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.split')}</label>
              <div className="divide-y divide-gray-100 rounded-lg bg-gray-50">
                {entry.lines.map((line) => (
                  <div key={line.lineKey} className="px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-gray-900">
                        {line.parentCategoryName
                          ? `${line.parentCategoryName} · ${line.categoryName}`
                          : line.categoryName || '-'}
                      </span>
                      <span className="shrink-0 tabular-nums text-gray-900">
                        {formatCurrency(toNumber(line.amount), displayCurrency)}
                      </span>
                    </div>
                    {line.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        {line.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-gray-600"
                          >
                            {tag.color && (
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                            )}
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <DetailField label={t('editor.parentCategory')}>
                {entry.parentCategoryName || entry.categoryName || '-'}
              </DetailField>

              {entry.parentCategoryName && (
                <DetailField label={t('categories.subcategories')}>{entry.categoryName || '-'}</DetailField>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.amount')}</label>
            {/*
              부호와 색은 목록 한 줄과 같은 규칙을 쓴다 (core 의 entryAmountLook).
              되돌린 결제는 갈래가 지출인데 돈이 돌아온 쪽이라, 갈래만 보면 "--10,000"
              이 찍힌다.
            */}
            {(() => {
              const look = entryAmountLook(entry);
              return (
                <p
                  className={`px-3 py-2 bg-gray-50 rounded-lg text-lg font-bold ${
                    look.tone === 'income' ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {look.sign}
                  {formatCurrency(look.amount, displayCurrency)}
                </p>
              );
            })()}
            {/* 결제 자리에서 깎인 금액은 아래 "차감·환불·페이백" 칸에 줄별로 함께 적는다 (7-7). */}
            {/* 실적에서 뺀 카드 거래만 적는다. 센 것은 굳이 말할 것이 없다. */}
            {entry.cardId && !entry.countsPerformance && (
              <p className="mt-1 text-xs text-gray-500">
                {t('tx.detail.performance')} · {t('editor.performanceExcluded')}
              </p>
            )}
            {/* 차감을 실적에서 빼지 않은 거래. 기본과 다른 것만 적는다. */}
            {entry.cardId &&
              entry.countsPerformance &&
              entry.discountAmount &&
              !entry.discountCountsPerformance && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('tx.detail.performance')} · {t('editor.discountPerformanceKept')}
                </p>
              )}
          </div>

          <DetailField label={t('editor.description')}>{entry.description || '-'}</DetailField>

          {entry.merchant && <DetailField label={t('editor.merchantPlain')}>{entry.merchant}</DetailField>}

          {entry.detailedNote && <DetailField label={t('editor.memoPlain')}>{entry.detailedNote}</DetailField>}

          {entry.toAccountName && <DetailField label={t('editor.toAccount')}>{entry.toAccountName}</DetailField>}

          {/* 이체 수수료. 수수료가 없어도 0으로 보여준다 */}
          {entry.kind === 'transfer' && (
            <DetailField label={t('editor.transferFeePlain')}>
              {formatCurrency(entry.feeAmount ?? 0, displayCurrency)}
              {entry.feeCategoryName && (
                <span className="ml-2 text-sm text-gray-500">({entry.feeCategoryName})</span>
              )}
            </DetailField>
          )}

          <DetailField label={t('editor.date')}>
            {/* 시간을 입력하지 않은 거래는 날짜만 보여준다 */}
            {formatDateTime(entry.date, timeZone)}
          </DetailField>
        </div>
      )}
    </Modal>
  );
}
