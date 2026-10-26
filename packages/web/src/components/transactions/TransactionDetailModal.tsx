'use client';

/*
 * 거래 화면의 거래 상세 팝업. 줄을 누르면 뜬다.
 *
 * 읽기가 본론이고, 머리글 오른쪽에 베끼기·고치기·지우기 단추가 선다. 그 일은 부르는 쪽
 * (TransactionsView)이 받아 편집기를 연다.
 */
import { Copy, Pencil, Trash2 } from 'lucide-react';
import type { EntryListItem as EntryListItemDto } from '@money/types';
import { formatDateTime } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { installmentLabel } from '@money/core/lib/period-ledger';
import { useCanEdit, useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';
import { isCopyableEntry, isEditableEntry } from '@/components/EntryEditor';
import Modal from '@/components/Modal';
import PaybackSection from '@/components/PaybackSection';

export default function TransactionDetailModal({
  detail,
  onClose,
  isDeleting,
  onCopy,
  onEdit,
  onDelete,
  onAddPayback,
  onOpen,
}: {
  /** 펼친 거래. null 이면 닫혀 있다. */
  detail: EntryListItemDto | null;
  onClose: () => void;
  isDeleting: boolean;
  onCopy: (entry: EntryListItemDto) => void;
  onEdit: (entry: EntryListItemDto) => void;
  onDelete: () => void;
  onAddPayback: (original: EntryListItemDto) => void;
  /** 받은 페이백이나 원거래를 눌렀을 때. 그 거래로 상세를 갈아 끼운다. */
  onOpen: (entry: EntryListItemDto) => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const currency = useProjectDisplayCurrency();
  /** 읽기 전용 구성원에게는 베끼기·고치기 단추를 그리지 않는다. */
  const canEdit = useCanEdit();

  /**
   * 상세에 베끼기·고치기 단추를 그릴지.
   *
   * 규칙은 둘 다 편집기가 갖는다(`isCopyableEntry`, `isEditableEntry`). 못 다루는
   * 거래에 단추를 남기면 눌러도 값이 빠진 폼이 뜬다. 두 규칙이 갈리는 것은 분할
   * 거래다 -- 고칠 수는 있고, 베끼면 줄들이 합쳐진 한 건이 새로 남는다.
   */
  const canCopy = detail !== null && canEdit && isCopyableEntry(detail);
  const canEditDetail = detail !== null && canEdit && isEditableEntry(detail);
  /**
   * 상세에 지우기 단추를 그릴지.
   *
   * 고치기와 달리 갈래를 가리지 않는다. 잔액 조정도 지울 수는 있다 -- 폼이 못 다루는
   * 것과 없애지 못하는 것은 다른 이야기다. 읽기 전용 구성원에게만 없다.
   */
  const canDelete = detail !== null && canEdit;

  const detailRows: Array<{ label: string; value: string | null }> = detail
    ? [
        { label: t('tx.detail.date'), value: formatDateTime(detail.date, timeZone) },
        // 사람을 비운 거래는 이름이 빈 글자로 온다.
        { label: t('tx.detail.person'), value: detail.personName || t('tx.noPerson') },
        // 돌려받은 돈은 종류를 적는다. 목록에는 아이콘만 서서 환불인지 캐시백인지 여기서 안다.
        {
          label: t('tx.detail.kind'),
          value:
            detail.kind === 'payback'
              ? t(detail.paybackType === 'refund' ? 'editor.kind.refund' : 'editor.kind.payback')
              : null,
        },
        {
          label: t('tx.detail.category'),
          value: detail.parentCategoryName
            ? `${detail.parentCategoryName} > ${detail.categoryName}`
            : detail.categoryName,
        },
        {
          label: t('tx.detail.method'),
          value: detail.cardName ?? detail.accountName,
        },
        { label: t('tx.detail.merchant'), value: detail.merchant },
        {
          label: t('tx.detail.installment'),
          /*
            유이자면 그중 얼마가 이자인지 함께 적는다 -- 이자는 금액 안에 들어 있어,
            적어 두지 않으면 산 값보다 큰 까닭이 화면 어디에도 없다.
          */
          value: installmentLabel(t, detail, (amount) => formatCurrency(amount, currency)),
        },
        {
          label: t('tx.detail.fee'),
          value:
            detail.feeAmount && toNumber(detail.feeAmount) > 0
              ? formatCurrency(detail.feeAmount, currency)
              : null,
        },
        {
          label: t('tx.detail.original'),
          value:
            detail.originalCurrency && detail.originalAmount
              ? formatCurrency(detail.originalAmount, detail.originalCurrency)
              : null,
        },
        {
          // 이름표에는 값의 문구(`분할 {count}건`)를 쓰지 않는다. 줄의 이름표가 React 키라 위의
          // "분류" 줄과도 달라야 한다.
          label: t('editor.split'),
          value: detail.splitCount > 1 ? t('tx.detail.split', { count: detail.splitCount }) : null,
        },
        { label: t('tx.detail.note'), value: detail.detailedNote },
      ]
    : [];

  return (
    <Modal
      isOpen={detail !== null}
      onClose={onClose}
      title={t('tx.detail.title')}
      /*
        베끼기와 고치기. 머리글 오른쪽에 나란히 둔다.

        베끼기는 이 거래를 건드리지 않고 같은 내용의 새 거래를 적는 일이고, 고치기는
        이 거래를 그대로 연다. 둘 다 상세를 닫고 폼을 세운다 -- 팝업 둘이 겹치면
        뒤로가기가 어느 것을 닫는지 알 수 없다.

        아이콘은 둘 다 먹색이다. 나란히 선 두 단추에 서로 다른 색을 주면 한쪽이 더
        중요한 일처럼 읽히는데, 여기서는 어느 쪽을 고를지가 하려는 일에 달렸다.
      */
      headerAction={
        <>
          {canCopy ? (
            <button
              type="button"
              onClick={() => {
                if (!detail) return;
                onCopy(detail);
              }}
              aria-label={t('tx.detail.copy')}
              title={t('tx.detail.copy')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-900 transition-colors hover:bg-gray-100"
            >
              <Copy className="h-4 w-4" aria-hidden />
            </button>
          ) : null}

          {canEditDetail ? (
            <button
              type="button"
              onClick={() => {
                if (!detail) return;
                onEdit(detail);
              }}
              aria-label={t('tx.detail.edit')}
              title={t('tx.detail.edit')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-900 transition-colors hover:bg-gray-100"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
          ) : null}

          {/*
            지우기. 되돌릴 수 없는 일이라 빨강이다 -- 베끼기·고치기와 나란히 서지만
            그 둘과 같은 먹색으로 두면 잘못 누르기 쉽다. 이 화면의 고른 것 지우기
            단추와도 같은 색이다.
          */}
          {canDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label={t('tx.detail.delete')}
              title={t('tx.detail.delete')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </>
      }
    >
      {detail ? (
        <div>
          <p className="mb-1 text-3xl font-bold text-gray-900">{formatCurrency(detail.amount, currency)}</p>
          <p className="mb-4 text-base text-gray-600">{detail.description || t('entry.noTitle')}</p>
          {detailRows
            .filter((row) => row.value)
            .map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-4 border-b border-gray-100 py-2.5"
              >
                <span className="text-sm text-gray-500">{row.label}</span>
                <span className="flex-1 text-right text-[15px] text-gray-900">{row.value}</span>
              </div>
            ))}

          {/*
            붙은 태그. 위의 줄들과 달리 글자가 아니라 알약이라 `detailRows` 에 담지 않는다 --
            여럿을 쉼표로 이으면 어디까지가 태그 하나인지 읽어야 알 수 있다.
          */}
          {detail.tags.length > 0 ? (
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2.5">
              <span className="text-sm text-gray-500">{t('tags.pick')}</span>
              <div className="flex flex-1 flex-wrap justify-end gap-1.5">
                {detail.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[13px] text-gray-700"
                  >
                    {tag.color ? (
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    ) : null}
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* 지출이면 받은 페이백과 "페이백 추가", 페이백이면 원거래의 날짜. */}
          <div className="pt-3">
            <PaybackSection
              entry={detail}
              layout="rows"
              canEdit={canEdit}
              onAdd={onAddPayback}
              onOpen={onOpen}
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
