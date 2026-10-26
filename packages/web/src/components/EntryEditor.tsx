'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useUserFilter } from '@money/core/store/user-filter';
import {
  useCanEdit,
  useMyPersonId,
  useProjectLedgerCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';
import { useExchangeRates } from '@money/core/hooks/useExchangeRates';
import { useTagManager, type TagFormValues } from '@money/core/hooks/useTagManager';
import { paybackCountOf, paybackDeleteNote } from '@money/core/hooks/usePaybacks';
import { useQuickAdd } from '@money/core/hooks/useQuickAdd';
import { usePaybackDrafts } from '@money/core/hooks/usePaybackDrafts';
import { entryWritePort } from '@money/core/data/entry-write-port';
import { useTranslation } from '@money/core/lib/i18n';
import { useApiError } from '@money/core/lib/api-error';
import type { Account, Card, Category, Person } from '@money/core/lib/types';
import {
  defaultCountsPerformance,
  showDiscountPerformance,
  paybackMethodOf,
} from '@money/core/data/entry-form';
import { toAmountString } from '@money/core/lib/money';
import { nowTimeKey } from '@money/core/lib/datetime';
import {
  Dec,
  LEDGER_MIN_ENTRY_DATE_KEY,
  hasRandomSource,
  ledgerMaxEntryDateKey,
  newId,
  zonedFormValueToUtc,
  type CurrencyCode,
  type EntryDraftDto,
} from '@money/types';
import ChoiceModal from '@/components/ChoiceModal';
import CustomSelect from '@/components/CustomSelect';
import Modal from '@/components/Modal';
import PaybackEditor, { type PaybackTarget } from '@/components/PaybackEditor';
import PaybackFormSection from '@/components/PaybackFormSection';
import AddAccountModal from '@/components/AddAccountModal';
import PersonModal from '@/components/PersonModal';
import { AddTagModal } from '@/components/TagFields';
import type { EntryListItem } from '@/components/TransactionItem';
import {
  ENTRY_TYPE_TABS,
  blankSplitRow,
  emptyEntryForm,
  isCopyableEntry,
  isEditableEntry,
  isSplitEntry,
  splitAmountOf,
  subCategoryOptionsOf,
  type EntryFormSplitRow,
  type EntryFormValues,
} from '@/components/entry-editor/editor-form';
import { formValuesOfDraft, formValuesOfEntry } from '@/components/entry-editor/editor-form-values';
import { deriveEntryForm } from '@/components/entry-editor/entry-derived';
import {
  buildEntryPayload,
  entryFormErrorKey,
  type EntrySubmitContext,
} from '@/components/entry-editor/entry-submit';
import {
  buildPaymentMethodOptions,
  buildTransferAccountOptions,
} from '@/components/entry-editor/method-options';
import AmountField from '@/components/entry-editor/AmountField';
import DiscountFields from '@/components/entry-editor/DiscountFields';
import CategoryFields from '@/components/entry-editor/CategoryFields';
import { EntryTagField, toggleId } from '@/components/entry-editor/TagPills';
import MethodField from '@/components/entry-editor/MethodField';
import TransferFields from '@/components/entry-editor/TransferFields';
import InstallmentFields from '@/components/entry-editor/InstallmentFields';
import QuickCardModal from '@/components/entry-editor/QuickCardModal';
import CategoryAddModal, { useCategoryAdd } from '@/components/entry-editor/CategoryAddModal';
import EntryDetailModal from '@/components/entry-editor/EntryDetailModal';

/*
 * 고칠 수 있는가·베낄 수 있는가의 규칙은 폼 모듈에 있다. 상세를 이 컴포넌트 밖에서 그리는
 * 화면(거래)도 같은 규칙으로 단추를 그리므로 여기서 다시 내보낸다.
 */
export { isCopyableEntry, isEditableEntry };

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const ENTRY_FORM_ID = 'entry-form';

export interface EntryEditorHandle {
  /** 거래 상세 팝업을 연다. 목록에서 한 건을 눌렀을 때 부른다. */
  openDetail: (entry: EntryListItem) => void;
  /** 빈 폼으로 거래 추가 팝업을 연다. */
  openAdd: () => void;
  /**
   * 있는 거래의 내용을 담은 거래 추가 팝업을 연다.
   *
   * 상세를 이 컴포넌트 밖에서 그리는 화면(거래)이 쓴다. 저장하면 새 거래가 되며,
   * 베낀 원본은 그대로 남는다.
   */
  openCopy: (entry: EntryListItem) => void;
  /**
   * 있는 거래를 고치는 팝업을 연다.
   *
   * 상세를 이 컴포넌트 밖에서 그리는 화면(거래)이 쓴다. 저장하면 그 거래가 고쳐진다 --
   * 베끼기(`openCopy`)와 달리 새 거래가 생기지 않는다.
   */
  openEdit: (entry: EntryListItem) => void;
  /**
   * 원거래에 페이백을 적는 팝업을 연다 (PAYBACK_DESIGN.md 7단계).
   *
   * 거래 화면의 상세처럼 이 컴포넌트 밖에서 상세를 그리는 화면이 "페이백 추가"를 누를 때 쓴다.
   */
  openPayback: (original: EntryListItem) => void;
  /**
   * 보관함의 후보로 거래 추가 팝업을 연다.
   *
   * 후보는 거래가 아니라 읽어 낸 값의 묶음이라 빈 칸이 있는 것이 정상이다. 그래서
   * 빈 폼에서 시작해 읽은 것만 덮어쓴다 -- 없는 칸을 비우면 오늘 날짜와 "나" 같은
   * 기본값까지 지워진다.
   */
  openDraft: (draft: EntryDraftDto.Response) => void;
}

/** 이 팝업 안에서 새로 만든 참조 데이터. 바뀐 것만 담긴다. */
export interface ReferenceDataPatch {
  accounts?: Account[];
  cards?: Card[];
  categories?: Category[];
  people?: Person[];
}

interface EntryEditorProps {
  projectId: string | null;
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  people: Person[];
  /**
   * 계좌·카드·분류·사람을 이 팝업에서 새로 만들었을 때.
   *
   * 목록을 여기서 들고 있지 않는 이유는 화면도 같은 목록을 쓰기 때문이다. 두 벌을
   * 두면 팝업에서 계좌를 만들어도 화면의 목록은 옛것으로 남는다.
   */
  onReferenceDataChange: (patch: ReferenceDataPatch) => void;
  /**
   * 거래를 저장하거나 지운 뒤. 화면이 목록·합계를 다시 불러온다.
   *
   * 만든 거래의 id 를 함께 준다. 보관함이 그 값으로 후보에 등록 표시를 남긴다.
   * 수정·삭제에서는 각각 그 거래의 id 와 null 이고, 목록만 다시 읽는 화면은 인자를
   * 받지 않으면 된다.
   */
  onEntryChange: (result?: { entryId: string | null }) => void | Promise<void>;
}

/**
 * 거래 상세와 추가/수정 폼.
 *
 * 가계 화면과 자산 화면이 같은 거래를 눌러 같은 팝업을 열어야 하므로 한 곳에 모았다.
 * 예전에는 가계 화면 안에만 있어서, 자산 화면의 거래 목록은 눌러도 아무 일이
 * 일어나지 않았다.
 *
 * 열기는 ref로 받는다. 상세와 추가는 이 컴포넌트 안의 서로 다른 팝업인데, 그 사실을
 * prop 두 개로 드러내면 쓰는 쪽이 내부 구조를 알아야 한다.
 *
 * 폼의 칸들은 `entry-editor/` 에 나눠 두었다. 이 파일은 폼 상태와 저장·열기만 갖는다.
 */
const EntryEditor = forwardRef<EntryEditorHandle, EntryEditorProps>(function EntryEditor(
  {
    projectId,
    accounts,
    cards,
    categories,
    people,
    onReferenceDataChange,
    onEntryChange,
  },
  ref,
) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  /** 읽기 전용 구성원에게는 쓰기 단추를 그리지 않는다. */
  const canEdit = useCanEdit();
  const { setPeople: setStorePeople } = useUserFilter();
  // 날짜 입력과 표시는 브라우저 로컬이 아니라 프로젝트 기준 타임존으로 해석한다.
  const timeZone = useProjectTimeZone();
  // 거래 입력의 환율 기준은 **저장 통화**다. 표시 통화가 아니다.
  // 원장이 저장하는 환산액(baseAmount)이 저장 통화 기준이기 때문이다.
  const ledgerCurrency = useProjectLedgerCurrency();
  const { rateOf } = useExchangeRates();
  /** 설정에서 지정한 "구성원 중 나". 새 거래의 사용자 기본값이 된다. */
  const myPersonId = useMyPersonId();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 새 거래로 저장하려다 끝을 모르는 시도의 id. 성공하거나 폼을 새로 열면 비운다 (저장의 주석). */
  const pendingCreateIdRef = useRef<string | null>(null);
  /**
   * 고칠 거래를 열 때 본 시계. 새로 적는 중이면 null 이다.
   *
   * 저장할 때 그대로 되돌려 준다. 팝업을 열어 둔 사이에 다른 사람이 같은 거래를 고쳤으면
   * 서버가 이 값으로 알아채고 거절한다 -- 그러지 않으면 늦게 누른 쪽이 조용히 이기고,
   * 진 편집은 아무 흔적도 남기지 않는다 (설계 문서의 D6).
   */
  const [baseHlc, setBaseHlc] = useState<string | null>(null);
  /*
   * 태그 목록. 계좌·분류와 달리 prop 으로 받지 않고 여기서 읽는다.
   *
   * 이 팝업을 여는 화면이 여럿이라(가계·자산·거래) prop 으로 두면 그 화면마다 목록을
   * 받아 내려보내는 일이 늘어난다. 여기서 태그를 만들면 `reloadTags` 로 이 목록만
   * 다시 읽는다 -- 바깥 화면의 태그 필터는 제 목록을 따로 들고 있어 다음에 열 때 따라온다.
   */
  const { tags, reload: reloadTags } = useTagManager(projectId);
  /** 태그를 그 자리에서 만드는 창구. 만든 것의 id 를 받아 곧바로 고른다. */
  const quickAdd = useQuickAdd(projectId);
  const [formData, setFormData] = useState<EntryFormValues>(() => emptyEntryForm(timeZone, ledgerCurrency));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<EntryListItem | null>(null);
  /** 열려 있는 페이백 편집기. null 이면 닫혔다. */
  const [paybackTarget, setPaybackTarget] = useState<PaybackTarget | null>(null);
  /** 페이백을 저장한 횟수. 상세의 "받은 페이백"을 다시 읽게 한다. */
  const [paybackReload, setPaybackReload] = useState(0);
  /** 폼에서 함께 적는 페이백 (지출에만). 지출을 저장한 직후 그 지출에 걸어 저장한다. */
  const paybackDrafts = usePaybackDrafts(timeZone);
  /** 고치는 중인 거래. 폼의 "받은 페이백"이 이것으로 읽는다. 새로 적는 중이면 null 이다. */
  const [editingEntry, setEditingEntry] = useState<EntryListItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  /** 결제수단 드롭다운이 계좌·카드를 합쳤으므로 "무엇을 추가할지"는 이 팝업에서 고른다. */
  const [isMethodChooserOpen, setIsMethodChooserOpen] = useState(false);
  const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
  // 계좌·카드 추가 폼 상태는 각 팝업(AddAccountModal·QuickCardModal)이 직접 들고 있다. 여기서는 열림 여부만 관리한다.
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  /** 태그를 그 자리에서 만드는 창. 다른 것과 달리 목록이 이 팝업 안에 있다. */
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  /** 분류를 그 자리에서 만드는 창. 소분류 하나를 만들었으면 그것을 바로 고른다. */
  const categoryAdd = useCategoryAdd({
    projectId,
    categories,
    onCategoriesChange: (data) => onReferenceDataChange({ categories: data }),
    onSubCreated: (parentId, subId) =>
      setFormData((prev) => (prev.mainCategoryId === parentId ? { ...prev, subCategoryId: subId } : prev)),
  });

  /** 주인 없는 계좌·카드를 담는 묶음. 사람 목록에 없는 소유자를 조용히 버리지 않는다. */
  const OTHER_OWNER_GROUP = t('editor.otherOwner');

  /** 결제수단 드롭다운 옵션. 계좌와 카드를 한 목록에 합친다 (`buildPaymentMethodOptions`). */
  const paymentMethodOptions = useMemo(
    () => buildPaymentMethodOptions({ accounts, cards, people, t, otherOwnerGroup: OTHER_OWNER_GROUP }),
    [accounts, cards, people],
  );

  /** 이체에서 고를 수 있는 계좌. 신용카드 부채 계정을 함께 넣는다 (`buildTransferAccountOptions`). */
  const transferAccountOptions = useMemo(
    () => buildTransferAccountOptions({ accounts, cards, people, t, otherOwnerGroup: OTHER_OWNER_GROUP }),
    [accounts, cards, people],
  );

  /** 신용카드 부채 계정의 id 들. 이체 양쪽이 카드인지 가리는 데 쓴다. */
  const cardLiabilityIds = useMemo(
    () => new Set(cards.filter((c) => c.liabilityAccountId).map((c) => c.liabilityAccountId!)),
    [cards],
  );

  /**
   * 이체 한쪽에서 고를 수 있는 계좌. 반대쪽으로 고른 것과 **카드끼리**를 뺀다.
   *
   * 한쪽이 카드면 반대쪽 목록에서 카드가 사라진다. 카드에서 카드로 바로 옮기는 거래는
   * 저장할 수 없는데(`TRANSFER_BOTH_CARDS`), 고를 수 있게 두면 다 적고 나서야 알게 된다.
   */
  const transferOptionsFor = (otherSideId: string) => {
    const otherIsCard = cardLiabilityIds.has(otherSideId);
    return transferAccountOptions.filter(
      (option) => option.id !== otherSideId && !(otherIsCard && cardLiabilityIds.has(option.id)),
    );
  };

  /* 폼 값에서 셈하는 것들 (통화·청구액·할부·차감 합). 규칙과 까닭은 `deriveEntryForm` 에 있다. */
  const {
    transferCardSide,
    transferBothCards,
    currencyOfMethod,
    paymentCurrency,
    toCurrency,
    isCrossCurrencyTransfer,
    needsRate,
    needsBilled,
    hasBilled,
    isCreditCardSelected,
    mustBill,
    canInstall,
    hasSplits,
    installmentBase,
    shareInputs,
    interestInputs,
    convertedPreview,
    derivedRate,
    totalDiscount,
  } = deriveEntryForm({ formData, accounts, cards, ledgerCurrency, cardLiabilityIds, rateOf });

  /** 결제 칸이 카드의 부채 계정이면 그 카드로 고친 칸들. 아니면 빈 값이다 (갈래 바꾸기가 쓴다). */
  const cardInsteadOfLiability = (form: { method: string; accountId: string }) => {
    if (form.method !== 'account' || !form.accountId) return {};
    const card = cards.find((row) => row.liabilityAccountId === form.accountId);
    return card ? { method: 'card', cardId: card.id, accountId: '' } : {};
  };

  const selectedPaymentMethodId = formData.cardId
    ? `card:${formData.cardId}`
    : formData.accountId
      ? `account:${formData.accountId}`
      : '';

  /**
   * 결제수단 선택 반영.
   *
   * 카드를 고르면 지출로 고정한다. 카드로는 수입이나 이체를 만들 수 없고,
   * 유형이 남아 있으면 카테고리 목록이 어긋난다.
   */
  const handlePaymentMethodChange = (value: string) => {
    // "선택 안 함"은 빈 값이다. 아래 계좌 갈래로 가서 계좌와 카드를 함께 비운다.
    const [kind, id = ''] = value.split(':');

    const methodCurrency =
      kind === 'card' ? currencyOfMethod(null, id) : currencyOfMethod(id, null);

    /*
     * 결제수단을 고르면 입력 통화도 그 계좌 통화로 맞춘다.
     *
     * 달러 통장을 고르면 달러로 입력하는 것이 자연스럽다. 다만 사용자가 통화를
     * 직접 골라 둔 뒤라면 그 선택을 지우지 않는다. "$1을 국민카드로 결제"를
     * 입력하다가 카드를 바꿨다고 통화가 원화로 되돌아가면 매번 다시 골라야 한다.
     *
     * 새 결제수단이 그 통화를 감당하지 못하면 되돌린다. 원장이 다루는 조합은
     * "계좌 통화 == 입력 통화"(달러 통장의 달러 결제)와 "계좌 통화 == 기준통화"
     * (원화 카드의 외화 결제) 둘뿐이라, 엔화 통장에 달러 같은 조합은 서버가 막는다.
     */
    const nextCurrency = (prev: { currency: CurrencyCode; currencyTouched: boolean }) =>
      prev.currencyTouched &&
      (methodCurrency === prev.currency || methodCurrency === ledgerCurrency)
        ? prev.currency
        : methodCurrency;

    /** 통화가 바뀐 만큼 청구액도 다시 받는다. 통화가 그대로면 건드리지 않는다. */
    const currencyFields = (prev: EntryFormValues) => {
      const currency = nextCurrency(prev);
      if (currency === prev.currency) return { currency };

      return {
        currency,
        // 청구액은 결제수단마다 달라지는 값이라 그대로 둘 수 없다.
        billedAmount: '',
        currencyTouched: false,
      };
    };

    /*
     * 할부를 못 받는 결제수단으로 바꾸면 개월수를 지운다.
     *
     * 칸이 사라져도 값이 남아 있으면 화면에 보이지 않는 할부가 그대로 저장된다.
     * 신용카드에서 신용카드로 옮길 때는 유지한다. 같은 조건이라 다시 고를 이유가 없다.
     */
    const keepsInstallment =
      kind === 'card' && cards.find((c) => c.id === id)?.cardType === 'credit';

    if (kind === 'card') {
      setFormData((prev) => {
        // 카드로는 이체를 만들 수 없다. 이체 중이었으면 지출로 돌린다.
        const type = prev.type === 'transfer' ? 'expense' : prev.type;
        // 갈래가 바뀌면 그 갈래의 분류가 아니다. 나눈 줄도 함께 버린다.
        const keepsCategory = type === prev.type;

        return {
          ...prev,
          method: 'card',
          cardId: id,
          accountId: '',
          type,
          ...currencyFields(prev),
          installmentMonths: keepsInstallment ? prev.installmentMonths : '',
          installmentInterest: keepsInstallment ? prev.installmentInterest : '',
          installmentShares: keepsInstallment ? prev.installmentShares : [],
          installmentInterestMode: keepsInstallment ? prev.installmentInterestMode : '',
          installmentMonthlyPayment: keepsInstallment ? prev.installmentMonthlyPayment : '',
          installmentAnnualRate: keepsInstallment ? prev.installmentAnnualRate : '',
          installmentInterestShares: keepsInstallment ? prev.installmentInterestShares : [],
          mainCategoryId: keepsCategory ? prev.mainCategoryId : '',
          subCategoryId: keepsCategory ? prev.subCategoryId : '',
          splits: keepsCategory ? prev.splits : [],
        };
      });
      return;
    }

    setFormData((prev) => ({
      ...prev,
      method: 'account',
      accountId: id,
      cardId: '',
      installmentMonths: '',
      installmentInterest: '',
      installmentShares: [],
      installmentInterestMode: '',
      installmentMonthlyPayment: '',
      installmentAnnualRate: '',
      installmentInterestShares: [],
      ...currencyFields(prev),
    }));
  };

  /**
   * 분류를 나눈 줄을 더한다.
   *
   * 첫 줄에는 **지금까지 적은 금액과 분류**를 옮겨 담는다. 빈 줄 둘로 시작하면 이미
   * 적어 둔 것을 다시 적어야 한다. 앱의 `useEntryForm.addSplit` 과 같은 규칙이다.
   */
  const addSplitRow = () => {
    setFormData((prev) => ({
      ...prev,
      splits:
        prev.splits.length > 0
          ? [...prev.splits, blankSplitRow()]
          : [
              /*
               * 첫 줄은 지금까지 적은 값을 그대로 물려받는다. **줄 키도 함께 옮긴다** --
               * 이미 저장된 거래를 나누는 중이면, 그 키에 붙어 있던 태그와 차감이 첫
               * 줄에 그대로 이어져야 한다.
               */
              {
                mainCategoryId: prev.mainCategoryId,
                subCategoryId: prev.subCategoryId,
                amount: prev.amount,
                lineKey: prev.lineKey,
                discountAmount: prev.discountAmount,
                tagIds: prev.tagIds,
              },
              blankSplitRow(),
            ],
    }));
    setError('');
  };

  /**
   * 나눈 줄을 뺀다. 하나만 남으면 나누기를 그만둔다.
   *
   * 줄 하나짜리 분할은 분류 하나짜리 거래와 같은 전표라, 그때는 원래 칸으로 되돌려
   * 화면을 단순하게 둔다.
   */
  const removeSplitRow = (index: number) => {
    setFormData((prev) => {
      const rest = prev.splits.filter((_, at) => at !== index);
      if (rest.length > 1) return { ...prev, splits: rest };

      const only = rest[0];
      return {
        ...prev,
        splits: [],
        // 나눌 때 위 칸에서 옮겨 간 줄 키·차감·태그도 함께 되돌린다 (core useEntryForm 의 removeSplit 과 같다).
        ...(only
          ? {
              mainCategoryId: only.mainCategoryId,
              subCategoryId: only.subCategoryId,
              amount: only.amount,
              lineKey: only.lineKey,
              discountAmount: only.discountAmount,
              tagIds: only.tagIds,
            }
          : {}),
      };
    });
    setError('');
  };

  /** 나눈 줄 하나의 칸을 고친다. */
  const updateSplitRow = (index: number, patch: Partial<EntryFormSplitRow>) => {
    setFormData((prev) => ({
      ...prev,
      splits: prev.splits.map((split, at) => (at === index ? { ...split, ...patch } : split)),
    }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 저장 전 검사. 규칙과 까닭은 entry-submit 의 `entryFormErrorKey` 에 있다.
    const errorKey = entryFormErrorKey(formData, submitContext);
    if (errorKey) {
      setError(t(errorKey));
      return;
    }

    try {
      /*
       * 함께 적은 페이백도 지출을 저장하기 **전에** 본다. 지출만 저장되고 페이백이 거절되면
       * 반쯤 저장된 상태가 남는다 (core 의 usePaybackDrafts).
       */
      if (formData.type === 'expense') {
        const paybackError = paybackDrafts.check(paybackLines);
        if (paybackError) {
          setError(paybackError);
          return;
        }
      }
      setIsSubmitting(true);
      // 입력한 날짜/시각은 프로젝트 타임존의 벽시계다. 그 기준으로 UTC 인스턴트를 만든다.
      // 시간을 비우면 그 지역의 하루 시작이 된다.
      const dateValue = zonedFormValueToUtc(
        formData.date,
        formData.time || undefined,
        timeZone,
      ).toISOString();

      const { kind, payload } = buildEntryPayload(formData, dateValue, submitContext);

      let savedId: string | null = editingId;

      /*
       * 쓰기는 창구(`entryWritePort`)를 지난다 (2026-10-16). 웹의 창구는 서버에 곧바로 쓰므로 동작은
       * 같고, 앱·목록·카드 정산과 쓰는 길이 하나로 모여 쓰기 규칙이 한곳에서 지켜진다.
       */
      const port = entryWritePort();
      if (editingId) {
        // 팝업을 열 때 본 판을 함께 보낸다. 그 사이의 편집을 서버가 알아채는 근거다.
        await port.updateEntry(editingId, { ...payload, baseHlc });
      } else {
        /*
         * 새 거래의 id 는 첫 저장 시도에서 정해 두고, 성공할 때까지 같은 것을 쓴다 (2026-10-16).
         *
         * 저장 요청이 시간 초과(10초)로 끊겨도 서버는 이미 적었을 수 있다. 다시 누를 때마다 새 id 를 받으면
         * 같은 거래가 둘 생겼다. 같은 id 로 다시 보내면 서버가 "이미 있다"(409)고 답하므로, 그때는 그 거래를
         * 지금 폼 값으로 고친다 -- 다시 누르기 전에 고친 칸까지 반영된다.
         */
        // 난수원이 없는 브라우저면 id 를 서버에 맡긴다 (지금까지와 같다).
        if (!pendingCreateIdRef.current && hasRandomSource()) pendingCreateIdRef.current = newId();
        const id = pendingCreateIdRef.current;
        try {
          const created = await port.createEntry({ ...payload, ...(id ? { id } : {}), projectId: projectId });
          savedId = created.id;
        } catch (createError) {
          if (!id || (createError as { response?: { status?: number } })?.response?.status !== 409) {
            throw createError;
          }
          await port.updateEntry(id, payload);
          savedId = id;
        }
        pendingCreateIdRef.current = null;
      }

      /*
       * 함께 적은 페이백. 지출이 저장된 뒤라야 걸 곳이 있다.
       *
       * 실패하면 창을 닫지 않는다. 지출은 이미 저장되었으므로 이 폼은 이제 그 지출을 고치는
       * 폼이다 -- 다시 누르면 같은 지출을 또 만드는 대신 그것을 고치고 남은 페이백만 저장한다.
       */
      if (kind === 'expense' && savedId && paybackDrafts.drafts.length > 0) {
        const result = await paybackDrafts.saveFor({
          id: savedId,
          personId: formData.personId || null,
          description: payload.description,
          lines: paybackLines,
        });
        if (result.error) {
          await onEntryChange({ entryId: savedId });
          setEditingId(savedId);
          setBaseHlc(null);
          setError(result.error);
          return;
        }
        setPaybackReload((count) => count + 1);
      }

      await onEntryChange({ entryId: savedId });
      setFormData(emptyEntryForm(timeZone, ledgerCurrency));
      setEditingId(null);
      setBaseHlc(null);
      setError('');
      setIsModalOpen(false);
    } catch (err) {
      /*
       * 서버가 코드로 말한 이유를 그대로 보여 준다.
       *
       * "수정에 실패했습니다" 하나로 덮으면 무엇을 해야 할지 알 수 없다. 특히 다른
       * 사람이 먼저 고친 경우(`ENTRY_MODIFIED`)에는 다시 눌러도 소용이 없고, 목록을
       * 다시 읽어 그 위에서 고쳐야 한다.
       */
      setError(messageOf(err, editingId ? 'editor.editFailed' : 'editor.addFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 새 거래 입력 시작.
   *
   * 빈 폼에서 시작한다. 예전에는 남아 있던 값 위에 날짜만 덮어써서, 직전에 무엇을
   * 했는지가 새 거래에 따라 들어왔다.
   *
   * 시각은 지금으로 채운다. 비워 두면 그 날 0시로 기록되므로 입력 시점을 그대로
   * 남기려면 기본값이 있어야 한다.
   */
  const handleAddClick = () => {
    pendingCreateIdRef.current = null;
    paybackDrafts.reset();
    setEditingEntry(null);
    setEditingId(null);
    setBaseHlc(null);
    setError('');
    setFormData((prev) => ({
      ...emptyEntryForm(timeZone, ledgerCurrency),
      time: nowTimeKey(timeZone),
      // "나"를 지정해 두면 사용자를 매번 고르지 않아도 된다. 이것만 이어받는다.
      personId: prev.personId || myPersonId || '',
    }));
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    pendingCreateIdRef.current = null;
    setIsModalOpen(false);
    setFormData(emptyEntryForm(timeZone, ledgerCurrency));
    setEditingId(null);
    setBaseHlc(null);
    setError('');
  };

  const handleDetailEditClick = () => {
    if (!selectedTransaction) return;
    setIsDetailModalOpen(false);
    handleEditClick(selectedTransaction);
  };

  /** 상세의 베끼기. 상세를 닫고 값이 든 추가 팝업을 세운다. */
  const handleDetailCopyClick = () => {
    if (!selectedTransaction) return;
    setIsDetailModalOpen(false);
    handleCopyClick(selectedTransaction);
  };

  /*
   * 차감·취소 칸을 폈는가. 금액 아래 "할인·차감 추가" 단추가 편다 (2026-10-10 사용자 요청). 적어 둔
   * 값이 있으면 단추 없이 펴 둔다 -- 고치려고 연 거래의 차감이 숨으면 있는 줄도 모른다. 팝업을
   * 열 때마다 접는다.
   */
  const [isDiscountOpen, setIsDiscountOpen] = useState(false);
  useEffect(() => {
    if (isModalOpen) setIsDiscountOpen(false);
  }, [isModalOpen]);
  const isDiscountShown = isDiscountOpen || formData.discountAmount !== '';
  /** 나눈 줄마다의 차감 칸. 줄 키로 든다 -- 줄을 지우면 뒤의 번호가 당겨진다. */
  const [openDiscountLines, setOpenDiscountLines] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (isModalOpen) setOpenDiscountLines(new Set());
  }, [isModalOpen]);
  const isSplitDiscountShown = (split: EntryFormSplitRow) =>
    openDiscountLines.has(split.lineKey) || split.discountAmount !== '';
  const openSplitDiscount = (lineKey: string) =>
    setOpenDiscountLines((prev) => new Set(prev).add(lineKey));
  const closeSplitDiscount = (lineKey: string) =>
    setOpenDiscountLines((prev) => {
      const next = new Set(prev);
      next.delete(lineKey);
      return next;
    });

  /**
   * 함께 적는 페이백이 고를 원거래의 줄. 지출에만 있다.
   *
   * 줄 키는 폼이 들고 있는 그대로다 -- 지출을 저장해도 바뀌지 않아, 저장 직후 페이백을 그
   * 줄에 걸 수 있다.
   */
  const categoryNameOf = (categoryId: string) =>
    categories.find((category) => category.id === categoryId)?.name ?? '';
  /*
   * 나눈 줄은 분류 이름에 적은 금액을 붙인다. 같은 분류를 두 줄로 나눴어도 가릴 수 있게.
   * 외화로 적는 중일 수 있어 통화 기호 없이 적은 그대로 붙인다.
   */
  const paybackLineLabel = (name: string, amount: string) =>
    `${name || '-'}${amount.trim() ? ` · ${amount.trim()}` : ''}`;
  const paybackLines =
    formData.type !== 'expense'
      ? []
      : hasSplits
        ? formData.splits.map((split) => {
            const categoryId = split.subCategoryId || split.mainCategoryId;
            return { lineKey: split.lineKey, categoryId, label: paybackLineLabel(categoryNameOf(categoryId), split.amount) };
          })
        : [
            {
              lineKey: formData.lineKey,
              categoryId: formData.subCategoryId || formData.mainCategoryId,
              label: categoryNameOf(formData.subCategoryId || formData.mainCategoryId),
            },
          ];
  /** 새 페이백 줄의 들어온 곳. 지금 고른 결제수단에 연결된 통장이다 (`paybackMethodOf`). */
  const paybackDefaultMethod = paybackMethodOf(
    formData.method === 'card' && formData.cardId
      ? `card:${formData.cardId}`
      : formData.accountId
        ? `account:${formData.accountId}`
        : '',
    cards,
    (value) => paymentMethodOptions.some((option) => option.id === value),
  );

  /** 저장 전 검사와 짐 만들기가 함께 보는 셈한 값들. */
  const submitContext: EntrySubmitContext = {
    ledgerCurrency,
    transferBothCards,
    transferCardSide,
    canInstall,
    hasSplits,
    hasBilled,
    isCrossCurrencyTransfer,
    installmentBase,
    interestInputs,
    totalDiscount,
  };

  /** 지금 유형의 대분류. 대표 분류 칸과 나눈 줄이 함께 쓴다. */
  const mainCategoryOptions = useMemo(
    () =>
      categories
        .filter((c) => !c.parentId && c.type === formData.type)
        .map((cat) => ({ id: cat.id, name: cat.name })),
    [categories, formData.type],
  );

  /** 고른 대분류에 딸린 소분류. 대분류를 고르기 전에는 고를 것이 없다고 알린다. */
  const subCategoryOptions = (mainCategoryId: string) =>
    subCategoryOptionsOf(categories, mainCategoryId, t('editor.none'));

  /** 아직 줄에 담기지 않은 금액. 저장을 눌러 보기 전에 보여 준다. */
  const splitLeft = useMemo(() => {
    const total = formData.splits.reduce(
      (sum, split) => sum.plus(splitAmountOf(split.amount) ?? Dec.of(0)),
      Dec.of(0),
    );
    return Dec.of(toAmountString(formData.amount)).minus(total).toString();
  }, [formData.amount, formData.splits]);

  /** 있는 거래를 폼 값으로 (고치기와 베끼기가 함께 쓴다, `formValuesOfEntry`). */
  const formValuesOf = (entry: EntryListItem) =>
    formValuesOfEntry(entry, { categories, ledgerCurrency, timeZone, currencyOfMethod });

  const handleEditClick = (entry: EntryListItem) => {
    if (!isEditableEntry(entry)) {
      setError(t('editor.notEditable'));
      return;
    }
    // 페이백은 따로 고친다. 이 폼에는 원거래의 줄을 고르는 칸이 없다.
    if (entry.kind === 'payback') {
      setPaybackTarget({ editing: entry });
      return;
    }

    /*
     * 줄이 실려 오지 않은 분할은 열지 않는다 (옛 서버가 그렇다).
     *
     * 폼에는 대표 분류 하나만 담기고, 그대로 저장하면 나머지 줄이 사라진다. 열지
     * 않으면 적어도 있던 거래가 그 자리에 남는다. 앱도 같은 규칙이다
     * (core 의 entryFormValuesOf).
     */
    if (isSplitEntry(entry) && entry.lines.length !== entry.splitCount) {
      setError(t('editor.notEditable'));
      return;
    }
    /*
     * 외화 분할도 열지 않는다 (앱의 entryFormFromItem 과 같다). 줄 금액은 장부 통화의 환산액이라
     * 적은 통화로 되돌리면 끝수가 원래 값과 어긋나고, 그대로 펴면 줄 합이 전체와 맞지 않는다.
     */
    if (isSplitEntry(entry) && (entry.editSource ?? entry).originalCurrency) {
      setError(t('editor.notEditable'));
      return;
    }

    setEditingId(entry.id);
    paybackDrafts.reset();
    setEditingEntry(entry);
    // 이 줄을 본 시점의 판. 저장할 때 되돌려 주어 그 사이의 편집을 알아채게 한다.
    setBaseHlc(entry.updatedHlc);
    setFormData(formValuesOf(entry));
    setIsModalOpen(true);
    setError('');
  };

  /**
   * 내용만 베껴 새로 적기.
   *
   * 값은 고치기와 같은 자리에서 채우고, 어느 거래를 고치는가(`editingId`)와 그 거래를
   * 본 시점의 판(`baseHlc`)만 들지 않는다. 하나라도 남으면 저장이 새 거래를 만드는
   * 대신 베낀 원본을 덮어쓴다. 날짜와 시각도 그대로 둔다 -- 베끼는 까닭이 대개 "같은
   * 자리에서 또"라, 오늘로 바꿔 두면 되레 고칠 칸이 늘어난다.
   */
  const handleCopyClick = (entry: EntryListItem) => {
    if (!isCopyableEntry(entry)) {
      setError(t('editor.notEditable'));
      return;
    }

    pendingCreateIdRef.current = null;
    paybackDrafts.reset();
    setEditingEntry(null);
    setEditingId(null);
    setBaseHlc(null);
    setFormData(formValuesOf(entry));
    setIsModalOpen(true);
    setError('');
  };

  /** 보관함의 후보로 폼을 채운다 (`formValuesOfDraft`). */
  const handleDraftClick = (draft: EntryDraftDto.Response) => {
    pendingCreateIdRef.current = null;
    paybackDrafts.reset();
    setEditingEntry(null);
    setEditingId(null);
    setBaseHlc(null);
    setFormData(formValuesOfDraft(draft, { categories, ledgerCurrency, timeZone, myPersonId }));
    setIsModalOpen(true);
    setError('');
  };

  /** 지웠으면 true. 묻는 창에서 그만두었거나 실패하면 false 다. */
  const handleDeleteClick = async (entry: EntryListItem): Promise<boolean> => {
    // 원거래면 걸린 환불·페이백도 함께 지워진다. 그 수를 함께 묻는다 (7-6).
    const note = paybackDeleteNote(await paybackCountOf(entry, projectId), t);
    if (!window.confirm([t('account.deleteConfirm'), note].filter(Boolean).join('\n'))) return false;
    try {
      setIsSubmitting(true);
      await entryWritePort().deleteEntry(entry.id);
      await onEntryChange();
      return true;
    } catch (err: any) {
      const errorMsg = messageOf(err, 'editor.deleteFailed');
      /*
       * 입력 창이 닫혀 있으면(상세에서 지울 때) 그 창의 오류 칸은 보이지 않는다 (2026-10-16). 그때는 알림으로 띄운다.
       */
      if (isModalOpen) setError(errorMsg);
      else window.alert(errorMsg);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePersonModalSuccess = (updatedPeople: Person[]) => {
    onReferenceDataChange({ people: updatedPeople });
    setStorePeople(updatedPeople);
    setIsPersonModalOpen(false);
  };

  /**
   * 태그 하나를 만들고 그 자리에서 고른다.
   *
   * 태그를 만들러 창을 연 이유는 그 태그로 이 거래를 묶으려는 것이다. 목록만 갱신하고
   * 두면 알약 줄에서 같은 값을 한 번 더 눌러야 한다 (소분류를 만들 때와 같은 뜻이다).
   */
  const handleTagCreate = async (values: TagFormValues) => {
    const result = await quickAdd.addTag({
      name: values.name,
      ...(values.color ? { color: values.color } : {}),
    });
    if (!result.ok || !result.id) return result;

    await reloadTags();
    const id = result.id;
    setFormData((previous) =>
      previous.tagIds.includes(id) ? previous : { ...previous, tagIds: [...previous.tagIds, id] },
    );
    return result;
  };

  useImperativeHandle(ref, () => ({
    openDetail: (entry: EntryListItem) => {
      setSelectedTransaction(entry);
      setIsDetailModalOpen(true);
    },
    openAdd: handleAddClick,
    openCopy: handleCopyClick,
    openEdit: handleEditClick,
    openDraft: handleDraftClick,
    openPayback: (original: EntryListItem) => setPaybackTarget({ original }),
  }));

  return (
    <>
      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={editingId ? t('editor.titleEdit') : t('editor.titleAdd')}
        /* 버튼은 form 밖(하단 고정 영역)이라 form 속성으로 묶는다 */
        footer={
          <button
            type="submit"
            form={ENTRY_FORM_ID}
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting
              ? t(editingId ? 'account.editing' : 'account.adding')
              : t(editingId ? 'account.editSubmit' : 'account.addSubmit')}
          </button>
        }
      >
        <form id={ENTRY_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
          {/* 날짜와 시각은 맨 위에 둔다 (2026-10-10 사용자 요청). 자주 고치는 값이다. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.date')}</label>
              <input
                type="date"
                required
                value={formData.date}
                /* 원장 하한(기초잔액 전표 날짜)까지만 거슬러 올라간다 */
                min={LEDGER_MIN_ENTRY_DATE_KEY}
                // 연도 오타(2026 -> 2926)를 서버 400 전에 브라우저가 막는다
                max={ledgerMaxEntryDateKey()}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.time')}</label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 유형을 날짜 아래에서 탭으로 고른다. 아래 입력이 유형에 따라 달라지므로 먼저 정한다. */}
          <div role="tablist" aria-label={t('editor.kindTablist')} className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {ENTRY_TYPE_TABS.map((tab) => {
              /*
                카드로는 이체를 만들 수 없다. 지출과 수입은 둘 다 된다.
                (카드사가 되돌려 주는 돈은 그 카드의 빚이 주는 수입이다.)
                카드대금 결제는 이체에서 카드 부채 계정을 골라 적는다.
              */
              const disabled = formData.method === 'card' && tab.id === 'transfer';
              const selected = formData.type === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  disabled={disabled}
                  onClick={() => setFormData({
                    ...formData,
                    /*
                      이체에서 카드를 부채 계정으로 고른 채 지출·수입으로 옮기면 그 카드로 바꾼다 (2026-10-16, core
                      useEntryForm 과 같다). 그대로 두면 거래가 카드가 아니라 부채 계정에 붙어 카드 실적에서 빠졌다.
                    */
                    ...(tab.id !== 'transfer' ? cardInsteadOfLiability(formData) : {}),
                    type: tab.id,
                    mainCategoryId: '',
                    subCategoryId: '',
                    // 분류를 버리면 그것을 나눈 줄도 함께 버린다. 지출 분류로 나눠 둔
                    // 줄이 수입에 남으면 고를 수 없는 분류가 적힌 채 저장된다.
                    splits: [],
                    // 차감은 지출에만 뜻이 있다. 칸이 사라져도 값이 남으면
                    // 화면에 보이지 않는 값으로 저장이 거절된다.
                    discountAmount: '',
                    /*
                      실적 포함은 갈래마다 기본값이 다르다. 그대로 두면 지출에서 켠
                      값이 수입으로 따라와, 켠 적 없는 캐시백이 실적을 깎는다.
                    */
                    countsPerformance: defaultCountsPerformance(tab.id),
                    // 차감에 딸린 값이라 함께 되돌린다. 차감 자체도 위에서 비운다.
                    discountCountsPerformance: true,
                  })}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition ${
                    selected
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  } ${disabled ? 'opacity-40 cursor-not-allowed hover:text-gray-600' : ''}`}
                >
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </div>

          {/* 금액은 유형 바로 아래에 둔다. 팝업이 열릴 때 여기로 포커스가 가므로
              아래쪽에 있으면 본문이 스크롤돼 유형 탭이 가려진다. */}
          <AmountField
            formData={formData}
            setFormData={setFormData}
            ledgerCurrency={ledgerCurrency}
            paymentCurrency={paymentCurrency}
            needsRate={needsRate}
            needsBilled={needsBilled}
            mustBill={mustBill}
            hasBilled={hasBilled}
            isCreditCardSelected={isCreditCardSelected}
            derivedRate={derivedRate}
            defaultRate={rateOf(formData.currency)}
            convertedPreview={convertedPreview}
          />

          <DiscountFields
            formData={formData}
            setFormData={setFormData}
            hasSplits={hasSplits}
            isDiscountShown={isDiscountShown}
            onOpen={() => setIsDiscountOpen(true)}
            onClose={() => setIsDiscountOpen(false)}
            showPerformance={showDiscountPerformance({
              kind: formData.type === 'income' ? 'income' : 'expense',
              discountAmount: totalDiscount,
              countsPerformance: formData.countsPerformance,
              isCard: formData.method === 'card' && Boolean(formData.cardId),
              isLedgerCurrency: formData.currency === ledgerCurrency,
            })}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('editor.descriptionOptional')}
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('editor.descriptionPlaceholder')}
            />
          </div>

          {formData.type !== 'transfer' && (
            <CategoryFields
              formData={formData}
              setFormData={setFormData}
              hasSplits={hasSplits}
              ledgerCurrency={ledgerCurrency}
              mainCategoryOptions={mainCategoryOptions}
              subCategoryOptions={subCategoryOptions}
              onAddCategory={categoryAdd.open}
              onAddSplit={addSplitRow}
              onRemoveSplit={removeSplitRow}
              onUpdateSplit={updateSplitRow}
              isSplitDiscountShown={isSplitDiscountShown}
              onOpenSplitDiscount={openSplitDiscount}
              onCloseSplitDiscount={closeSplitDiscount}
              tags={tags}
              splitLeft={splitLeft}
            />
          )}

          {/*
            태그. **나눈 거래에서는 감춘다.** 그때는 태그가 줄마다 붙으므로 위의 줄 칸에서
            고른다. 둘이 함께 보이면 어느 쪽이 저장되는지 알 수 없다.
          */}
          {!hasSplits && (
            <EntryTagField
              tags={tags}
              selectedIds={formData.tagIds}
              onAddClick={() => setIsTagModalOpen(true)}
              /*
               * 앞선 값에서 뒤집는다. 이 폼의 다른 칸과 달리 함수형으로 넘긴다.
               *
               * `{...formData}` 로 두면 그릴 때 잡힌 값을 쓰므로, 한 번 그리기 전에
               * 두 개를 잇달아 누르면 뒤엣것이 앞엣것을 덮어써 하나만 남는다
               * (실제로 그랬다). 다른 칸은 값을 갈아 끼우기만 해서 드러나지 않지만
               * 여기는 앞선 목록에 더하고 빼는 자리다.
               */
              onToggle={(tagId) =>
                setFormData((previous) => ({ ...previous, tagIds: toggleId(previous.tagIds, tagId) }))
              }
            />
          )}

          <MethodField
            formData={formData}
            setFormData={setFormData}
            accounts={accounts}
            cards={cards}
            transferFromOptions={transferOptionsFor(formData.toAccountId)}
            paymentMethodOptions={paymentMethodOptions}
            selectedPaymentMethodId={selectedPaymentMethodId}
            onPaymentMethodChange={handlePaymentMethodChange}
            onAddMethod={() => setIsMethodChooserOpen(true)}
            isCreditCardSelected={isCreditCardSelected}
          />

          {formData.type === 'transfer' && (
            <TransferFields
              formData={formData}
              setFormData={setFormData}
              categories={categories}
              toAccountOptions={transferOptionsFor(formData.accountId)}
              isCrossCurrencyTransfer={isCrossCurrencyTransfer}
              paymentCurrency={paymentCurrency}
              toCurrency={toCurrency}
              transferCardSide={transferCardSide}
              onAddCategory={() => categoryAdd.open()}
            />
          )}

          {/*
            거래한 사람. 지정하지 않아도 된다 (2026-10-10 사용자 요청) -- 비우면 "미지정"으로 남는다.
          */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('editor.personOptional')}
            </label>
            <CustomSelect
              options={[
                { id: '', name: t('editor.personNone') },
                ...people.map((p) => ({ id: p.id, name: p.name })),
              ]}
              value={formData.personId}
              onChange={(value) => setFormData({ ...formData, personId: value })}
              onAddClick={() => setIsPersonModalOpen(true)}
              addButtonLabel={t('editor.addPerson')}
            />
          </div>

          {/* 페이백. 지출에만 선다 -- 받은 것은 보이고, 여기서 적은 것은 지출과 함께 저장된다. */}
          {formData.type === 'expense' ? (
            <PaybackFormSection
              original={editingId && editingEntry?.id === editingId ? editingEntry : null}
              drafts={paybackDrafts}
              lines={paybackLines}
              methodOptions={paymentMethodOptions}
              defaultMethod={paybackDefaultMethod}
              reloadToken={paybackReload}
              onOpenPayback={(payback) => setPaybackTarget({ editing: payback })}
            />
          ) : null}

          {/*
            할부. 자주 쓰는 값이 아니라 폼 맨 아래에 둔다.

            원금과 지출은 구매 시점에 전액 잡히고, 카드 화면의 주기별 사용액만 나뉜다.
          */}
          {canInstall && (
            <InstallmentFields
              formData={formData}
              setFormData={setFormData}
              installmentBase={installmentBase}
              shareInputs={shareInputs}
              interestInputs={interestInputs}
            />
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.merchant')}</label>
            <input
              type="text"
              value={formData.merchant}
              onChange={(e) => setFormData({ ...formData, merchant: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('editor.merchantPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.memo')}</label>
            <input
              type="text"
              value={formData.detailedNote}
              onChange={(e) => setFormData({ ...formData, detailedNote: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('editor.memoPlaceholder')}
            />
          </div>

          {error && <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{error}</div>}
        </form>
      </Modal>

      {/* 결제수단 드롭다운의 추가 버튼. 계좌와 카드를 한 목록에서 고르므로 종류를 여기서 묻는다. */}
      <ChoiceModal
        isOpen={isMethodChooserOpen}
        onClose={() => setIsMethodChooserOpen(false)}
        title={t('editor.addMethod')}
        choices={[
          {
            key: 'account',
            icon: '🏦',
            label: t('account.add'),
            description: t('account.addDescription'),
            tone: 'green',
            onSelect: () => {
              setIsMethodChooserOpen(false);
              setIsAccountModalOpen(true);
            },
          },
          {
            key: 'card',
            icon: '💳',
            label: t('card.add'),
            description: t('card.addDescription'),
            tone: 'purple',
            onSelect: () => {
              setIsMethodChooserOpen(false);
              setIsCardModalOpen(true);
            },
          },
        ]}
      />

      <AddTagModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        onSubmit={handleTagCreate}
        isSubmitting={quickAdd.isSubmitting}
      />

      <PersonModal
        isOpen={isPersonModalOpen}
        onClose={() => setIsPersonModalOpen(false)}
        person={null}
        mode="add"
        projectId={projectId}
        onSuccess={handlePersonModalSuccess}
        onDelete={async () => {}}
      />

      <AddAccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onSuccess={(newAccounts) => onReferenceDataChange({ accounts: newAccounts })}
        people={people}
        projectId={projectId}
      />

      <QuickCardModal
        isOpen={isCardModalOpen}
        onClose={() => setIsCardModalOpen(false)}
        projectId={projectId}
        accounts={accounts}
        ledgerCurrency={ledgerCurrency}
        onCardsChange={(data) => onReferenceDataChange({ cards: data })}
      />

      <CategoryAddModal form={categoryAdd} />

      <PaybackEditor
        target={paybackTarget}
        onClose={() => setPaybackTarget(null)}
        onSaved={async () => {
          setPaybackReload((count) => count + 1);
          await onEntryChange();
        }}
      />

      <EntryDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        entry={selectedTransaction}
        canEdit={canEdit}
        isSubmitting={isSubmitting}
        accounts={accounts}
        cards={cards}
        paybackReload={paybackReload}
        onCopy={handleDetailCopyClick}
        onEdit={handleDetailEditClick}
        onDelete={async () => {
          // 지운 뒤에만 상세를 닫는다 (2026-10-16). 묻는 창에서 그만두면 보던 상세가 그대로 남는다.
          if (selectedTransaction && (await handleDeleteClick(selectedTransaction))) {
            setIsDetailModalOpen(false);
          }
        }}
        onAddPayback={(original) => {
          setIsDetailModalOpen(false);
          setPaybackTarget({ original });
        }}
        onOpenPayback={(payback) => setSelectedTransaction(payback)}
      />
    </>
  );
});

export default EntryEditor;
