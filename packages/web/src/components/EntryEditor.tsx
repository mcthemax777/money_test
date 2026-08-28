'use client';

import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { useUserFilter } from '@/store/user-filter';
import {
  useMyPersonId,
  useProjectDisplayCurrency,
  useProjectLedgerCurrency,
  useProjectTimeZone,
} from '@/store/project';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { useInstitutions } from '@/hooks/useInstitutions';
import { apiClient } from '@/lib/api-client';
import type { Account, Card, Category, Person } from '@/lib/types';
import { formatCurrency, formatNumber, toAmountString, toNumber } from '@/lib/money';
import {
  DAY_OF_MONTH_HINT,
  DAY_OF_MONTH_OPTIONS,
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@/lib/day-of-month';
import {
  dateKeyOf,
  formatDateTime,
  monthInputToIso,
  nowTimeKey,
  timeInputOf,
  todayKey,
} from '@/lib/datetime';
import {
  CURRENCY_LABEL,
  LEDGER_MIN_ENTRY_DATE_KEY,
  SUPPORTED_CURRENCIES,
  isCurrencyCode,
  ledgerMaxEntryDateKey,
  zonedFormValueToUtc,
  type CardTransferDirection,
  type CurrencyCode,
} from '@money/types';
import CustomSelect from '@/components/CustomSelect';
import CategoryFormFields, {
  NO_SUB_CATEGORIES,
  filledSubCategories,
  type SubCategoryRow,
} from '@/components/CategoryFormFields';
import ChoiceModal from '@/components/ChoiceModal';
import Modal from '@/components/Modal';
import AddAccountModal from '@/components/AddAccountModal';
import PersonModal from '@/components/PersonModal';
import type { EntryListItem } from '@/components/TransactionItem';
import CardColorPicker from '@/components/CardColorPicker';
import ExtraAmountModal from '@/components/ExtraAmountModal';
import CardPerformanceField from '@/components/CardPerformanceField';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const ENTRY_FORM_ID = 'entry-form';
const CARD_FORM_ID = 'card-form';
const CATEGORY_FORM_ID = 'category-form';

/** 카드사가 흔히 제공하는 할부 개월수. 빈 값이 일시불이다. */
const INSTALLMENT_OPTIONS = [
  { id: '', name: '일시불' },
  ...[2, 3, 4, 5, 6, 9, 10, 12, 18, 24, 36].map((m) => ({ id: String(m), name: `${m}개월` })),
];

/**
 * 빈 거래 입력 폼.
 *
 * 처음 상태, 저장한 뒤, 팝업을 닫을 때 모두 이 값으로 되돌린다.
 *
 * 예전에는 같은 객체를 세 곳에 따로 적어 두어 서로 어긋났다. 저장 뒤 되돌리는 쪽만
 * method가 'card'로 남아 있어서, 거래를 수정하고 나서 거래 추가를 열면 수입·이체 탭이
 * 잠겨 있었다(카드로는 지출만 만들 수 있어 탭을 잠근다). 팝업을 닫으면 다른 쪽 초기화가
 * 돌아 그때는 풀렸다.
 */
function emptyEntryForm(timeZone: string, ledgerCurrency: CurrencyCode) {
  return {
    method: 'account',
    accountId: '',
    cardId: '',
    personId: '',
    type: 'expense',
    mainCategoryId: '',
    subCategoryId: '',
    amount: '',
    description: '',
    merchant: '',
    detailedNote: '',
    toAccountId: '',
    /** 통화가 다른 환전에서 실제로 받은 금액 (받는 계좌 통화) */
    toAmount: '',
    transferFee: '',
    transferFeeMainCategoryId: '',
    transferFeeSubCategoryId: '',
    date: todayKey(timeZone),
    time: '',
    /**
     * 과소비(지출)·추가 수입(수입)으로 셀 금액. 빈 값이거나 "0"이면 일반 거래다.
     *
     * 참·거짓이 아니라 금액인 이유는, 한 거래가 통째로 과소비인 경우보다
     * 그중 일부만 과했던 경우가 흔하기 때문이다.
     */
    extraAmount: '',
    /** 할부 개월수. 빈 값이거나 1이면 일시불 */
    installmentMonths: '',
    /** 카드사 이체의 방향. 수정으로만 들어오며 그대로 되돌려 보낸다 */
    cardTransferDirection: 'payment' as CardTransferDirection,
    /** 위 금액을 입력한 통화. 결제수단을 고르면 그 계좌 통화로 맞춰진다. */
    currency: ledgerCurrency,
    /**
     * 통장에서 실제로 빠진 기준통화 금액. 환율 대신 이것을 넣을 수 있다.
     *
     * 환율은 카드사가 결제일에 정하는 값이라 미리 알 수 없고, 명세서에 찍히는
     * 것도 대개 금액이다. 둘 중 하나만 채운다.
     */
    billedAmount: '',
    /**
     * 통화를 사용자가 직접 골랐는지.
     *
     * 결제수단을 바꿀 때 통화를 덮어쓸지 가르는 값이다. 자동으로 채워진 통화는
     * 덮어써도 되지만, 사용자가 고른 통화는 지우면 안 된다.
     */
    currencyTouched: false,
  };
}

/** 거래 추가/수정 팝업 맨 위의 유형 탭 */
const ENTRY_TYPE_TABS = [
  { id: 'expense', label: '지출' },
  { id: 'income', label: '수입' },
  { id: 'transfer', label: '이체' },
] as const;

const ENTRY_KIND_LABEL: Record<string, string> = {
  expense: '지출',
  income: '수입',
  transfer: '이체',
  card_payment: '카드대금 결제',
  adjustment: '잔액 조정',
};

export interface EntryEditorHandle {
  /** 거래 상세 팝업을 연다. 목록에서 한 건을 눌렀을 때 부른다. */
  openDetail: (entry: EntryListItem) => void;
  /** 빈 폼으로 거래 추가 팝업을 연다. */
  openAdd: () => void;
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
  /** 거래를 저장하거나 지운 뒤. 화면이 목록·합계를 다시 불러온다. */
  onEntryChange: () => void | Promise<void>;
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
  const { setPeople: setStorePeople } = useUserFilter();
  // 날짜 입력과 표시는 브라우저 로컬이 아니라 프로젝트 기준 타임존으로 해석한다.
  const timeZone = useProjectTimeZone();
  // 거래 입력의 환율 기준은 **저장 통화**다. 표시 통화가 아니다.
  // 원장이 저장하는 환산액(baseAmount)이 저장 통화 기준이기 때문이다.
  const ledgerCurrency = useProjectLedgerCurrency();
  // 목록 금액은 표시 통화 환산액이다. 저장 통화와 같을 때만 그 값을 폼에 되돌릴 수 있다.
  const displayCurrency = useProjectDisplayCurrency();
  const { rateOf } = useExchangeRates();
  /** 설정에서 지정한 "구성원 중 나". 새 거래의 사용자 기본값이 된다. */
  const myPersonId = useMyPersonId();
  const { options: issuerOptions } = useInstitutions('card_issuer');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(() => emptyEntryForm(timeZone, ledgerCurrency));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<EntryListItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  /** 결제수단 드롭다운이 계좌·카드를 합쳤으므로 "무엇을 추가할지"는 이 팝업에서 고른다. */
  const [isMethodChooserOpen, setIsMethodChooserOpen] = useState(false);
  const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  // 계좌 추가 폼 상태는 AddAccountModal이 직접 들고 있다. 여기서는 열림 여부만 관리한다.
  const [cardFormData, setCardFormData] = useState({
    accountId: '',
    name: '',
    cardNumber: '',
    cardType: 'debit' as 'debit' | 'credit',
    issuerId: '',
    expiryDate: '',
    creditLimit: '',
    /** 혜택 조건이 되는 사용액. 체크카드도 쓴다 (달력 월로 센다). */
    performanceAmount: '',
    /** 카드 앞면 색. 빈 값이면 카드 종류의 기본색으로 그린다. */
    color: '',
    // 청구 주기는 마감일과 결제일 두 값으로 계산한다
    statementClosingDay: DEFAULT_STATEMENT_CLOSING_DAY,
    paymentDueDay: DEFAULT_PAYMENT_DUE_DAY,
  });
  const [cardSubmitting, setCardSubmitting] = useState(false);
  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    type: 'expense' as 'income' | 'expense',
    subCategories: NO_SUB_CATEGORIES as SubCategoryRow[],
  });
  /** 카테고리 추가가 실패한 이유. 예전에는 콘솔에만 남아 사용자는 아무 반응을 못 봤다. */
  const [categoryError, setCategoryError] = useState('');
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  /**
   * 소분류를 붙일 대분류 id. 비어 있으면 대분류를 새로 만드는 모드다.
   *
   * 카테고리 팝업 하나로 두 가지를 처리한다. 소분류는 반드시 대분류 밑에 붙으므로
   * "어느 대분류인가"만 다르고 받을 값(이름 목록)은 같다.
   */
  const [categoryParentId, setCategoryParentId] = useState('');
  /** 소분류 모드일 때의 대분류. 없으면 대분류를 새로 만드는 모드다. */
  const categoryParent = categories.find((c) => c.id === categoryParentId);


  /** 주인 없는 계좌·카드를 담는 묶음. 사람 목록에 없는 소유자를 조용히 버리지 않는다. */
  const OTHER_OWNER_GROUP = '기타';

  /**
   * 결제수단 드롭다운 옵션. 계좌와 카드를 한 목록에 합친다.
   *
   * 종류를 잃지 않도록 id에 접두사를 붙인다("account:xxx" / "card:xxx").
   * 라벨의 "(계좌)"/"(카드)"는 사용자가 종류를 구분하기 위한 표시다.
   *
   * 계좌 주인은 라벨에 붙이지 않고 고를 수 없는 머리글로 묶는다. 이름을 항목마다
   * 반복하면 정작 구분해야 할 계좌명이 뒤로 밀린다. 카드는 결제 통장을 따라
   * 그 통장 바로 아래에 둔다 — 어느 통장에서 빠져나가는 카드인지가 고를 때 필요한
   * 정보이기 때문이다.
   */
  const paymentMethodOptions = useMemo(() => {
    const cardsOfAccount = new Map<string, typeof cards>();
    for (const card of cards) {
      const list = cardsOfAccount.get(card.paymentAccountId) ?? [];
      list.push(card);
      cardsOfAccount.set(card.paymentAccountId, list);
    }

    const cardLabel = (card: (typeof cards)[number]) =>
      `(카드) ${card.name}${card.issuer?.name ? ` · ${card.issuer.name}` : ''}`;

    const options: Array<{ id: string; name: string; group: string }> = [];
    const listed = new Set<string>();

    const pushOwner = (group: string, owned: typeof accounts) => {
      for (const account of owned) {
        options.push({ id: `account:${account.id}`, name: `(계좌) ${account.name}`, group });
        for (const card of cardsOfAccount.get(account.id) ?? []) {
          options.push({ id: `card:${card.id}`, name: cardLabel(card), group });
          listed.add(card.id);
        }
      }
    };

    for (const person of people) {
      const owned = accounts.filter((account) => account.ownerId === person.id);
      if (owned.length > 0) pushOwner(person.name, owned);
    }

    // 주인이 없거나(시스템 계정) 사람 목록에 없는 주인의 계좌, 그리고 결제 통장이
    // 목록에 없는 카드는 맨 끝에 모은다.
    const knownOwnerIds = new Set(people.map((person) => person.id));
    const orphanAccounts = accounts.filter(
      (account) => !account.ownerId || !knownOwnerIds.has(account.ownerId),
    );
    if (orphanAccounts.length > 0) pushOwner(OTHER_OWNER_GROUP, orphanAccounts);

    for (const card of cards) {
      if (listed.has(card.id)) continue;
      options.push({ id: `card:${card.id}`, name: cardLabel(card), group: OTHER_OWNER_GROUP });
    }

    return options;
  }, [accounts, cards, people]);

  /**
   * 이체에서 고를 수 있는 계좌. 신용카드 부채 계정을 함께 넣는다.
   *
   * 부채 계정은 통장 목록(GET /accounts)에서 감춰져 있다. 지출 결제수단이나
   * 자산 화면에 새어 나가면 안 되므로 서버 목록을 열지 않고, 이미 받아 둔 카드에서
   * liabilityAccountId를 꺼내 이 화면에서만 조립한다.
   */
  const transferAccountOptions = useMemo(() => {
    const creditCards = cards.filter(
      (card) => card.cardType === 'credit' && card.liabilityAccountId,
    );

    const options: Array<{ id: string; name: string; group: string }> = [];
    const listed = new Set<string>();

    const pushOwner = (group: string, owned: typeof accounts) => {
      for (const account of owned) {
        options.push({ id: account.id, name: account.name, group });
        for (const card of creditCards.filter((c) => c.paymentAccountId === account.id)) {
          options.push({ id: card.liabilityAccountId!, name: `(카드) ${card.name}`, group });
          listed.add(card.id);
        }
      }
    };

    for (const person of people) {
      const owned = accounts.filter((account) => account.ownerId === person.id);
      if (owned.length > 0) pushOwner(person.name, owned);
    }

    const knownOwnerIds = new Set(people.map((person) => person.id));
    const orphanAccounts = accounts.filter(
      (account) => !account.ownerId || !knownOwnerIds.has(account.ownerId),
    );
    if (orphanAccounts.length > 0) pushOwner(OTHER_OWNER_GROUP, orphanAccounts);

    for (const card of creditCards) {
      if (listed.has(card.id)) continue;
      options.push({
        id: card.liabilityAccountId!,
        name: `(카드) ${card.name}`,
        group: OTHER_OWNER_GROUP,
      });
    }

    return options;
  }, [accounts, cards, people]);

  /** 이체 양쪽 중 카드 부채 계정인 쪽. 없으면 일반 이체다. */
  const transferCardSide = (() => {
    if (formData.type !== 'transfer') return null;
    const liabilityIds = new Set(
      cards.filter((c) => c.liabilityAccountId).map((c) => c.liabilityAccountId!),
    );
    const fromIsCard = liabilityIds.has(formData.accountId);
    const toIsCard = liabilityIds.has(formData.toAccountId);
    if (fromIsCard && !toIsCard) return 'refund' as const;
    if (toIsCard && !fromIsCard) return 'payment' as const;
    return null;
  })();

  /*
   * 통화.
   *
   * 기본값은 결제수단(또는 이체 보내는 계좌)의 통화다. 달러 통장을 고르면
   * 달러로 입력하게 되고, 원화 카드를 고른 채 통화만 달러로 바꾸면 "원화 카드로
   * 한 외화 결제"가 된다. 두 경우의 원장 모양은 서버가 갈라 준다.
   */
  const currencyOfAccount = (accountId: string): CurrencyCode => {
    const account = accounts.find((a) => a.id === accountId);
    return isCurrencyCode(account?.currency) ? account.currency : ledgerCurrency;
  };

  /** 결제수단의 통화. 카드는 결제 통장을 따른다. */
  const currencyOfMethod = (accountId?: string | null, cardId?: string | null): CurrencyCode => {
    if (cardId) {
      const card = cards.find((c) => c.id === cardId);
      return card ? currencyOfAccount(card.paymentAccountId) : ledgerCurrency;
    }
    if (accountId) return currencyOfAccount(accountId);
    return ledgerCurrency;
  };

  /** 지금 고른 결제수단의 통화 */
  const paymentCurrency = currencyOfMethod(formData.accountId, formData.cardId);

  const toCurrency: CurrencyCode = formData.toAccountId
    ? currencyOfAccount(formData.toAccountId)
    : ledgerCurrency;

  const isCrossCurrencyTransfer =
    formData.type === 'transfer' && Boolean(formData.toAccountId) && paymentCurrency !== toCurrency;

  /** 환율 칸을 보여 줄지. 기준통화로 입력하면 환산할 것이 없다. */
  const needsRate = formData.currency !== ledgerCurrency;

  /**
   * 청구액 칸을 보여 줄지.
   *
   * 원화 카드로 달러를 결제한 경우처럼 "결제수단은 기준통화, 입력은 외화"일 때만
   * 통장에서 빠진 금액이 따로 존재한다. 달러 통장에서 달러를 쓴 거래에는 그런
   * 금액이 없다. 계좌 통화 금액이 이미 사실이기 때문이다. 서버도 같은 조건으로
   * 받는다 (LedgerService.resolveBilled).
   */
  const needsBilled = needsRate && paymentCurrency === ledgerCurrency;

  /** 사용자가 청구액을 직접 넣었는지. 넣었으면 환율보다 우선한다. */
  const hasBilled = needsBilled && toNumber(formData.billedAmount) > 0;

  /**
   * 실제 금액을 지금 받아야 하는지.
   *
   * 청구액이 나중에 정해지는 것은 신용카드뿐이다. 통장과 체크카드는 결제하는
   * 자리에서 돈이 빠지므로 사용자가 금액을 알고, 확정할 화면도 따로 없다
   * (카드 대조는 신용카드 전용이다). 서버도 같은 규칙으로 막는다
   * (LedgerService.assertCanEstimate).
   */
  const isCreditCardSelected =
    cards.find((c) => c.id === formData.cardId)?.cardType === 'credit';
  const mustBill = needsBilled && !isCreditCardSelected;

  /**
   * 할부를 받을 수 있는지.
   *
   * 신용카드 지출만 된다. 체크카드는 결제 즉시 통장에서 빠져 나눌 청구가 없고,
   * 통장 결제도 마찬가지다. 서버도 같은 규칙으로 막는다(LedgerService.assertCanInstall).
   */
  const canInstall =
    formData.type === 'expense' && formData.method === 'card' && isCreditCardSelected;

  /**
   * 저장하면 얼마로 기록되는지. 저장 전에 눈으로 확인하게 한다.
   *
   * 청구액을 넣었으면 그 금액이 그대로 기록된다. 환율을 곱하지 않는다.
   */
  const convertedPreview = (() => {
    if (!needsRate) return '';
    if (hasBilled) return formatCurrency(formData.billedAmount, ledgerCurrency);

    const rate = Number(rateOf(formData.currency));
    const amount = Number(formData.amount);
    if (!Number.isFinite(rate) || !Number.isFinite(amount) || rate <= 0 || amount <= 0) return '';
    return formatCurrency(amount * rate, ledgerCurrency);
  })();

  /** 청구액을 넣었을 때 실제로 적용되는 환율. 저장 전에 함께 보여 준다. */
  const derivedRate = (() => {
    const amount = toNumber(formData.amount);
    if (!hasBilled || amount <= 0) return '';
    return formatNumber(Math.round((toNumber(formData.billedAmount) / amount) * 100) / 100);
  })();

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
    const [kind, id] = value.split(':');

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
    const currencyFields = (prev: typeof formData) => {
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
      setFormData((prev) => ({
        ...prev,
        method: 'card',
        cardId: id,
        accountId: '',
        type: 'expense',
        ...currencyFields(prev),
        installmentMonths: keepsInstallment ? prev.installmentMonths : '',
        mainCategoryId: prev.type === 'expense' ? prev.mainCategoryId : '',
        subCategoryId: prev.type === 'expense' ? prev.subCategoryId : '',
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      method: 'account',
      accountId: id,
      cardId: '',
      installmentMonths: '',
      ...currencyFields(prev),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.personId) {
      setError('사용자를 선택해주세요.');
      return;
    }

    // 수수료를 넣었으면 분류가 있어야 한다. 없이 보내면 서버가 거절하는데,
    // 그 오류만 보고는 어느 칸이 비었는지 알기 어렵다.
    if (
      formData.type === 'transfer' &&
      !transferCardSide &&
      toNumber(formData.transferFee) > 0 &&
      !formData.transferFeeMainCategoryId
    ) {
      setError('수수료 대분류를 선택해주세요.');
      return;
    }

    try {
      setIsSubmitting(true);
      // 입력한 날짜/시각은 프로젝트 타임존의 벽시계다. 그 기준으로 UTC 인스턴트를 만든다.
      // 시간을 비우면 그 지역의 하루 시작이 된다.
      const dateValue = zonedFormValueToUtc(
        formData.date,
        formData.time || undefined,
        timeZone,
      ).toISOString();

      // 화면의 개념을 그대로 보낸다. 서버가 전표(postings)로 번역한다.
      // card_payment는 수정으로만 들어온다 (새로 만드는 것은 자산 화면의 결제하기다).
      const kind =
        formData.type === 'card_payment'
          ? 'card_payment'
          : formData.type === 'income'
            ? 'income'
            : formData.type === 'transfer'
              ? 'transfer'
              : 'expense';
      const useCard = formData.method === 'card' && Boolean(formData.cardId);

      const payload: any = {
        kind,
        personId: formData.personId,
        // 금액은 문자열로 보낸다 (정밀도 손실 방지)
        amount: toAmountString(formData.amount),
        description: formData.description,
        date: dateValue,
        /*
         * 비워 두면 "0"을 보낸다. 서버가 분류 기본값으로 되돌리지 않게 뜻을 못박는다.
         * 금액 칸을 떠나지 않고 바로 저장하는 경우가 있어 여기서 한 번 더 맞춘다.
         */
        extraAmount: toAmountString(
          clampExtra(formData.extraAmount, kind === 'transfer' ? formData.transferFee : formData.amount) || '0',
        ),
      };

      // 기준통화면 통화·환율을 보내지 않는다. 서버가 계좌 통화로 알아서 본다.
      if (formData.currency !== ledgerCurrency) {
        payload.currency = formData.currency;
        // 환율은 보내지 않는다. 실제 금액이 있으면 그것을 보내고, 없으면
        // 서버가 설정된 환율로 추정한다 (신용카드만 가능).
        if (hasBilled) {
          payload.billedAmount = toAmountString(formData.billedAmount);
        }
      }

      if (formData.merchant) payload.merchant = formData.merchant;
      if (formData.detailedNote) payload.detailedNote = formData.detailedNote;

      if (kind === 'card_payment') {
        // 부채가 줄어드는 카드와 돈이 오가는 통장을 함께 보낸다. 둘 다 폼에서 고정이다.
        payload.cardId = formData.cardId;
        payload.accountId = formData.accountId;
        payload.cardTransferDirection = formData.cardTransferDirection;
        // 카드사 이체는 지출이 아니므로 분류도 과소비 금액도 없다.
        delete payload.extraAmount;
      } else if (kind === 'transfer') {
        payload.accountId = formData.accountId;
        payload.toAccountId = formData.toAccountId;
        // 통화가 다른 환전은 받은 금액을 그대로 적는다. 그러면 실제 적용된
        // 환율이 저절로 기록되고, 별도의 환차손익 처리가 필요 없다.
        if (isCrossCurrencyTransfer && formData.toAmount) {
          payload.toAmount = toAmountString(formData.toAmount);
        }
        // 카드사와의 이체에는 수수료가 붙지 않는다. 칸을 감췄어도 남은 값이 따라가지 않게 뺀다.
        if (formData.transferFee && !transferCardSide) {
          payload.transferFee = toAmountString(formData.transferFee);
          // 수수료는 소분류가 있으면 소분류를, 없으면 대분류를 쓴다
          payload.transferFeeCategoryId =
            formData.transferFeeSubCategoryId || formData.transferFeeMainCategoryId;
        }
      } else {
        // 결제수단은 계좌와 카드 중 하나만 보낸다. 둘 다 보내면 서버가 거부한다.
        if (useCard) payload.cardId = formData.cardId;
        else payload.accountId = formData.accountId;
        // posting은 가장 구체적인 카테고리 하나만 가리킨다
        payload.categoryId = formData.subCategoryId || formData.mainCategoryId;
        // 할부는 신용카드 지출에만 붙는다. 2개월 미만이면 일시불이라 보내지 않는다.
        // canInstall이 카드 종류까지 본다. 체크카드로 바꾼 뒤 남은 값이 새지 않게 막는다.
        const months = Number(formData.installmentMonths);
        if (canInstall && months >= 2) payload.installmentMonths = months;
      }

      if (editingId) {
        await apiClient.updateEntry(editingId, payload);
      } else {
        await apiClient.createEntry({ ...payload, projectId: projectId });
      }

      await onEntryChange();
      setFormData(emptyEntryForm(timeZone, ledgerCurrency));
      setEditingId(null);
      setError('');
      setIsModalOpen(false);
    } catch (err) {
      setError(editingId ? '거래 수정에 실패했습니다.' : '거래 추가에 실패했습니다.');
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
    setEditingId(null);
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
    setIsModalOpen(false);
    setFormData(emptyEntryForm(timeZone, ledgerCurrency));
    setEditingId(null);
    setError('');
  };



  const handleDetailEditClick = () => {
    if (!selectedTransaction) return;
    setIsDetailModalOpen(false);
    handleEditClick(selectedTransaction);
  };

  /**
   * 수정할 수 있는 전표.
   *
   * 잔액 조정만 제외한다. 기초잔액 전표는 계좌 잔액에서 역산되는 값이라
   * 거래 폼으로 고칠 수 있는 대상이 아니다 (자산 화면의 잔액 수정이 담당한다).
   *
   * 카드대금 결제는 폼을 열 수 있다. 결제일이 오기 전에 잘못 눌러 넣은 결제를
   * 되돌리려면 금액이나 날짜를 고쳐야 하고, 그것이 사용 내역을 건드리지 않고
   * 바로잡는 가장 짧은 경로다. 카드와 통장은 바꿀 수 없다 (바꿀 일이면 삭제가 낫다).
   */
  const isEditable = (entry: EntryListItem) => entry.kind !== 'adjustment';

  /** 카드대금 결제 수정 중인지. 폼이 분류·유형·이체 칸을 감춘다. */
  const isCardPaymentForm = formData.type === 'card_payment';

  /**
   * 대분류/소분류로 나눈다.
   *
   * 서버는 가장 구체적인 카테고리 하나만 들고 있다(대분류만 지정했으면 그게 곧 leaf다).
   * 폼은 두 칸으로 나뉘어 있으므로 parentId를 보고 되돌린다.
   */
  const splitCategory = (categoryId: string | null) => {
    if (!categoryId) return { mainCategoryId: '', subCategoryId: '' };
    const category = categories.find((c) => c.id === categoryId);
    return category?.parentId
      ? { mainCategoryId: category.parentId, subCategoryId: category.id }
      : { mainCategoryId: categoryId, subCategoryId: '' };
  };

  const handleEditClick = (entry: EntryListItem) => {
    if (!isEditable(entry)) {
      setError('이 거래는 수정할 수 없습니다. 삭제 후 다시 등록해주세요.');
      return;
    }

    setEditingId(entry.id);
    const category = splitCategory(entry.categoryId);
    const fee = splitCategory(entry.feeCategoryId);

    /*
     * 청구액을 되돌려 놓을 수 있는 거래인지.
     *
     * 아직 잠정인 거래는 채우지 않는다. 그 금액은 사용자가 넣은 적 없는 서버
     * 추정값인데, 칸에 적혀 있으면 확정된 금액처럼 보이고 그대로 저장하는 순간
     * 확정으로 넘어간다. 확정한 사실이 없는데 확정 표시가 붙으면 안 된다.
     *
     * 나머지 조건은 폼의 needsBilled 와 같다.
     */
    const billedPrefill =
      !entry.rateProvisional &&
      isCurrencyCode(entry.originalCurrency) &&
      entry.originalCurrency !== ledgerCurrency &&
      currencyOfMethod(entry.accountId, entry.cardId) === ledgerCurrency &&
      displayCurrency === ledgerCurrency
        ? entry.amount
        : '';

    setFormData({
      // 카드대금 결제는 통장에서 돈이 나가고 카드 부채가 줄어든다. 두 값을 다 들고 있어야
      // 저장할 때 그대로 돌려보낼 수 있으므로 method로 하나만 고르지 않는다.
      method: entry.kind === 'card_payment' ? 'account' : entry.cardId ? 'card' : 'account',
      accountId: entry.accountId || '',
      cardId: entry.cardId || '',
      personId: entry.personId || '',
      type: entry.kind,
      mainCategoryId: category.mainCategoryId,
      subCategoryId: category.subCategoryId,
      /*
       * 금액과 통화.
       *
       * 서버는 목록 금액을 언제나 기준통화 환산액으로 준다. 외화 거래를 고칠 때
       * 환산액을 보여 주면 사용자가 입력했던 값과 달라 혼란스러우므로, 원 통화
       * 금액이 함께 왔으면 그것을 되돌려 놓는다.
       */
      amount: entry.originalAmount ?? entry.amount,
      currency: isCurrencyCode(entry.originalCurrency) ? entry.originalCurrency : ledgerCurrency,
      /*
       * 확정된 거래만 금액을 되돌려 놓는다 (billedPrefill 참고).
       *
       * 그대로 저장하면 금액이 한 푼도 움직이지 않는다. 잠정인 거래는 비워 두어,
       * 설명만 고쳐 저장해도 확정으로 넘어가지 않게 한다.
       */
      billedAmount: billedPrefill,
      // 결제수단 통화와 다른 통화로 기록된 거래다. 결제수단을 바꿔도 유지한다.
      currencyTouched:
        isCurrencyCode(entry.originalCurrency) &&
        entry.originalCurrency !== currencyOfMethod(entry.accountId, entry.cardId),
      description: entry.description || '',
      merchant: entry.merchant || '',
      detailedNote: entry.detailedNote || '',
      toAccountId: entry.toAccountId || '',
      // 받는 계좌 통화 그대로인 값을 쓴다. entry.amount는 기준통화 환산액이라
      // 통화가 다른 환전에서는 단위가 어긋난다.
      toAmount: entry.toAmount ?? '',
      // 수수료는 별도 다리라 예전에는 비워뒀다. 이제 목록 응답에 들어 있어 그대로 채운다.
      transferFee: toNumber(entry.feeAmount) > 0 ? entry.feeAmount ?? '' : '',
      transferFeeMainCategoryId: fee.mainCategoryId,
      transferFeeSubCategoryId: fee.subCategoryId,
      date: dateKeyOf(entry.date, timeZone),
      time: timeInputOf(entry.date, timeZone),
      extraAmount: toNumber(entry.extraAmount) > 0 ? entry.extraAmount : '',
      installmentMonths: entry.installmentMonths ? String(entry.installmentMonths) : '',
      // 놓치면 환불 입금을 고칠 때 대금 결제로 뒤집힌다
      cardTransferDirection: entry.cardTransferDirection ?? 'payment',
    });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteEntry(id);
      await onEntryChange();
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error?.message || '거래 삭제에 실패했습니다.';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePersonModalSuccess = (updatedPeople: Person[]) => {
    onReferenceDataChange({ people: updatedPeople });
    setStorePeople(updatedPeople);
    setIsPersonModalOpen(false);
  };


  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCardSubmitting(true);

      // 카드사는 필수다. CustomSelect는 <input required>와 달리 브라우저 검증이 없어
      // 비워 두면 서버에서 "기관을 찾을 수 없습니다"가 돌아와 원인을 알기 어렵다.
      if (!cardFormData.issuerId) {
        alert('발급사를 선택하세요.');
        setCardSubmitting(false);
        return;
      }

      // 만료일은 월까지만 받는다. 저장은 그 달 말일로 한다.
      const isoDate = monthInputToIso(cardFormData.expiryDate) ?? undefined;
      const isCredit = cardFormData.cardType === 'credit';
      await apiClient.createCard({
        // 결제 통장은 사용자가 만든 계좌여야 한다. 신용카드면 서버가 부채 계정을 함께 만든다.
        paymentAccountId: cardFormData.accountId,
        name: cardFormData.name,
        ...(cardFormData.cardNumber && { cardNumber: cardFormData.cardNumber }),
        cardType: cardFormData.cardType,
        issuerId: cardFormData.issuerId,
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit: isCredit ? toAmountString(cardFormData.creditLimit) : undefined,
        // 실적은 카드 종류를 가리지 않는다. 비워 두면 조건 없음이라 빈 문자열로 보낸다.
        performanceAmount: cardFormData.performanceAmount
          ? toAmountString(cardFormData.performanceAmount)
          : '',
        // 비워 두면 보내지 않는다. 서버는 null로 두고 화면이 종류별 기본색을 쓴다.
        color: cardFormData.color || undefined,
        // 신용카드는 마감일과 결제일이 필수다 (없으면 청구서를 만들 수 없다)
        statementClosingDay: isCredit ? cardFormData.statementClosingDay : undefined,
        paymentDueDay: isCredit ? cardFormData.paymentDueDay : undefined,
        projectId: projectId ?? undefined,
      });
      const data = await apiClient.getCards(projectId);
      onReferenceDataChange({ cards: data || [] });
      setCardFormData({
        accountId: '',
        name: '',
        cardNumber: '',
        cardType: 'debit',
        issuerId: '',
        expiryDate: '',
        creditLimit: '',
        performanceAmount: '',
        color: '',
        statementClosingDay: DEFAULT_STATEMENT_CLOSING_DAY,
        paymentDueDay: DEFAULT_PAYMENT_DUE_DAY,
      });
      setIsCardModalOpen(false);
    } catch (err) {
      console.error('카드 추가 실패:', err);
    } finally {
      setCardSubmitting(false);
    }
  };

  /** 카테고리 팝업을 닫고 폼을 비운다. 다음에 열 때 지난 입력이 남아 있으면 안 된다. */
  const closeCategoryModal = () => {
    setIsCategoryModalOpen(false);
    setCategoryParentId('');
    setCategoryFormData({ name: '', type: 'expense', subCategories: NO_SUB_CATEGORIES });
    setCategoryError('');
  };

  /** 카테고리 팝업 열기. parentId를 주면 그 대분류에 소분류만 붙이는 모드다. */
  const openCategoryModal = (parentId = '') => {
    setCategoryParentId(parentId);
    setCategoryFormData({
      name: '',
      type: 'expense',
      // 소분류를 붙이러 열었으면 첫 줄을 미리 준다. 그 줄이 이 팝업의 본론이다.
      subCategories: parentId ? [{ id: '', name: '', defaultIsExtra: false }] : NO_SUB_CATEGORIES,
    });
    setCategoryError('');
    setIsCategoryModalOpen(true);
  };

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const subs = filledSubCategories(categoryFormData.subCategories);
    // 소분류 모드에서는 이름이 하나라도 있어야 만들 것이 있다.
    if (categoryParent && subs.length === 0) {
      setCategoryError('소분류 이름을 입력해주세요.');
      return;
    }

    try {
      setCategorySubmitting(true);
      setCategoryError('');

      // 소분류 모드: 고른 대분류 밑에만 붙인다. 유형은 대분류를 따라간다.
      // 대분류 모드: 대분류를 먼저 만들고 그 id로 소분류를 붙인다.
      const parent = categoryParent
        ? categoryParent
        : await apiClient.createCategory({
            name: categoryFormData.name,
            type: categoryFormData.type,
          });

      const created: Category[] = [];
      for (const sub of subs) {
        created.push(
          await apiClient.createCategory({
            name: sub.name.trim(),
            type: parent.type,
            parentId: parent.id,
            defaultIsExtra: sub.defaultIsExtra,
          }),
        );
      }

      const data = await apiClient.getCategories();
      onReferenceDataChange({ categories: data || [] });

      /*
       * 방금 만든 소분류를 거래 폼에 바로 꽂아 준다.
       *
       * 소분류를 추가하러 팝업을 연 이유는 그 소분류로 거래를 적으려는 것이다.
       * 목록만 갱신하고 두면 사용자가 드롭다운을 다시 열어 같은 값을 또 골라야 한다.
       * 여러 개를 넣었으면 무엇을 고를지 알 수 없으므로 하나일 때만 고른다.
       */
      if (categoryParent && created.length === 1) {
        setFormData((prev) =>
          prev.mainCategoryId === categoryParent.id
            ? { ...prev, subCategoryId: created[0].id, extraAmount: '' }
            : prev,
        );
      }

      closeCategoryModal();
    } catch (err: any) {
      setCategoryError(err?.response?.data?.error?.message || '카테고리 추가에 실패했습니다.');
    } finally {
      setCategorySubmitting(false);
    }
  };

  useImperativeHandle(ref, () => ({
    openDetail: (entry: EntryListItem) => {
      setSelectedTransaction(entry);
      setIsDetailModalOpen(true);
    },
    openAdd: handleAddClick,
  }));

  return (
    <>
      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={
          isCardPaymentForm
            ? formData.cardTransferDirection === 'refund'
              ? '환불 입금 수정'
              : '카드 대금 결제 수정'
            : editingId
              ? '거래 수정'
              : '거래 추가'
        }
        /* 버튼은 form 밖(하단 고정 영역)이라 form 속성으로 묶는다 */
        footer={
          <button
            type="submit"
            form={ENTRY_FORM_ID}
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? (editingId ? '수정 중...' : '추가 중...') : (editingId ? '수정하기' : '추가하기')}
          </button>
        }
      >
        <form id={ENTRY_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
              {isCardPaymentForm && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
                  {formData.cardTransferDirection === 'refund'
                    ? '카드사에서 통장으로 돈이 들어온 기록입니다.'
                    : '통장에서 카드사로 대금이 나간 기록입니다.'}{' '}
                  지출로 집계되지 않습니다. 잘못 넣었다면 금액과 날짜를 고치거나 삭제하세요.
                  사용 내역은 건드릴 필요가 없습니다.
                </div>
              )}

              {/* 유형을 맨 위에서 탭으로 고른다. 아래 입력이 유형에 따라 달라지므로 먼저 정한다. */}
              {/* 카드대금 결제는 다른 유형으로 바꿀 수 없다. 부채 상환이라 대응하는 탭이 없다. */}
              {!isCardPaymentForm && (
              <div role="tablist" aria-label="거래 유형" className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {ENTRY_TYPE_TABS.map((tab) => {
                  // 카드는 지출만 만들 수 있고, 결제된 청구서에 속한 내역은 유형을 못 바꾼다.
                  const disabled = formData.method === 'card' && tab.id !== 'expense';
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
                        type: tab.id,
                        mainCategoryId: '',
                        subCategoryId: '',
                      })}
                      className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition ${
                        selected
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      } ${disabled ? 'opacity-40 cursor-not-allowed hover:text-gray-600' : ''}`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              )}

              {/* 금액은 유형 바로 아래에 둔다. 팝업이 열릴 때 여기로 포커스가 가므로
                  아래쪽에 있으면 본문이 스크롤돼 유형 탭이 가려진다. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">금액</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    required
                    /* 팝업이 열리면 여기부터 입력한다 (Modal이 이 표시를 찾아 포커스한다) */
                    data-autofocus
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    /*
                      과소비 금액은 다 치고 칸을 떠날 때 맞춘다.
                      한 글자마다 맞추면 3000을 2000으로 고치려고 "2"를 친 순간
                      과소비가 2원으로 깎이고, 남은 "000"을 쳐도 돌아오지 않는다.
                    */
                    onBlur={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        extraAmount: clampExtra(prev.extraAmount, e.target.value),
                      }))
                    }
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="50000"
                  />
                  {/*
                    통화. 결제수단을 고르면 그 계좌 통화로 맞춰지고, 원화 카드를 둔 채
                    달러로 바꾸면 "원화 카드로 한 외화 결제"가 된다.
                  */}
                  <select
                    value={formData.currency}
                    onChange={(e) => {
                      const currency = e.target.value as CurrencyCode;
                      setFormData({
                        ...formData,
                        currency,
                        billedAmount: '',
                        // 직접 고른 통화다. 결제수단을 바꿔도 유지한다.
                        currencyTouched: true,
                      });
                    }}
                    className="w-28 shrink-0 px-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {SUPPORTED_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>

                {needsRate && (
                  <div className="mt-2 space-y-2">
                    {/*
                      환율은 받지 않는다. 실제 금액만 받고 환율은 계산해서 보여 준다.

                      사용자가 아는 값은 "통장에서 얼마가 빠졌는가"이지 환율이 아니다.
                      기본 환율이 실제와 다르면 설정에서 바꾼다. 여기서 환율을 받으면
                      거래마다 서로 다른 값이 들어가 어떤 것이 맞는지 알 수 없게 된다.
                    */}
                    {needsBilled && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          실제 {isCreditCardSelected ? '청구액' : '결제액'} ({ledgerCurrency})
                          {mustBill && <span className="ml-1 text-red-500">*</span>}
                        </label>
                        <input
                          type="number"
                          step="any"
                          required={mustBill}
                          value={formData.billedAmount}
                          onChange={(e) =>
                            setFormData({ ...formData, billedAmount: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={isCreditCardSelected ? '명세서에 찍힌 금액' : '통장에서 빠진 금액'}
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          {isCreditCardSelected
                            ? '명세서가 나온 뒤에 넣어도 됩니다. 그때까지는 기본 환율로 추정합니다.'
                            : '통장에서 이미 빠진 금액입니다.'}
                        </p>
                      </div>
                    )}

                    {/* 적용되는 환율. 입력값이 아니라 결과다. */}
                    <div className="px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">
                          환율 (1 {formData.currency} = ? {ledgerCurrency})
                        </span>
                        <span className="font-medium text-gray-900">
                          {derivedRate || formatNumber(rateOf(formData.currency)) || '-'}
                          {!hasBilled && <span className="ml-1 text-gray-500">기본</span>}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {convertedPreview
                          ? `${convertedPreview} 로 기록됩니다.`
                          : '금액을 넣으면 기록될 값이 여기 나옵니다.'}
                        {!hasBilled && ' 기본 환율은 설정에서 바꿉니다.'}
                      </p>
                    </div>
                  </div>
                )}

                {paymentCurrency !== formData.currency && formData.currency !== ledgerCurrency && (
                  <p className="mt-1 text-xs text-gray-500">
                    결제수단은 {paymentCurrency}입니다. 청구되는 {ledgerCurrency} 금액이 기록되고
                    원래 금액은 참고용으로 함께 남습니다.
                  </p>
                )}
              </div>

              {/* 그다음 날짜와 시각을 받는다. 자주 고치는 값이라 위쪽에 둔다. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    날짜
                  </label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    시간
                  </label>
                  <input
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {isCardPaymentForm ? (
                /*
                 * 카드와 통장은 고정이다. 바꾸면 다른 카드의 부채를 갚는 전혀 다른 거래가
                 * 되므로, 잘못 골랐다면 지우고 자산 화면에서 다시 결제하는 것이 맞다.
                 */
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">카드</label>
                    <p className="px-3 py-2 bg-gray-100 rounded-lg text-gray-700">
                      {cards.find((c) => c.id === formData.cardId)?.name ?? '-'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {formData.cardTransferDirection === 'refund' ? '입금 통장' : '결제 통장'}
                    </label>
                    <p className="px-3 py-2 bg-gray-100 rounded-lg text-gray-700">
                      {accounts.find((a) => a.id === formData.accountId)?.name ?? '-'}
                    </p>
                  </div>
                </div>
              ) : formData.type === 'transfer' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    보내는 계좌
                  </label>
                  {/* 신용카드를 고르면 카드사에 대금을 갚는 것이 아니라 환불을 받는 쪽이 된다 */}
                  <CustomSelect
                    options={transferAccountOptions.filter(
                      (option) => option.id !== formData.toAccountId,
                    )}
                    value={formData.accountId}
                    onChange={(value) =>
                      setFormData({ ...formData, method: 'account', accountId: value, cardId: '' })
                    }
                    placeholder="선택하세요"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    결제수단
                  </label>
                  {/* 계좌와 카드를 한 목록에서 고른다. 접두사로 종류를 구분한다. */}
                  <CustomSelect
                    options={paymentMethodOptions}
                    value={selectedPaymentMethodId}
                    onChange={handlePaymentMethodChange}
                    placeholder="선택하세요"
                    onAddClick={() => setIsMethodChooserOpen(true)}
                    addButtonLabel="결제수단 추가"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  사용자
                </label>
                <CustomSelect
                  options={people.map((p) => ({ id: p.id, name: p.name }))}
                  value={formData.personId}
                  onChange={(value) => setFormData({ ...formData, personId: value })}
                  placeholder="선택하세요"
                  onAddClick={() => setIsPersonModalOpen(true)}
                  addButtonLabel="사용자 추가"
                />
              </div>

              {formData.type !== 'transfer' && !isCardPaymentForm && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      대분류
                    </label>
                    <CustomSelect
                      options={categories
                        .filter((c) => !c.parentId && c.type === formData.type)
                        .map((cat) => ({ id: cat.id, name: cat.name }))}
                      value={formData.mainCategoryId}
                      onChange={(value) => {
                        const selectedCategory = categories.find((c) => c.id === value);
                        setFormData({
                          ...formData,
                          mainCategoryId: value,
                          subCategoryId: '',
                          extraAmount: selectedCategory?.defaultIsExtra ? formData.amount : '',
                        });
                      }}
                      placeholder="선택하세요"
                      onAddClick={() => openCategoryModal()}
                      addButtonLabel="대분류 추가"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      소분류 (선택)
                    </label>
                    <CustomSelect
                      options={
                        formData.mainCategoryId
                          ? categories
                              .filter(
                                (c) =>
                                  Boolean(c.parentId) &&
                                  c.parentId === formData.mainCategoryId
                              )
                              .map((cat) => ({ id: cat.id, name: cat.name }))
                          : [{ id: '', name: '없음' }]
                      }
                      value={formData.subCategoryId}
                      onChange={(value) => {
                        // 소분류를 고르면 그 소분류의 기본값, "없음"으로 되돌리면 대분류의 기본값을 쓴다.
                        const target =
                          categories.find((c) => c.id === value) ??
                          categories.find((c) => c.id === formData.mainCategoryId);
                        setFormData({
                          ...formData,
                          subCategoryId: value,
                          extraAmount: target?.defaultIsExtra ? formData.amount : '',
                    });
                  }}
                  placeholder="없음"
                  /*
                    소분류는 대분류 아래에 붙는다. 대분류를 고르기 전에는 붙일 곳이
                    없으므로 버튼 자체를 내리고, 고른 뒤에는 그 대분류로 팝업을 연다.
                  */
                  onAddClick={
                    formData.mainCategoryId
                      ? () => openCategoryModal(formData.mainCategoryId)
                      : undefined
                  }
                  addButtonLabel="소분류 추가"
                />
                  </div>

                  {/*
                    체크하면 금액을 묻는 창이 뜬다. 체크 자체는 "전액"을 뜻하지 않는다.
                    이 분류를 다음에 고를 때 자동으로 켜지도록 서버가 분류에 기억한다.
                  */}
                  <ExtraCheck
                    kind={formData.type === 'income' ? 'income' : 'expense'}
                    amount={formData.amount}
                    value={formData.extraAmount}
                    onChange={(extraAmount) => setFormData({ ...formData, extraAmount })}
                  />

                </>
              )}

              {formData.type === 'transfer' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      이체 대상 계좌
                    </label>
                    <CustomSelect
                      options={transferAccountOptions.filter(
                        (option) => option.id !== formData.accountId,
                      )}
                      value={formData.toAccountId}
                      onChange={(value) => setFormData({ ...formData, toAccountId: value })}
                      placeholder="선택하세요"
                    />
                  </div>

                  {/*
                    통화가 다른 환전.

                    보낸 금액과 받은 금액을 그대로 적으면 실제 적용된 환율이
                    저절로 기록된다. 서버 환율로 추정하지 않으므로 은행 수수료가
                    섞인 실거래 환율이 그대로 남는다.
                  */}
                  {isCrossCurrencyTransfer && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        받은 금액 ({toCurrency})
                      </label>
                      <input
                        type="number"
                        value={formData.toAmount}
                        onChange={(e) => setFormData({ ...formData, toAmount: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="135000"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        {paymentCurrency} 계좌에서 {toCurrency} 계좌로 옮깁니다. 통장에 실제로
                        찍힌 금액을 적으면 그날의 실효 환율로 기록됩니다. 비우면 서버 환율로
                        계산합니다.
                      </p>
                    </div>
                  )}

                  {/*
                    한쪽이 신용카드면 카드사와의 자금 이동이다. 방향이 뜻을 바꾸므로
                    저장하기 전에 무엇으로 기록되는지 알려 준다.
                  */}
                  {transferCardSide && (
                    <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
                      {transferCardSide === 'payment'
                        ? '통장에서 카드사로 나가므로 대금 결제로 기록됩니다.'
                        : '카드사에서 통장으로 들어오므로 환불 입금으로 기록됩니다.'}{' '}
                      지출로 집계되지 않고 카드 부채만 움직입니다.
                    </div>
                  )}

                  {/* 카드사와의 이체에는 수수료를 붙일 수 없다 (서버도 거부한다) */}
                  <div className={transferCardSide ? 'hidden' : undefined}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      이체 수수료 (선택)
                    </label>
                    <input
                      type="number"
                      value={formData.transferFee}
                      onChange={(e) => setFormData({ ...formData, transferFee: e.target.value })}
                      // 이체의 과소비는 수수료에 붙는다. 금액 칸과 같은 규칙으로 맞춘다.
                      onBlur={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          extraAmount: clampExtra(prev.extraAmount, e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>

                  {formData.transferFee && parseInt(formData.transferFee) > 0 && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          수수료 대분류
                        </label>
                        <CustomSelect
                          options={categories
                            .filter((c) => !c.parentId && c.type === 'expense')
                            .map((cat) => ({ id: cat.id, name: cat.name }))}
                          value={formData.transferFeeMainCategoryId}
                          onChange={(value) => {
                            const selected = categories.find((c) => c.id === value);
                            setFormData({
                              ...formData,
                              transferFeeMainCategoryId: value,
                              transferFeeSubCategoryId: '',
                              extraAmount: selected?.defaultIsExtra ? formData.transferFee : '',
                            });
                          }}
                          placeholder="선택하세요"
                          onAddClick={() => openCategoryModal()}
                          addButtonLabel="대분류 추가"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          수수료 소분류 (선택)
                        </label>
                        <CustomSelect
                          options={
                            formData.transferFeeMainCategoryId
                              ? categories
                                  .filter(
                                    (c) =>
                                      Boolean(c.parentId) &&
                                      c.parentId === formData.transferFeeMainCategoryId
                                  )
                                  .map((cat) => ({ id: cat.id, name: cat.name }))
                              : [{ id: '', name: '없음' }]
                          }
                          value={formData.transferFeeSubCategoryId}
                          onChange={(value) => {
                            // 소분류를 고르면 그 기본값, "없음"이면 수수료 대분류의 기본값을 쓴다.
                            const target =
                              categories.find((c) => c.id === value) ??
                              categories.find((c) => c.id === formData.transferFeeMainCategoryId);
                            setFormData({
                              ...formData,
                              transferFeeSubCategoryId: value,
                              extraAmount: target?.defaultIsExtra ? formData.transferFee : '',
                            });
                          }}
                          placeholder="없음"
                        />
                      </div>

                      {/* 이체의 과소비는 수수료 분류에 붙는다 (이체 자체는 지출이 아니다). */}
                      <ExtraCheck
                        kind="expense"
                        amount={formData.transferFee}
                        value={formData.extraAmount}
                        onChange={(extraAmount) => setFormData({ ...formData, extraAmount })}
                      />
                    </>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  설명
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="거래 설명"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  거래처 (선택)
                </label>
                <input
                  type="text"
                  value={formData.merchant}
                  onChange={(e) => setFormData({ ...formData, merchant: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="가맹점, 송금 계좌주 등 (선택사항)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  상세설명 (선택)
                </label>
                <input
                  type="text"
                  value={formData.detailedNote}
                  onChange={(e) => setFormData({ ...formData, detailedNote: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="추가 설명 (선택사항)"
                />
              </div>

              {/*
                할부. 자주 쓰는 값이 아니라 폼 맨 아래에 둔다.

                신용카드 지출에만 뜬다. 체크카드는 결제 즉시 통장에서 빠지고 통장에는
                갚을 빚이 없어 나눌 청구가 없다 (서버도 같은 규칙으로 막는다).
                원금과 지출은 구매 시점에 전액 잡히고, 카드 화면의 주기별 사용액만 나뉜다.
              */}
              {canInstall && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    할부 (선택)
                  </label>
                  <CustomSelect
                    options={INSTALLMENT_OPTIONS}
                    value={formData.installmentMonths}
                    onChange={(value) => setFormData({ ...formData, installmentMonths: value })}
                    placeholder="일시불"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    지출과 카드 부채는 오늘 전액 잡힙니다. 청구만 나뉩니다.
                  </p>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
                  {error}
                </div>
              )}

        </form>
      </Modal>

      {/* 결제수단 드롭다운의 추가 버튼. 계좌와 카드를 한 목록에서 고르므로 종류를 여기서 묻는다. */}
      <ChoiceModal
        isOpen={isMethodChooserOpen}
        onClose={() => setIsMethodChooserOpen(false)}
        title="결제수단 추가"
        choices={[
          {
            key: 'account',
            icon: '🏦',
            label: '계좌 추가',
            description: '새로운 계좌를 추가합니다',
            tone: 'green',
            onSelect: () => {
              setIsMethodChooserOpen(false);
              setIsAccountModalOpen(true);
            },
          },
          {
            key: 'card',
            icon: '💳',
            label: '카드 추가',
            description: '새로운 카드를 추가합니다',
            tone: 'purple',
            onSelect: () => {
              setIsMethodChooserOpen(false);
              setIsCardModalOpen(true);
            },
          },
        ]}
      />

      <PersonModal
        isOpen={isPersonModalOpen}
        onClose={() => setIsPersonModalOpen(false)}
        person={null}
        mode="add"
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

      <Modal
        isOpen={isCardModalOpen}
        onClose={() => setIsCardModalOpen(false)}
        title="카드 추가"
        footer={
          <button
            type="submit"
            form={CARD_FORM_ID}
            disabled={cardSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {cardSubmitting ? '추가 중...' : '추가하기'}
          </button>
        }
      >
        <form id={CARD_FORM_ID} onSubmit={handleCardSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 이름
            </label>
            <input
              type="text"
              required
              value={cardFormData.name}
              onChange={(e) => setCardFormData({ ...cardFormData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 내 체크카드"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              계좌
            </label>
            <CustomSelect
              options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
              value={cardFormData.accountId}
              onChange={(value) => setCardFormData({ ...cardFormData, accountId: value })}
              placeholder="선택하세요"
              onAddClick={() => {}}
              addButtonLabel="계좌 추가"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 번호 (선택)
            </label>
            <input
              type="text"
              value={cardFormData.cardNumber}
              onChange={(e) => setCardFormData({ ...cardFormData, cardNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="16자리"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 유형
            </label>
            <CustomSelect
              options={[
                { id: 'debit', name: '체크카드' },
                { id: 'credit', name: '신용카드' },
              ]}
              value={cardFormData.cardType}
              onChange={(value) => setCardFormData({ ...cardFormData, cardType: value as 'debit' | 'credit' })}
              placeholder="선택하세요"
              onAddClick={() => {}}
              addButtonLabel=""
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              발급사
            </label>
            <CustomSelect
              options={issuerOptions}
              value={cardFormData.issuerId}
              onChange={(value) => setCardFormData({ ...cardFormData, issuerId: value })}
              placeholder="카드사를 선택하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              만료 월 (선택)
            </label>
            <input
              type="month"
              value={cardFormData.expiryDate}
              onChange={(e) => setCardFormData({ ...cardFormData, expiryDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">카드 색 (선택)</label>
            <CardColorPicker
              value={cardFormData.color}
              onChange={(color) => setCardFormData({ ...cardFormData, color })}
            />
          </div>

          <CardPerformanceField
            cardType={cardFormData.cardType}
            value={cardFormData.performanceAmount}
            onChange={(performanceAmount) =>
              setCardFormData({ ...cardFormData, performanceAmount })
            }
            statementClosingDay={cardFormData.statementClosingDay}
          />

          {cardFormData.cardType === 'credit' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  신용한도 (원)
                </label>
                <input
                  type="number"
                  value={cardFormData.creditLimit}
                  onChange={(e) => setCardFormData({ ...cardFormData, creditLimit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="5000000"
                />
              </div>

              {/* 마감일과 결제일로 청구 주기를 계산한다 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  마감일
                </label>
                <select
                  value={cardFormData.statementClosingDay}
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, statementClosingDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DAY_OF_MONTH_OPTIONS.map((option) => (
                    <option key={option.day} value={option.day}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{DAY_OF_MONTH_HINT}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  결제일
                </label>
                <select
                  value={cardFormData.paymentDueDay}
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, paymentDueDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DAY_OF_MONTH_OPTIONS.map((option) => (
                    <option key={option.day} value={option.day}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{DAY_OF_MONTH_HINT}</p>
              </div>
            </>
          )}

        </form>
      </Modal>

      {/* 대분류 추가와 "이 대분류에 소분류 추가"를 한 팝업으로 처리한다 */}
      <Modal
        isOpen={isCategoryModalOpen}
        onClose={closeCategoryModal}
        title={categoryParent ? `${categoryParent.name} 소분류 추가` : '카테고리 추가'}
        footer={
          <button
            type="submit"
            form={CATEGORY_FORM_ID}
            /* 소분류 모드에는 이름 칸이 없다. 그때는 소분류 줄이 채워졌는지 본다. */
            disabled={
              categorySubmitting ||
              (categoryParent
                ? filledSubCategories(categoryFormData.subCategories).length === 0
                : !categoryFormData.name.trim())
            }
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {categorySubmitting ? '추가 중...' : '추가하기'}
          </button>
        }
      >
        <form id={CATEGORY_FORM_ID} onSubmit={handleCategorySubmit} className="space-y-4">
          <CategoryFormFields
            name={categoryFormData.name}
            onNameChange={(name) => setCategoryFormData({ ...categoryFormData, name })}
            type={categoryFormData.type}
            onTypeChange={(type) => setCategoryFormData({ ...categoryFormData, type })}
            subCategories={categoryFormData.subCategories}
            onSubCategoriesChange={(subCategories) =>
              setCategoryFormData({ ...categoryFormData, subCategories })
            }
            parentName={categoryParent?.name}
          />

          {categoryError && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{categoryError}</div>
          )}

        </form>
      </Modal>

      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="거래 상세내역"
        footer={
          selectedTransaction ? (
            <div className="flex gap-2">
              {/*
                카드대금 결제와 잔액 조정은 이 폼으로 만들 수 없는 종류다.
                수정 폼에 담으면 지출로 바뀌어 버리므로 버튼 자체를 감춘다.
              */}
              {isEditable(selectedTransaction) ? (
                <button
                  onClick={handleDetailEditClick}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  수정하기
                </button>
              ) : (
                <div className="flex-1 px-4 py-2 text-sm text-gray-500 bg-gray-50 rounded-lg text-center">
                  잔액 조정은 수정할 수 없습니다
                </div>
              )}
              {/* 카드 거래도 계좌 거래와 똑같이 지운다. 청구서 잠금은 없다. */}
              <button
                onClick={async () => {
                  setIsDetailModalOpen(false);
                  await handleDeleteClick(selectedTransaction.id);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                disabled={isSubmitting}
              >
                삭제하기
              </button>
            </div>
          ) : null
        }
      >
        {selectedTransaction && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                수단
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.cardId ? '카드' : '계좌'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {selectedTransaction.cardId ? '카드' : '계좌'}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.cardId
                  ? cards.find(c => c.id === selectedTransaction.cardId)?.name || '-'
                  : accounts.find(a => a.id === selectedTransaction.accountId)?.name || '-'
                }
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                사용자
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.personName || '-'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                유형
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {ENTRY_KIND_LABEL[selectedTransaction.kind]}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                대분류
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.parentCategoryName || selectedTransaction.categoryName || '-'}
              </p>
            </div>

            {selectedTransaction.parentCategoryName && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  소분류
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.categoryName || '-'}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                금액
              </label>
              <p className={`px-3 py-2 bg-gray-50 rounded-lg text-lg font-bold ${
                selectedTransaction.kind === 'income' ? 'text-green-600' : 'text-red-600'
              }`}>
                {selectedTransaction.kind === 'income' ? '+' : '-'}
                {formatCurrency(selectedTransaction.amount, displayCurrency)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                설명
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.description || '-'}
              </p>
            </div>

            {selectedTransaction.merchant && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  거래처
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.merchant}
                </p>
              </div>
            )}

            {selectedTransaction.detailedNote && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  상세설명
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.detailedNote}
                </p>
              </div>
            )}

            {selectedTransaction.toAccountName && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이체 대상 계좌
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.toAccountName}
                </p>
              </div>
            )}

            {/* 이체 수수료. 수수료가 없어도 0으로 보여준다 */}
            {selectedTransaction.kind === 'transfer' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이체 수수료
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {formatCurrency(selectedTransaction.feeAmount ?? 0, displayCurrency)}
                  {selectedTransaction.feeCategoryName && (
                    <span className="ml-2 text-sm text-gray-500">
                      ({selectedTransaction.feeCategoryName})
                    </span>
                  )}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {selectedTransaction.kind === 'income' ? '추가 수입' : '과소비'}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900 tabular-nums">
                {toNumber(selectedTransaction.extraAmount) > 0
                  ? formatCurrency(selectedTransaction.extraAmount, displayCurrency)
                  : '없음'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                날짜
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {/* 시간을 입력하지 않은 거래는 날짜만 보여준다 */}
                {formatDateTime(selectedTransaction.date, timeZone)}
              </p>
            </div>

          </div>
        )}
      </Modal>
    </>
  );
});

export default EntryEditor;

/**
 * 과소비 금액을 거래 금액 안으로 되돌린다.
 *
 * 3만 원을 과소비로 적어 둔 뒤 거래 금액을 2만 원으로 고치는 일이 있다. 그대로
 * 두면 저장할 때 서버가 되돌려 보낸다. 넘치는 만큼만 줄여 새 금액에 맞춘다
 * (전액이 과소비였다면 바꾼 금액도 전액 과소비로 남는다).
 *
 * 입력 중이 아니라 다 친 뒤에만 부른다. 글자마다 부르면 고치는 도중의 짧은
 * 숫자에 맞춰 깎여 버린다.
 */
function clampExtra(extraAmount: string, nextAmount: string): string {
  const extra = toNumber(extraAmount);
  if (extra <= 0) return extraAmount;
  const max = toNumber(nextAmount);
  if (max <= 0) return '';
  return extra > max ? String(max) : extraAmount;
}

interface ExtraCheckProps {
  kind: 'expense' | 'income';
  /** 거래 금액. 과소비 금액의 처음 값이자 최대값이다. */
  amount: string;
  value: string;
  onChange: (extraAmount: string) => void;
}

/**
 * 과소비·추가 수입 체크와 금액.
 *
 * 체크하면 금액 창이 뜨고, 창을 확인해야 값이 담긴다. 취소하면 체크도 도로 풀린다.
 * 담긴 뒤에는 금액이 체크 옆에 보이고, 그 금액을 눌러 다시 고칠 수 있다.
 */
function ExtraCheck({ kind, amount, value, onChange }: ExtraCheckProps) {
  const [isOpen, setIsOpen] = useState(false);
  const label = kind === 'income' ? '추가 수입' : '과소비';
  const checked = toNumber(value) > 0;

  return (
    <div className="flex items-center gap-3">
      <input
        type="checkbox"
        id={`extra-${kind}`}
        checked={checked}
        onChange={(event) => {
          if (event.target.checked) setIsOpen(true);
          else onChange('');
        }}
        className="w-4 h-4 border border-gray-300 rounded-md focus:ring-blue-500"
      />
      <label htmlFor={`extra-${kind}`} className="text-sm font-medium text-gray-700">
        {label}
      </label>

      {checked && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="text-sm font-semibold text-blue-600 tabular-nums hover:underline"
        >
          {formatNumber(value)}원
        </button>
      )}

      <ExtraAmountModal
        isOpen={isOpen}
        kind={kind}
        maxAmount={amount}
        value={value}
        onCancel={() => setIsOpen(false)}
        onConfirm={(next) => {
          // 0을 적으면 일반 거래다. 체크도 함께 풀린다.
          onChange(toNumber(next) > 0 ? next : '');
          setIsOpen(false);
        }}
      />
    </div>
  );
}
