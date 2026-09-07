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
import { Fragment, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import type { AccountDto, CardDto, CategoryDto, PersonDto, TagDto } from '@money/types';

import { NO_TAG, SEARCHABLE_ENTRY_KINDS } from '@money/types';

import {
  assetOwnerNames,
  groupByOwner,
  hasSeveralOwners,
  sortCardsByAccount,
} from '@money/core/lib/asset-owner';
import {
  groupCategoriesByType,
  isCategoryPicked,
  toggleCategory,
} from '@money/core/lib/category-tree';
import { useTranslation } from '@money/core/lib/i18n';
import {
  EMPTY_SEARCH,
  ENTRY_KIND_LABEL,
  searchRange,
  type TransactionSearch,
} from '@money/core/hooks/useTransactions';

import DatePickerPanel from './DatePickerPanel';
import Modal from './Modal';

/** 고를 수 있는 알약 하나. 고른 것은 파란 알약이다 (앱의 다른 고르는 자리와 같다). */
function Chip({
  label,
  selected,
  onPress,
  color,
  subtle,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 태그의 색. 그 밖의 알약은 색이 없다. */
  color?: string | null;
  /**
   * 소분류처럼 한 단 아래인 알약.
   *
   * 테두리를 감추고 글자를 얇게 한다. 크기는 그대로다 -- 대분류가 먼저 눈에 들어오되
   * 줄이 밀리지 않아야 한다. 상태가 아니라 **자리**에 따른 차이라 눌러도 달라지지 않는다.
   * 고른 소분류는 파란 테두리가 다시 보인다. 골랐다는 것은 보여야 한다.
   */
  subtle?: boolean;
}) {
  /*
   * **누른다고 크기가 달라지지 않는다.** 테두리 굵기도 글자 굵기도 상태와 무관하게 같고,
   * 고른 것은 색으로만 말한다. 굵어지면 그만큼 넓어져, 한 알약을 켰을 뿐인데 옆의
   * 알약이 다음 줄로 밀린다.
   */
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
        selected
          ? 'border-blue-600 bg-blue-50'
          : subtle
            ? // 테두리를 없애지 않고 **투명하게** 둔다. 굵기가 그대로라 줄바꿈 자리가 움직이지 않는다.
              'border-transparent bg-white'
            : 'border-gray-300 bg-white'
      }`}
    >
      {color ? (
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      ) : null}
      <Text
        className={`text-sm ${subtle ? 'font-light' : ''} ${
          selected ? 'text-blue-600' : subtle ? 'text-gray-500' : 'text-gray-700'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 분류 칸의 가름표. 대분류 뒤의 `›` 와 묶음 끝의 `/`.
 *
 * 누를 수 없는 글자다. 상자 대신 이것으로 묶음의 경계를 말한다. 대분류 뒤는 꺾쇠다 --
 * 알약에 적히는 "식비 › 식료품" 과 같은 기호라 뒤따르는 것이 그 아래 소분류임이
 * 한눈에 읽힌다.
 */
function Divider({ mark }: { mark: '›' | '/' }) {
  return <Text className="text-sm text-gray-300">{mark}</Text>;
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

/**
 * 통장·카드 칸. 주인이 여럿이면 주인별로 묶어 그린다.
 *
 * "국민은행 통장"이 집에 셋 있으면 이름만으로는 어느 것을 고르는지 알 수 없다.
 * 주인이 하나뿐이면 묶지 않는다 -- 모든 줄에 같은 이름이 붙을 뿐이다.
 */
function AssetGroup<T extends { id: string }>({
  title,
  items,
  owners,
  ownerOrder,
  showOwner,
  render,
}: {
  title: string;
  items: T[];
  owners: Map<string, string>;
  /** 묶음의 차례. 자산 화면이 세우는 구성원 순서를 따른다. */
  ownerOrder: string[];
  showOwner: boolean;
  render: (item: T) => React.ReactNode;
}) {
  if (!showOwner) return <Group title={title}>{items.map(render)}</Group>;

  return (
    <View className="mb-5">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
        {title}
      </Text>
      {groupByOwner(items, owners, ownerOrder).map((group) => (
        <View key={group.ownerName ?? ''} className="mb-3">
          <Text className="mb-1.5 text-xs text-gray-500">{group.ownerName ?? '-'}</Text>
          <View className="flex-row flex-wrap gap-2">{group.items.map(render)}</View>
        </View>
      ))}
    </View>
  );
}

/** 기간의 한 칸. 누르면 아래에 달력이 열린다. 열린 칸은 테두리가 파랗다. */
function DateButton({
  label,
  value,
  placeholder,
  isOpen,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  isOpen: boolean;
  onPress: () => void;
}) {
  return (
    <View className="flex-1">
      <Text className="mb-1 text-xs text-gray-500">{label}</Text>
      <Pressable
        onPress={onPress}
        className={`flex-row items-center gap-2 rounded-lg border bg-white px-3 py-2 ${
          isOpen ? 'border-blue-600' : 'border-gray-300'
        }`}
      >
        <CalendarDays size={16} color={isOpen ? '#2563eb' : '#6b7280'} />
        <Text className={`text-base ${value ? 'text-gray-900' : 'text-gray-400'}`}>
          {value || placeholder}
        </Text>
      </Pressable>
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
  tags,
  people,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApply: (search: TransactionSearch) => void;
  /** 지금 적용된 검색. 다시 열면 이 상태에서 이어 고른다. */
  current: TransactionSearch;
  categories: CategoryDto.Response[];
  accounts: AccountDto.Response[];
  cards: CardDto.Response[];
  tags: TagDto.Response[];
  /** 거래를 낸 사람을 고를 목록. 자산주인 필터(화면 제목)와 다른 자리다. */
  people: PersonDto.Response[];
}) {
  const { t } = useTranslation();
  /** 고르는 중인 것. 확인을 누를 때까지 화면의 목록은 그대로다. */
  const [draft, setDraft] = useState<TransactionSearch>(current);

  /* 통장·카드의 주인. 카드는 결제 통장의 주인을 따른다. */
  const assetOwners = assetOwnerNames(accounts, cards, people);
  const showAssetOwner = hasSeveralOwners(assetOwners);
  /** 묶음의 차례. 자산 화면이 세우는 구성원 순서를 따른다. */
  const ownerOrder = people.map((person) => person.name);
  /** 달력이 열린 기간 칸. 한 번에 하나만 연다 -- 판 둘이 겹치면 어느 칸의 것인지 모른다. */
  const [openField, setOpenField] = useState<'start' | 'end' | null>(null);

  // 열 때마다 지금 적용된 것에서 시작한다. 닫고 다시 열면 지난 초안이 남으면 안 된다.
  useEffect(() => {
    if (isOpen) {
      setDraft(current);
      setOpenField(null);
    }
  }, [isOpen, current]);

  /** 고른 기간. 한쪽만 고르면 그쪽이 열린 구간이다. */
  const range = searchRange(draft);
  /**
   * 잘못 고른 기간인가. 앞뒤가 뒤집힌 것.
   *
   * 한 칸만 고른 것은 여기 들지 않는다 -- 시작일만 고르면 그날부터 끝까지다.
   * 이 상태에서는 적용을 막는다. 그냥 흘려보내면 기간을 정했는데 걸리지 않는 것이
   * 되어, 사용자는 검색이 고장 났다고 읽는다.
   */
  const isRangeBroken = Boolean(draft.startDate || draft.endDate) && range === null;

  const count =
    (draft.text.trim() ? 1 : 0) +
    draft.categoryIds.length +
    draft.paymentAccountIds.length +
    draft.paymentCardIds.length +
    draft.kinds.length +
    draft.tagIds.length +
    draft.entryPersonIds.length +
    (range ? 1 : 0);
  const isEmpty =
    categories.length === 0 && accounts.length === 0 && cards.length === 0 && tags.length === 0;

  /** 지출·수입으로 가르고 대분류별로 묶은 분류. 분류 칸이 이 차례로 그린다. */
  const categorySections = groupCategoriesByType(categories);
  /** 카드는 결제 통장의 차례를 따라 세운다. 자산 화면과 같은 차례가 된다. */
  const orderedCards = sortCardsByAccount(cards, accounts);

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
          글자를 맨 위에 둔다.

          찾는 것이 이미 머리에 있는 사람에게는 이 한 칸이 검색의 전부다 -- "스타벅스"를
          적는 편이 분류와 카드를 골라 좁히는 것보다 빠르다. 알약을 고르는 칸들은
          무엇이 있는지 보고 고르는 자리라 그 아래에 온다.
        */}
        <View className="mb-5">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('tx.search.text')}
          </Text>
          <TextInput
            value={draft.text}
            onChangeText={(text) => setDraft((prev) => ({ ...prev, text }))}
            placeholder={t('tx.search.textPlaceholder')}
            placeholderTextColor="#9ca3af"
            returnKeyType="search"
            /* 자판의 검색 키로 바로 적용한다. 글자를 적은 사람은 무엇을 찾는지 안다. */
            onSubmitEditing={() => {
              if (isRangeBroken) return;
              onApply(draft);
              onClose();
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
          />
        </View>

        {/*
          기간을 그다음에 둔다. 무엇으로 좁히든 "언제"를 정하는 일이 많다.
          고를 수 있는 분류·자산이 없어도 이 칸은 그린다 -- 기간은 그 목록과 무관하다.

          두 칸은 누르면 달력이 열리는 버튼이다(웹의 날짜 입력과 같은 일을 한다).
          달력은 두 칸 아래에 펼친다. 칸 하나는 화면 절반 너비라 그 안에 일곱 열을
          그리면 날짜 숫자가 서로 붙는다.
        */}
        <View className="mb-5">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('tx.search.period')}
          </Text>
          <View className="flex-row gap-2">
            <DateButton
              label={t('tx.search.periodFrom')}
              value={draft.startDate}
              placeholder={t('tx.search.periodPick')}
              isOpen={openField === 'start'}
              onPress={() => setOpenField((prev) => (prev === 'start' ? null : 'start'))}
            />
            <DateButton
              label={t('tx.search.periodTo')}
              value={draft.endDate}
              placeholder={t('tx.search.periodPick')}
              isOpen={openField === 'end'}
              onPress={() => setOpenField((prev) => (prev === 'end' ? null : 'end'))}
            />
          </View>
          {openField ? (
            <View className="mt-2">
              {/*
                칸을 옮기면 달력을 새로 그린다(key). 그래야 보고 있던 달이 아니라
                그 칸의 날짜가 있는 달에서 시작한다.
              */}
              <DatePickerPanel
                key={openField}
                value={openField === 'start' ? draft.startDate : draft.endDate}
                fallbackDate={openField === 'start' ? draft.endDate : draft.startDate}
                onSelect={(dateKey) => {
                  const isStart = openField === 'start';
                  setDraft((prev) => ({
                    ...prev,
                    [isStart ? 'startDate' : 'endDate']: dateKey,
                  }));
                  /*
                   * 고르면 달력을 닫는다. 시작일 하나로도 "그날부터 끝까지"가 걸리므로
                   * 종료일 칸으로 끌고 가지 않는다. 두 칸을 다 쓸 사람은 나머지 칸을
                   * 눌러 이어서 고른다.
                   */
                  setOpenField(null);
                }}
              />
            </View>
          ) : null}
          {draft.startDate || draft.endDate ? (
            <Pressable
              onPress={() => {
                setDraft((prev) => ({ ...prev, startDate: '', endDate: '' }));
                setOpenField(null);
              }}
              className="mt-2 self-start"
            >
              <Text className="text-xs font-medium text-blue-600">
                {t('tx.search.periodClear')}
              </Text>
            </Pressable>
          ) : null}
          {/* 잘못 적었을 때만 한 줄 뜬다. 규칙 설명은 두지 않는다. */}
          {isRangeBroken ? (
            <Text className="mt-2 text-xs leading-5 text-red-600">
              {t('tx.search.periodInvalid')}
            </Text>
          ) : null}
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

            {/*
              거래를 낸 사람. **화면 제목의 자산주인과 다른 것이다.**

              제목은 돈이 오간 계좌의 주인으로 거르고, 이 칸은 거래를 적을 때 고른
              사람으로 거른다. 남의 카드로 내 몫을 쓴 거래에서 둘이 갈린다.
            */}
            {people.length > 1 ? (
              <Group title={t('tx.search.people')}>
                {people.map((person) => (
                  <Chip
                    key={person.id}
                    label={person.name}
                    selected={draft.entryPersonIds.includes(person.id)}
                    onPress={() =>
                      setDraft((prev) => ({
                        ...prev,
                        entryPersonIds: toggle(prev.entryPersonIds, person.id),
                      }))
                    }
                  />
                ))}
              </Group>
            ) : null}

            {/*
              태그를 사용자 다음에 둔다. 개수가 적고, "이번 여행에 쓴 돈"처럼 태그 하나로
              끝나는 검색이 잦다. 분류 알약 수십 개 아래에 두면 굴려서 찾아야 한다.
            */}
            {tags.length > 0 ? (
              <Group title={t('tags.pick')}>
                {tags.map((tag) => (
                  <Chip
                    key={tag.id}
                    label={tag.name}
                    color={tag.color}
                    selected={draft.tagIds.includes(tag.id)}
                    onPress={() =>
                      setDraft((prev) => ({ ...prev, tagIds: toggle(prev.tagIds, tag.id) }))
                    }
                  />
                ))}
                {/*
                  태그를 하나도 붙이지 않은 거래. 태그 무리의 한 갈래라 고른 태그들과
                  OR 로 이어진다 -- "여행 또는 태그 없음"이 그대로 걸린다.
                */}
                <Chip
                  label={t('tx.search.noTag')}
                  selected={draft.tagIds.includes(NO_TAG)}
                  onPress={() =>
                    setDraft((prev) => ({ ...prev, tagIds: toggle(prev.tagIds, NO_TAG) }))
                  }
                />
              </Group>
            ) : null}

            {categories.length > 0 ? (
              /*
                다른 칸처럼 한 줄로 쭉 이어 붙인다. 상자를 두르지 않는다 -- 칸마다 모양이
                다르면 검색 창 안에서 리듬이 깨지고, 상자의 여백만큼 자리도 넓게 쓴다.

                묶음은 글자로 가른다. **대분류 뒤에는 `|`, 묶음 끝에는 `/`**. 사이에 놓인
                것이 그 대분류의 소분류다.

                **대분류를 고르면 그 소분류는 함께 걸린다** (서버 규칙). 그래서 대분류가
                켜지면 소분류도 켜진 것으로 보이고, 그 상태에서 소분류 하나를 끄면 대분류가
                내려가며 나머지 소분류가 켜진다. 거꾸로 소분류를 마지막 하나까지 켜면 그
                무리가 대분류 하나로 접힌다 (core 의 toggleCategory).
              */
              <View className="mb-5">
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                  {t('tx.search.categories')}
                </Text>
                {categorySections.map((section) => (
                  <View key={section.type} className="mb-2">
                    {/* 지출·수입을 갈라 적는다. 등록한 차례는 유형마다 따로 매겨져 있다. */}
                    <Text className="mb-1.5 text-xs text-gray-500">
                      {t(section.type === 'expense' ? 'tx.kind.expense' : 'tx.kind.income')}
                    </Text>
                    <View className="flex-row flex-wrap items-center gap-2">
                      {section.groups.map((group, index) => {
                        const pick = (category: { id: string }) =>
                          setDraft((prev) => ({
                            ...prev,
                            categoryIds: toggleCategory(prev.categoryIds, category, group),
                          }));

                        return (
                          <Fragment key={group.parent?.id ?? 'orphans'}>
                            {group.parent ? (
                              <Chip
                                label={group.parent.name}
                                selected={isCategoryPicked(draft.categoryIds, group.parent, group)}
                                onPress={() => pick(group.parent!)}
                              />
                            ) : null}

                            {group.parent && group.children.length > 0 ? <Divider mark="›" /> : null}

                            {group.children.map((child) => (
                              <Chip
                                key={child.id}
                                label={child.name}
                                selected={isCategoryPicked(draft.categoryIds, child, group)}
                                onPress={() => pick(child)}
                                // 한 단 아래다. 옅게 그려 대분류가 먼저 읽히게 한다.
                                subtle
                              />
                            ))}

                            {/* 묶음의 끝. 마지막 묶음 뒤에는 가를 것이 없다. */}
                            {index < section.groups.length - 1 ? <Divider mark="/" /> : null}
                          </Fragment>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {accounts.length > 0 ? (
              <AssetGroup
                title={t('tx.search.accounts')}
                items={accounts}
                owners={assetOwners}
                ownerOrder={ownerOrder}
                showOwner={showAssetOwner}
                render={(account) => (
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
                )}
              />
            ) : null}

            {cards.length > 0 ? (
              /* 카드는 결제 통장의 주인을 따른다 (core 의 asset-owner). */
              <AssetGroup
                title={t('tx.search.cards')}
                items={orderedCards}
                owners={assetOwners}
                ownerOrder={ownerOrder}
                showOwner={showAssetOwner}
                render={(card) => (
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
                )}
              />
              ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}
