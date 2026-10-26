/*
 * 거래 입력.
 *
 * 웹의 편집기(EntryEditor)를 그대로 옮기지 않았다. 그쪽은 외화·분할·카드사 대금 이동과
 * 그 자리에서 계좌·카드·분류를 만드는 일까지 하고, 그만큼 크다. 앱에서 손으로 적는 것은
 * 대개 "5,000원, 식비, 신한카드, 오늘"이라 그 길을 짧게 두고 나머지는 웹에 맡긴다.
 * 다루지 않는 갈래를 만나면 감추지 않고 "웹에서 고쳐 주세요"로 말한다.
 *
 * 고르는 칸은 전부 알약(chip)이다. 앱에는 select 가 없고, 목록이 한 가정 규모라 펼쳐
 * 두는 편이 누르는 횟수가 적다.
 *
 * **저장은 창구로 나간다.** 온라인이면 서버로, 오프라인이면 기기 사본과 아웃박스로 간다.
 * 이 컴포넌트는 어느 쪽인지 모른다 (core 의 entry-write-port).
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import type { EntryDraftDto, EntryListItem } from '@money/types';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useEntryForm } from '@money/core/hooks/useEntryForm';
import { usePaybackDrafts } from '@money/core/hooks/usePaybackDrafts';
import { ENTRY_FORM_VIOLATION_KEY } from '@money/core/lib/entry-form-messages';
import {
  showDiscountPerformance,
  totalDiscountOf,
  type EntryFormKind,
  type EntryFormValues,
  paybackMethodOf,
} from '@money/core/data/entry-form';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useMyPersonId, useProject, useProjectTimeZone } from '@money/core/store/project';

import DatePickerPanel from './DatePickerPanel';
import EntryInstallmentField from './EntryInstallmentField';
import EntryQuickAddModals from './EntryQuickAddModals';
import EntrySplitField from './EntrySplitField';
import EntryTransferFields from './EntryTransferFields';
import { CategoryChips, CheckRow, Chips, Field, PickerButton, openTimeKeyPicker } from './FormFields';
import Modal from './Modal';
import PaybackEditor, { type PaybackTarget } from './PaybackEditor';
import PaybackFormSection from './PaybackFormSection';
import SegmentedTabs from './SegmentedTabs';
import { OptionModal } from './SettingPicker';
import TagChips from './TagChips';
import { useEntryEditorSubmit } from './useEntryEditorSubmit';
import { useEntryQuickAdd } from './useEntryQuickAdd';

/** 갈래 넷. 조정(잔액 맞추기)은 이 폼이 만드는 것이 아니라 여기 없다. */
const KINDS: Array<{ id: EntryFormKind; labelKey: MessageKey }> = [
  { id: 'expense', labelKey: 'editor.kind.expense' },
  { id: 'income', labelKey: 'editor.kind.income' },
  { id: 'transfer', labelKey: 'editor.kind.transfer' },
];

/**
 * 고를 수 있는 통화. 빈 값이 장부 통화다.
 *
 * 자유 입력을 두지 않는다. 통화 코드를 손으로 적게 하면 오타 하나가 저장을 막고, 앱에는
 * 목록에서 고르는 편이 빠르다.
 */
const CURRENCIES = ['USD', 'JPY', 'EUR', 'CNY'];

export interface EntryEditorProps {
  isOpen: boolean;
  onClose: () => void;
  /** 고칠 거래. 없으면 새로 적는다. */
  editing?: EntryListItem | null;
  /**
   * 내용만 베낄 거래. 값은 다 들어오지만 저장하면 **새 거래**가 된다.
   *
   * `editing` 과 함께 주지 않는다. 둘이 다 오면 고치기가 이긴다 -- 어느 쪽이든 하나는
   * 부르는 쪽의 실수이고, 그때 거래를 하나 더 만드는 것보다 원본을 여는 편이 안전하다.
   */
  copying?: EntryListItem | null;
  /**
   * 보관함의 후보. 값이 채워진 채로 열리고, 저장하면 **새 거래**가 된다.
   *
   * `editing`·`copying` 과 함께 주지 않는다. 후보는 거래가 아니라 읽어 낸 값의
   * 묶음이라 빈 칸이 있는 것이 정상이고, 그래서 되돌리는 길도 다르다
   * (core 의 `entryFormFromDraft`).
   */
  draft?: EntryDraftDto.Response | null;
  /**
   * 저장·삭제가 끝난 뒤. 목록을 다시 읽는 자리다.
   *
   * 만든 거래의 id 를 함께 준다(core 의 `useEntryForm`). 보관함이 그 값으로 후보에
   * 등록 표시를 남긴다. 목록만 다시 읽는 화면은 인자를 받지 않으면 된다.
   */
  onSaved?: (result: { entryId: string | null }) => void;
  /** 이 화면이 다루지 않는 갈래를 열려 했을 때 */
  onNotEditable?: () => void;
}

export default function EntryEditor({
  isOpen,
  onClose,
  editing,
  copying,
  draft,
  onSaved,
  onNotEditable,
}: EntryEditorProps) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const projectId = useProject((state) => state.selectedProjectId);
  const myPersonId = useMyPersonId();

  const form = useEntryForm({
    projectId,
    timeZone,
    defaultPersonId: myPersonId ?? '',
    onSaved,
  });
  const { values, setField, violation } = form;

  /** 폼에서 함께 적는 페이백 (지출에만). 지출을 저장한 직후 그 지출에 걸어 저장한다. */
  const paybackDrafts = usePaybackDrafts(timeZone);
  /** 함께 적은 페이백을 저장하다 난 오류. 폼 검사의 문구보다 앞에 선다. */
  const [paybackError, setPaybackError] = useState('');
  /** 받은 페이백을 눌러 연 페이백 편집기. */
  const [paybackTarget, setPaybackTarget] = useState<PaybackTarget | null>(null);
  const [paybackReload, setPaybackReload] = useState(0);

  /**
   * 함께 적는 페이백이 고를 원거래의 줄. 지출에만 있다. 줄 키는 폼이 들고 있는 그대로라
   * 저장한 직후 그 줄에 걸 수 있다.
   */
  const categoryNameOf = (categoryId: string) =>
    form.lists.categories.find((category) => category.id === categoryId)?.name ?? '';
  const paybackLines =
    values.kind !== 'expense'
      ? []
      : values.splits.length > 0
        ? values.splits.map((split) => ({
            lineKey: split.lineKey,
            categoryId: split.categoryId,
            // 금액을 붙인다. 같은 분류를 두 줄로 나눴어도 가릴 수 있게.
            label: `${categoryNameOf(split.categoryId) || '-'}${split.amount.trim() ? ` · ${split.amount.trim()}` : ''}`,
          }))
        : [{ lineKey: values.lineKey, categoryId: values.categoryId, label: categoryNameOf(values.categoryId) }];

  /*
   * 고르는 칸 옆의 "+"로 그 자리에서 만드는 일. 창은 아래 EntryQuickAddModals 가 그린다.
   */
  const quick = useEntryQuickAdd({ projectId, isOpen, form });

  /**
   * 달력이 펼쳐져 있는가.
   *
   * 팝업을 닫을 때 접는다 -- 다시 열었을 때 지난번에 펼쳐 둔 판이 그대로 있으면 폼의
   * 첫 화면이 사람마다 달라진다. 시각은 안드로이드 대화상자라 이 값과 무관하다.
   */
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  /** 통화 고르기 창. 금액 칸 오른쪽의 통화를 누르면 뜬다. */
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  /*
   * 차감·취소 칸을 폈는가. 금액 아래 "할인·차감 추가" 단추가 편다 (웹과 같다). 적어 둔 값이 있으면
   * 단추 없이 펴 둔다 -- 고치려고 연 거래의 차감이 숨으면 있는 줄도 모른다.
   */
  const [isDiscountOpen, setIsDiscountOpen] = useState(false);
  const isDiscountShown = isDiscountOpen || values.discountAmount !== '';
  /** 나눈 줄마다의 차감 칸. 줄 키로 든다 -- 줄을 지우면 뒤의 번호가 당겨진다. */
  const [openDiscountLines, setOpenDiscountLines] = useState<ReadonlySet<string>>(new Set());
  const isSplitDiscountShown = (split: { lineKey: string; discountAmount: string }) =>
    openDiscountLines.has(split.lineKey) || split.discountAmount !== '';
  const openSplitDiscount = (lineKey: string) =>
    setOpenDiscountLines((prev) => new Set(prev).add(lineKey));
  const closeSplitDiscount = (lineKey: string) =>
    setOpenDiscountLines((prev) => {
      const next = new Set(prev);
      next.delete(lineKey);
      return next;
    });

  useEffect(() => {
    if (!isOpen) {
      setIsCalendarOpen(false);
      setIsCurrencyOpen(false);
      setIsDiscountOpen(false);
      setOpenDiscountLines(new Set());
    }
  }, [isOpen]);

  /**
   * 시각을 고른다. **안드로이드가 그리는 시계 대화상자다.**
   *
   * 알약으로 시와 분을 늘어놓아 보았지만, 사람들이 시각을 고르는 자리는 어느 앱에서나
   * 이 대화상자라 그것을 쓰는 편이 익다(`@react-native-community/datetimepicker`).
   * 이 앱은 안드로이드로만 나가므로 그쪽 명령형 API 를 그대로 쓴다.
   */
  const openTimePicker = () => openTimeKeyPicker(values.timeKey, (timeKey) => setField('timeKey', timeKey));

  /*
   * 팝업이 열릴 때 폼을 채운다.
   *
   * 열려 있는 동안 다시 채우지 않는다. 그러면 사용자가 적던 값이 되돌아간다.
   */
  useEffect(() => {
    if (!isOpen) return;
    // 남은 초안은 앞서 연 거래의 것이다.
    paybackDrafts.reset();
    setPaybackError('');

    if (editing) {
      if (!form.startEdit(editing)) {
        onNotEditable?.();
        onClose();
      }
      return;
    }
    /*
     * 베끼기. 값을 채우는 것 말고는 새로 적는 것과 같다.
     *
     * 못 다루는 거래는 고치기와 마찬가지로 열지 않는다 -- 열어 두면 폼이 담지 못한
     * 것(분할 줄, 잔액 조정)이 빠진 채로 새 거래가 되어, 베낀 것과 다른 거래가 남는다.
     */
    if (copying) {
      if (!form.startCopy(copying)) {
        onNotEditable?.();
        onClose();
      }
      return;
    }
    /*
     * 보관함의 후보. 읽은 것만 덮고 나머지는 빈 폼의 기본값이다.
     *
     * 못 다루는 갈래를 걸러 내지 않는다. 후보의 갈래는 문구에서 짐작한 값이고 사람이
     * 폼에서 바꿀 수 있어서, 열지 않으면 담아 둔 것을 쓸 방법이 아예 없어진다.
     */
    if (draft) {
      form.startDraft(draft);
      return;
    }
    form.startNew();
    // form 의 함수들은 매번 새로 만들어지므로 의존성에 두지 않는다. 여는 순간만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing, copying, draft]);

  /* 저장·지우기. 페이백을 이어 저장하고 두 번 누름을 막는다 (useEntryEditorSubmit). */
  const { isBusy, save, remove } = useEntryEditorSubmit({
    form,
    paybackDrafts,
    paybackLines,
    setPaybackError,
    editing,
    projectId,
    onClose,
    t,
  });

  const messageOf = (): string => {
    if (form.error) return form.error;
    if (!violation) return '';
    const key = ENTRY_FORM_VIOLATION_KEY[violation.code];
    return key ? t(key) : violation.code;
  };

  const message = paybackError || messageOf();

  return (
    /*
      만들기 창들은 이 팝업의 **형제**로 둔다. 안에 넣으면 팝업 본문(ScrollView)의
      자식이 되어, 창을 여는 동안 본문이 스크롤 자리를 잃는다.
    */
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t(form.isEditing ? 'editor.titleEdit' : 'editor.titleAdd')}
        footer={
          <View className="flex-row gap-2">
            {form.isEditing ? (
              <Pressable
                disabled={isBusy}
                onPress={remove}
                className={`rounded-lg border border-red-300 px-4 py-3 ${
                  isBusy ? 'opacity-50' : ''
                }`}
              >
                <Text className="text-sm font-medium text-red-600">
                  {t(form.isSubmitting ? 'entryForm.deleting' : 'entryForm.delete')}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={isBusy}
              onPress={save}
              className={`flex-1 items-center rounded-lg bg-blue-600 px-4 py-3 ${
                isBusy ? 'opacity-50' : ''
              }`}
            >
              <Text className="text-base font-semibold text-white">
                {t(isBusy ? 'common.saving' : 'common.save')}
              </Text>
            </Pressable>
          </View>
        }
      >
        <View className="gap-5">
          {message ? (
            <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <Text className="text-sm text-red-600">{message}</Text>
            </View>
          ) : null}

          {/*
          날짜와 시각. 폼 맨 위에 둔다 (2026-10-10 사용자 요청, 웹과 같다). **손으로 적지 않고 골라 넣는다.**

          글자로 받으면 "2026-02-31" 이나 "25:99" 처럼 저장할 수 없는 값이 나오고, 사람은
          저장을 눌러 보고서야 그것을 안다. 날짜는 아래에 달력이 펼쳐지고, 시각은 안드로이드
          시계 대화상자가 뜬다.
        */}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label={t('editor.date')} invalid={violation?.field === 'dateKey'}>
                <PickerButton
                  icon="date"
                  value={values.dateKey}
                  placeholder="YYYY-MM-DD"
                  isOpen={isCalendarOpen}
                  onPress={() => setIsCalendarOpen(!isCalendarOpen)}
                />
              </Field>
            </View>
            <View className="w-32">
              <Field label={t('editor.time')} invalid={violation?.field === 'timeKey'}>
                <PickerButton
                  icon="time"
                  value={values.timeKey}
                  placeholder="HH:MM"
                  isOpen={false}
                  onPress={openTimePicker}
                />
              </Field>
            </View>
          </View>

          {isCalendarOpen ? (
            <DatePickerPanel
              value={values.dateKey}
              onSelect={(dateKey) => {
                setField('dateKey', dateKey);
                setIsCalendarOpen(false);
              }}
            />
          ) : null}

          {/*
            갈래. 거래·분석 탭 위쪽의 탭과 같은 부품이다 (2026-10-11 사용자 요청, 웹의 유형 탭과 같은 자리).
            바꾸면 그 갈래에서 뜻이 없는 칸은 훅이 비운다.
          */}
          <SegmentedTabs
            tabs={KINDS.map((kind) => ({ id: kind.id, label: t(kind.labelKey) }))}
            selected={values.kind}
            onSelect={(value) => setField('kind', value)}
          />

          {/*
            금액과 통화. 통화는 금액 칸 오른쪽에 지금 통화로 서고, 누르면 고르는 창이 뜬다 (2026-10-10
            사용자 요청, 웹과 같다). 기준통화로 적으면 환산할 것이 없어 아래 환율 칸을 만들지 않는다.
            통화를 고르면 어림값이 채워지고 사용자가 실제 환율로 고친다 -- 그 값을 명령에 실어 보내는
            것이 요점이다. 비워 두면 며칠 뒤 재생할 때 그날 환율로 값이 다시 매겨진다 (설계 문서의 D7).
          */}
          <Field label={t('editor.amount')} invalid={violation?.field === 'amount'}>
            <View className="flex-row items-center rounded-lg border border-gray-300">
              <TextInput
                value={values.amount}
                onChangeText={(text) => setField('amount', text)}
                keyboardType="numeric"
                /*
                  팝업이 열리면 여기부터 적는다. 거래를 적는 일은 언제나 금액에서
                  시작하고, 다른 칸은 고르는 칸이라 손으로 짚는 편이 빠르다
                  (웹은 같은 자리를 data-autofocus 로 짚는다).
                */
                autoFocus
                placeholder="0"
                className="flex-1 px-3 py-3 text-base text-gray-900"
              />
              <Pressable
                onPress={() => setIsCurrencyOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={t('editor.currency')}
                hitSlop={4}
                className="flex-row items-center gap-0.5 px-3 py-3 active:bg-gray-50"
              >
                <Text className="text-base font-medium text-blue-600">
                  {values.currency || form.ledgerCurrency}
                </Text>
                <ChevronDown size={16} color="#2563eb" />
              </Pressable>
            </View>
          </Field>


          {values.currency ? (
            <Field label={t('editor.rate')} invalid={violation?.field === 'exchangeRate'}>
              <TextInput
                value={values.exchangeRate}
                onChangeText={(text) => setField('exchangeRate', text)}
                keyboardType="numeric"
                placeholder="0"
                className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
              />
              <Text className="mt-1 text-xs text-gray-500">
                {t('editor.rateHint', {
                  currency: values.currency,
                  ledger: form.ledgerCurrency,
                })}
              </Text>
            </Field>
          ) : null}

          {/*
            차감·취소. 포인트 사용, 자동할인, 그리고 취소가 이 칸 하나로 들어간다.

            금액 바로 아래에 "할인·차감 추가" 단추로 접어 둔다 (2026-10-10 사용자 요청, 웹과 같다).
            적어 둔 값이 있으면(고치기) 처음부터 펴 둔다.

            셋은 전표에서 같은 모양이다 -- 정가는 그대로인데 계좌에서 빠지는 돈만 적다.
            전액을 적으면 0원 거래로 남는다. 지우지 않는 것은 있었던 일이기 때문이다.

            **분할이면 감춘다.** 그때는 깎인 금액을 줄마다 적으므로(위의 줄 칸) 여기
            한 칸을 더 두면 어느 쪽이 저장되는지 알 수 없다.
          */}
          {values.kind === 'expense' && values.splits.length === 0 && !isDiscountShown ? (
            /* 글자만 둔다 (2026-10-11 사용자 요청) -- 상자로 두면 자주 쓰지 않는 칸이 금액만큼 자리를 먹는다. */
            <Pressable
              onPress={() => setIsDiscountOpen(true)}
              accessibilityRole="button"
              hitSlop={8}
              className="-mt-2 self-start active:opacity-60"
            >
              <Text className="text-sm font-medium text-blue-600">+ {t('editor.discountAdd')}</Text>
            </Pressable>
          ) : null}
          {values.kind === 'expense' && values.splits.length === 0 && isDiscountShown ? (
            <Field
              label={t('editor.discount')}
              invalid={violation?.field === 'discountAmount'}
              /*
                잘못 눌러 편 칸을 도로 접는다 (2026-10-11 사용자 요청). 적은 값도 함께 지운다 -- 접힌 채
                값이 남으면 보이지 않는 차감이 저장된다.
              */
              onClose={() => {
                setField('discountAmount', '');
                setIsDiscountOpen(false);
              }}
            >
              <TextInput
                value={values.discountAmount}
                onChangeText={(text) => setField('discountAmount', text)}
                keyboardType="numeric"
                placeholder="0"
                className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
              />
              <Text className="mt-1 text-xs text-gray-500">{t('editor.discountHint')}</Text>

              {/* 실제로 빠지는 금액. 저장하고 목록에서 보고서야 알게 하지 않는다. */}
              {values.discountAmount ? (
                <Text className="mt-3 text-xs text-gray-500">
                  {t('editor.netAmount', {
                    amount: formatCurrency(
                      toNumber(values.amount) - toNumber(values.discountAmount),
                      values.currency || form.ledgerCurrency,
                    ),
                  })}
                </Text>
              ) : null}
            </Field>
          ) : null}

          {/*
            깎인 만큼 실적도 줄일지. 기본은 줄인다 -- 다리가 이미 순액이라 그것이
            지금까지의 동작이다. 카드사가 환불을 실적에서 빼지 않는 경우가 있어, 끄면
            실적만 정가로 센다.

            **분할이면 감춘다.** 그때는 환불액을 적는 줄마다 같은 체크가 바로 아래에
            서 있다. 값은 어느 쪽이든 하나라 함께 움직인다.

            거래 자체를 실적에서 뺐으면 뜨지 않는다. 그때는 어느 쪽이든 실적이 움직이지
            않아 물을 것이 없다 (`showDiscountPerformance`).
          */}
          {values.splits.length === 0 &&
          showDiscountPerformance({
            kind: values.kind,
            discountAmount: totalDiscountOf(values),
            countsPerformance: values.countsPerformance,
            isCard: Boolean(form.selectedCard),
            isLedgerCurrency: !values.currency,
          }) ? (
            <CheckRow
              checked={values.discountCountsPerformance}
              onToggle={() =>
                setField('discountCountsPerformance', !values.discountCountsPerformance)
              }
              label={t('editor.discountCountsPerformance')}
              hint={t('editor.discountCountsPerformanceHint')}
            />
          ) : null}

          <Field label={t('editor.descriptionOptional')}>
            <TextInput
              value={values.description}
              onChangeText={(text) => setField('description', text)}
              placeholder={t('editor.descriptionPlaceholder')}
              className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
            />
          </Field>

          {values.kind === 'transfer' ? null : values.splits.length > 0 ? (
            /*
            분할. 줄마다 분류와 금액을 따로 적는다.

            줄이 있는 동안에는 위의 분류 칸을 감춘다. 둘이 함께 보이면 어느 쪽이
            저장되는지 알 수 없고, 실제로 저장되는 것은 줄들뿐이다.
          */
            <EntrySplitField
              form={form}
              isLineDiscountShown={isSplitDiscountShown}
              onOpenLineDiscount={openSplitDiscount}
              onCloseLineDiscount={closeSplitDiscount}
            />
          ) : (
            <>
              <Field
                label={t('entryForm.category')}
                invalid={violation?.field === 'categoryId'}
                onAdd={() => quick.setAdding('category')}
                addLabel={t('categories.add')}
              >
                {form.categoryChoices.length === 0 ? (
                  <Text className="text-sm text-gray-500">{t('entryForm.noCategories')}</Text>
                ) : (
                  <CategoryChips
                    categories={form.categoryChoices}
                    selected={values.categoryId}
                    onSelect={(value) => setField('categoryId', value)}
                  />
                )}
              </Field>

              {/* 분류를 나누는 자리. 누르면 지금 적은 금액과 분류가 첫 줄로 옮겨 간다. */}
              <Pressable
                onPress={form.addSplit}
                className="items-center rounded-lg border border-gray-300 px-3 py-2"
              >
                <Text className="text-sm text-gray-700">{t('editor.splitAdd')}</Text>
              </Pressable>
            </>
          )}

          {/*
          태그. 갈래를 가리지 않으므로 이체에도 뜬다.

          카테고리와 달리 **여럿을 고른다.** 그래서 같은 알약 줄을 쓰되 고름 표시가
          누적되고, 누르면 붙었다 떨어진다.
        */}
          {/*
            **나눈 거래에서는 감춘다.** 그때는 태그가 줄마다 붙으므로 위의 줄 칸에서
            고른다. 둘이 함께 보이면 어느 쪽이 저장되는지 알 수 없다.
          */}
          {values.splits.length === 0 ? (
          <Field label={t('editor.tagsOptional')} onAdd={() => quick.setAdding('tag')} addLabel={t('tags.add')}>
            {form.lists.tags.length === 0 ? (
              <Text className="text-sm text-gray-500">{t('tags.empty')}</Text>
            ) : (
              <>
                <TagChips
                  tags={form.lists.tags}
                  selected={values.tagIds}
                  onToggle={form.toggleTag}
                />
                <Text className="mt-1 text-xs text-gray-500">{t('tags.pickHint')}</Text>
              </>
            )}
          </Field>
          ) : null}

          <Field
            label={values.kind === 'transfer' ? t('editor.fromAccount') : t('editor.methodOptional')}
            invalid={violation?.field === 'method'}
            onAdd={() => quick.setAdding('method')}
            addLabel={t('editor.addMethod')}
          >
            {form.methodChoices.length === 0 ? (
              <Text className="text-sm text-gray-500">{t('entryForm.noMethods')}</Text>
            ) : (
              <Chips
                /*
                  주인이 여럿인 가계부에서는 주인별로 묶어 그린다 (검색 창과 같은 규칙).
                  "국민은행 통장"이 셋 있으면 이름만으로는 어느 것을 고르는지 알 수 없다.
                */
                options={form.methodChoices.map((choice) => ({
                  value: choice.value,
                  label: choice.name,
                  group: form.showAssetOwner ? choice.owner : undefined,
                }))}
                selected={values.method}
                onSelect={(value) => setField('method', value)}
                collapse
              />
            )}
          </Field>

          {/*
            수입을 카드로 받는 자리.

            신용카드면 통장으로 들어오는 돈이 아니라 그 카드의 빚이 줄고, 체크카드면
            연결 통장으로 들어온다. 둘이 전혀 다른 일이라 고른 뒤에야 알게 하지 않는다.
          */}
          {/*
            카드 실적에 셀지. 카드를 골랐을 때만 뜬다.

            청구액과는 다른 값이다 -- 꺼도 갚을 대금은 그대로다. 지출은 켜짐이 기본이고
            (쓴 돈이다) 카드로 들어온 돈은 꺼짐이 기본이다(캐시백은 실적을 깎지 않는다).
          */}
          {form.selectedCard ? (
            <CheckRow
              checked={values.countsPerformance}
              onToggle={() => setField('countsPerformance', !values.countsPerformance)}
              label={t('editor.countsPerformance')}
              hint={t('editor.countsPerformanceHint')}
            />
          ) : null}

          {values.kind === 'income' && form.selectedCard ? (
            <View className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <Text className="text-sm text-blue-800">
                {form.selectedCard.cardType === 'credit'
                  ? t('editor.cardIncomeNote')
                  : t('editor.cardIncomeDebitNote', {
                      account:
                        form.lists.accounts.find(
                          (account) => account.id === form.selectedCard!.paymentAccountId,
                        )?.name ?? t('editor.methodAccount'),
                    })}
              </Text>
            </View>
          ) : null}

          {values.kind === 'transfer' ? (
            <EntryTransferFields form={form} onAddCategory={() => quick.setAdding('category')} />
          ) : null}

          <Field
            label={t('editor.personOptional')}
            invalid={violation?.field === 'personId'}
            onAdd={() => quick.setAdding('person')}
            addLabel={t('person.add')}
          >
            <Chips
              /* 지정하지 않아도 된다 (2026-10-10 사용자 요청) -- "미지정"을 고르면 사람 없이 남는다. */
              options={[
                { value: '', label: t('editor.personNone') },
                ...form.lists.people
                  .filter((person) => person.isActive)
                  .map((person) => ({ value: person.id, label: person.name })),
              ]}
              selected={values.personId}
              onSelect={(value) => setField('personId', value)}
              collapse
            />
          </Field>

          {/* 페이백. 지출에만 선다 -- 받은 것은 보이고, 여기서 적은 것은 지출과 함께 저장된다. */}
          {values.kind === 'expense' ? (
            <PaybackFormSection
              original={editing ?? null}
              drafts={paybackDrafts}
              lines={paybackLines}
              methodChoices={form.methodChoices}
              showAssetOwner={form.showAssetOwner}
              defaultMethod={paybackMethodOf(values.method, form.lists.cards, (value) =>
                form.methodChoices.some((choice) => choice.value === value),
              )}
              reloadToken={paybackReload}
              onOpenPayback={(payback) => setPaybackTarget({ editing: payback })}
            />
          ) : null}

          {/* 할부는 신용카드 지출에만 뜻이 있다. 그 밖에서는 칸 자체를 만들지 않는다. */}
          {values.kind === 'expense' && form.isCreditCard ? (
            <EntryInstallmentField form={form} />
          ) : null}

          {/*
            거래처·메모. 웹 폼과 같은 자리(맨 아래)다. 폼이 이 둘을 들지 않던 동안에는 앱에서 고치면
            웹에서 적은 값이 지워졌다 (2026-10-16).
          */}
          <Field label={t('editor.merchant')}>
            <TextInput
              value={values.merchant}
              onChangeText={(text) => setField('merchant', text)}
              placeholder={t('editor.merchantPlaceholder')}
              className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
            />
          </Field>
          <Field label={t('editor.memo')}>
            <TextInput
              value={values.detailedNote}
              onChangeText={(text) => setField('detailedNote', text)}
              placeholder={t('editor.memoPlaceholder')}
              className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
            />
          </Field>

          <Text className="text-xs text-gray-500">{t('entryForm.offlineNote')}</Text>
        </View>
      </Modal>

      {/* 금액 칸 오른쪽의 통화를 누르면 뜨는 고르기 창. 빈 값이 장부 통화다. */}
      <OptionModal
        isOpen={isCurrencyOpen}
        onClose={() => setIsCurrencyOpen(false)}
        title={t('editor.currency')}
        options={[
          { value: '', label: form.ledgerCurrency },
          ...CURRENCIES.filter((code) => code !== form.ledgerCurrency).map((code) => ({
            value: code,
            label: code,
          })),
        ]}
        value={values.currency}
        onSelect={(value) => setField('currency', value)}
      />

      {/* 고르는 칸에서 그 자리에 만드는 창들 (구성원·통장·카드·분류·태그). */}
      <EntryQuickAddModals quick={quick} form={form} />

      {/* 받은 페이백을 눌러 연 페이백 편집기. 저장하면 폼의 "받은 페이백"을 다시 읽는다. */}
      <PaybackEditor
        target={paybackTarget}
        onClose={() => setPaybackTarget(null)}
        /*
          폼의 "받은 페이백"만 다시 읽는다. 화면의 목록은 사본이 바뀌면 스스로 다시 읽는다 --
          여기서 편집기의 onSaved 를 부르면 보관함이 그 값을 "만든 거래"로 받는다.
        */
        onSaved={() => setPaybackReload((count) => count + 1)}
      />
    </>
  );
}

/** 폼 값의 이름을 밖에서도 쓴다 (검증이 짚은 자리를 화면이 맞춰 보는 데 쓴다). */
export type { EntryFormValues };
