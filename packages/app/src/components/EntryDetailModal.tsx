/*
 * 거래 상세. 읽기만 한다.
 *
 * 거래 화면은 훑어보는 자리라 줄을 누르면 고치는 폼이 아니라 이 상세가 뜬다. 목록 한
 * 줄이 담지 못한 것(가맹점, 메모, 할부 개월수, 원래 통화 금액, 분할 건수)을 여기서
 * 펼쳐 보여 준다.
 *
 * 값은 전부 목록 줄(`EntryListItem`)이 이미 들고 있다. 상세를 위해 서버에 다시 묻지
 * 않는다 -- 오프라인에서도 목록을 눌러 열려야 하고, 사본이 그 줄을 낼 수 있으면
 * 상세도 낼 수 있다.
 */
import { Text, View } from 'react-native';
import type { EntryListItem } from '@money/types';

import { formatDateTime } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

import Modal from './Modal';

/** 갈래 이름. 목록의 금액 색과 같은 뜻을 글자로 적는다. */
const KIND_KEY: Record<EntryListItem['kind'], MessageKey> = {
  income: 'editor.kind.income',
  expense: 'editor.kind.expense',
  transfer: 'editor.kind.transfer',
  card_payment: 'entry.cardPayment',
  adjustment: 'entry.adjustment',
};

/** 한 줄. 값이 비면 줄 자체를 만들지 않는다 (빈 칸을 늘어놓지 않는다). */
function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <View className="flex-row items-baseline justify-between gap-4 border-b border-gray-100 py-2.5">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="flex-1 text-right text-[15px] text-gray-900">{value}</Text>
    </View>
  );
}

export default function EntryDetailModal({
  entry,
  onClose,
}: {
  /** null 이면 닫힌 상태다. 여는 쪽이 고른 거래를 그대로 넘긴다. */
  entry: EntryListItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const currency = useProjectDisplayCurrency();

  const money = (value: string | null) =>
    value === null ? null : formatCurrency(value, currency);

  const categoryLabel = entry?.parentCategoryName
    ? `${entry.parentCategoryName} > ${entry.categoryName}`
    : entry?.categoryName ?? null;

  /** 어디서 나갔는가. 이체는 두 계좌를 화살표로 잇는다. */
  const methodLabel = (() => {
    if (!entry) return null;
    const to = entry.toAccountName ?? entry.cardName;
    if (entry.kind === 'transfer' && entry.accountName && to) return `${entry.accountName} → ${to}`;
    return entry.cardName ?? entry.accountName ?? null;
  })();

  const extra = entry ? toNumber(entry.extraAmount) : 0;
  const fee = entry?.feeAmount ? toNumber(entry.feeAmount) : 0;

  return (
    <Modal isOpen={entry !== null} onClose={onClose} title={t('tx.detail.title')}>
      {entry ? (
        <View>
          {/* 금액을 맨 위에 크게 둔다. 상세를 여는 까닭이 대개 "얼마였지"다. */}
          <Text className="mb-1 text-3xl font-bold text-gray-900">
            {formatCurrency(entry.amount, currency)}
          </Text>
          <Text className="mb-4 text-base text-gray-600">
            {entry.description || categoryLabel || t('entry.noTitle')}
          </Text>

          <Row label={t('tx.detail.kind')} value={t(KIND_KEY[entry.kind])} />
          <Row label={t('tx.detail.date')} value={formatDateTime(entry.date, timeZone)} />
          <Row label={t('tx.detail.person')} value={entry.personName} />
          <Row label={t('tx.detail.category')} value={categoryLabel} />
          <Row label={t('tx.detail.method')} value={methodLabel} />
          <Row label={t('tx.detail.merchant')} value={entry.merchant} />
          <Row
            label={entry.kind === 'income' ? t('tx.detail.extraIncome') : t('tx.detail.extra')}
            value={extra > 0 ? money(entry.extraAmount) : null}
          />
          <Row
            label={t('tx.detail.installment')}
            value={
              entry.installmentMonths
                ? t('tx.detail.installmentMonths', { months: entry.installmentMonths })
                : null
            }
          />
          <Row label={t('tx.detail.fee')} value={fee > 0 ? money(entry.feeAmount) : null} />
          {/*
            외화가 얽힌 거래만 원래 금액이 있다. 위 금액은 언제나 표시 통화 환산액이라,
            "$50.00" 을 함께 적지 않으면 명세서와 대조할 기준이 사라진다.
          */}
          <Row
            label={t('tx.detail.original')}
            value={
              entry.originalCurrency && entry.originalAmount
                ? formatCurrency(entry.originalAmount, entry.originalCurrency)
                : null
            }
          />
          <Row
            label={t('tx.detail.category')}
            value={entry.splitCount > 1 ? t('tx.detail.split', { count: entry.splitCount }) : null}
          />
          <Row label={t('tx.detail.note')} value={entry.detailedNote} />

          {/*
            붙은 태그. 다른 줄과 달리 글자가 아니라 알약이다 -- 여럿이라 쉼표로 이으면
            어디까지가 태그 하나인지 읽어야 알 수 있다.
          */}
          {entry.tags.length > 0 ? (
            <View className="flex-row items-start justify-between gap-4 border-b border-gray-100 py-2.5">
              <Text className="text-sm text-gray-500">{t('tags.pick')}</Text>
              <View className="flex-1 flex-row flex-wrap justify-end gap-1.5">
                {entry.tags.map((tag) => (
                  <View
                    key={tag.id}
                    className="flex-row items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1"
                  >
                    {tag.color ? (
                      <View
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                    ) : null}
                    <Text className="text-[13px] text-gray-700">{tag.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}
