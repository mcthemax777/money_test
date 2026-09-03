/*
 * 검색. 기간·유형·분류·자산으로 거래를 좁힌다.
 *
 * 규칙은 **같은 칸에서 고른 것끼리 또는(OR), 칸끼리는 그리고(AND)** 다. 계좌와 카드는
 * 한 칸으로 본다. 규칙 자체는 `@money/types` 의 parseEntrySearch 가 갖고, 서버와 사본이
 * 같은 것을 쓴다.
 *
 * 고르는 동안에는 목록을 바꾸지 않는다. 확인을 눌러야 적용되고, 그 전에는 몇 개를
 * 골랐는지만 버튼에 적는다. 누를 때마다 다시 조회하면 분류를 셋 고르는 사이에 세 번
 * 왕복하고, 그중 두 번은 사용자가 보려던 것이 아니다.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { AccountDto, CardDto, CategoryDto } from '@money/types';

import { SEARCHABLE_ENTRY_KINDS } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';
import {
  EMPTY_SEARCH,
  ENTRY_KIND_LABEL,
  searchRange,
  type TransactionSearch,
} from '@money/core/hooks/useTransactions';

import Modal from './Modal';

/** 고를 수 있는 알약 하나. 고른 것은 파란 알약이다 (앱의 다른 고르는 자리와 같다). */
function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-3 py-1.5 ${
        selected ? 'border-blue-600 bg-blue-50' : 'border-gray-300 bg-white'
      }`}
    >
      <Text className={`text-sm ${selected ? 'font-medium text-blue-600' : 'text-gray-700'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
        {title}
      </Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}

function toggle<T extends string>(ids: T[], id: T): T[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

export default function TransactionSearchModal({
  isOpen,
  onClose,
  onApply,
  current,
  categories,
  accounts,
  cards,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApply: (search: TransactionSearch) => void;
  /** 지금 적용된 검색. 다시 열면 이 상태에서 이어 고른다. */
  current: TransactionSearch;
  categories: CategoryDto.Response[];
  accounts: AccountDto.Response[];
  cards: CardDto.Response[];
}) {
  const { t } = useTranslation();
  /** 고르는 중인 것. 확인을 누를 때까지 화면의 목록은 그대로다. */
  const [draft, setDraft] = useState<TransactionSearch>(current);

  // 열 때마다 지금 적용된 것에서 시작한다. 닫고 다시 열면 지난 초안이 남으면 안 된다.
  useEffect(() => {
    if (isOpen) setDraft(current);
  }, [isOpen, current]);

  /** 고른 기간. 두 칸이 온전할 때만 선다. */
  const range = searchRange(draft);
  /**
   * 적다 만 기간인가. 한 칸만 적었거나, 실재하지 않는 날짜이거나, 앞뒤가 뒤집힌 것.
   *
   * 이 상태에서는 적용을 막는다. 그냥 흘려보내면 기간을 적었는데 걸리지 않는 것이
   * 되어, 사용자는 검색이 고장 났다고 읽는다. 앱에는 달력 입력이 없어 글자로 받으므로
   * (거래 입력 화면과 같다) 이 검사가 웹보다 더 필요하다.
   */
  const isRangeBroken = Boolean(draft.startDate || draft.endDate) && range === null;

  const count =
    draft.categoryIds.length +
    draft.paymentAccountIds.length +
    draft.paymentCardIds.length +
    draft.kinds.length +
    (range ? 1 : 0);
  const isEmpty = categories.length === 0 && accounts.length === 0 && cards.length === 0;

  /** 대분류는 이름만, 소분류는 "대분류 > 소분류". 같은 이름의 소분류가 여럿 있다. */
  const labelOf = (category: CategoryDto.Response) => {
    const parent = categories.find((row) => row.id === category.parentId);
    return parent ? `${parent.name} > ${category.name}` : category.name;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('tx.search')}
      footer={
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => setDraft(EMPTY_SEARCH)}
            className="rounded-lg border border-gray-300 px-4 py-3 active:bg-gray-50"
          >
            <Text className="text-sm font-medium text-gray-700">{t('tx.search.clear')}</Text>
          </Pressable>
          <Pressable
            disabled={isRangeBroken}
            onPress={() => {
              onApply(draft);
              onClose();
            }}
            className={`flex-1 items-center rounded-lg px-4 py-3 ${
              isRangeBroken ? 'bg-gray-300' : 'bg-blue-600 active:bg-blue-700'
            }`}
          >
            <Text className="text-base font-semibold text-white">
              {t('tx.search.apply')}
              {count > 0 ? ` (${count})` : ''}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View>
        {/*
          기간을 맨 위에 둔다. 무엇으로 좁히든 "언제"를 먼저 정하는 일이 많다.
          고를 수 있는 분류·자산이 없어도 이 칸은 그린다 -- 기간은 그 목록과 무관하다.

          달력 입력이 없어 글자로 받는다(거래 입력 화면과 같다). 그래서 모양이
          어긋난 값이 그대로 조회에 실리지 않도록 아래에서 막는다.
        */}
        <View className="mb-5">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('tx.search.period')}
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="mb-1 text-xs text-gray-500">{t('tx.search.periodFrom')}</Text>
              <TextInput
                value={draft.startDate}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, startDate: text }))}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
              />
            </View>
            <View className="flex-1">
              <Text className="mb-1 text-xs text-gray-500">{t('tx.search.periodTo')}</Text>
              <TextInput
                value={draft.endDate}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, endDate: text }))}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
              />
            </View>
          </View>
          {draft.startDate || draft.endDate ? (
            <Pressable
              onPress={() => setDraft((prev) => ({ ...prev, startDate: '', endDate: '' }))}
              className="mt-2 self-start"
            >
              <Text className="text-xs font-medium text-blue-600">
                {t('tx.search.periodClear')}
              </Text>
            </Pressable>
          ) : null}
          <Text
            className={`mt-2 text-xs leading-5 ${
              isRangeBroken ? 'text-red-600' : 'text-gray-500'
            }`}
          >
            {isRangeBroken ? t('tx.search.periodInvalid') : t('tx.search.periodHint')}
          </Text>
        </View>

        {isEmpty ? (
          <Text className="text-sm text-gray-600">{t('tx.search.empty')}</Text>
        ) : (
          <View>
            {/*
              유형을 이 아래 첫 칸으로 둔다. 넷뿐이고, 이체나 카드정산만 보려는 사람
              에게는 이 칸 하나로 끝난다. 분류 알약이 수십 개라 아래에 두면 굴려서 찾아야 한다.
            */}
            <Group title={t('tx.search.kinds')}>
              {SEARCHABLE_ENTRY_KINDS.map((kind) => (
                <Chip
                  key={kind}
                  label={t(ENTRY_KIND_LABEL[kind])}
                  selected={draft.kinds.includes(kind)}
                  onPress={() => setDraft((prev) => ({ ...prev, kinds: toggle(prev.kinds, kind) }))}
                />
              ))}
            </Group>
            <Text className="-mt-3 mb-5 text-xs leading-5 text-gray-500">
              {t('tx.search.kindHint')}
            </Text>

            {categories.length > 0 ? (
              <Group title={t('tx.search.categories')}>
                {categories.map((category) => (
                  <Chip
                    key={category.id}
                    label={labelOf(category)}
                    selected={draft.categoryIds.includes(category.id)}
                    onPress={() =>
                      setDraft((prev) => ({
                        ...prev,
                        categoryIds: toggle(prev.categoryIds, category.id),
                      }))
                    }
                  />
                ))}
              </Group>
            ) : null}

            {accounts.length > 0 ? (
              <Group title={t('tx.search.accounts')}>
                {accounts.map((account) => (
                  <Chip
                    key={account.id}
                    label={account.name}
                    selected={draft.paymentAccountIds.includes(account.id)}
                    onPress={() =>
                      setDraft((prev) => ({
                        ...prev,
                        paymentAccountIds: toggle(prev.paymentAccountIds, account.id),
                      }))
                    }
                  />
                ))}
              </Group>
            ) : null}

            {cards.length > 0 ? (
              <Group title={t('tx.search.cards')}>
                {cards.map((card) => (
                  <Chip
                    key={card.id}
                    label={card.name}
                    selected={draft.paymentCardIds.includes(card.id)}
                    onPress={() =>
                      setDraft((prev) => ({
                        ...prev,
                        paymentCardIds: toggle(prev.paymentCardIds, card.id),
                      }))
                    }
                  />
                ))}
                </Group>
              ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}
