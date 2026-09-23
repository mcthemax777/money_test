'use client';

import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { useUserFilter } from '@money/core/store/user-filter';
import {
  useCanEdit,
  useMyPersonId,
  useProjectDisplayCurrency,
  useProjectLedgerCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';
import { useExchangeRates } from '@money/core/hooks/useExchangeRates';
import { useTagManager, type TagFormValues } from '@money/core/hooks/useTagManager';
import { useQuickAdd } from '@money/core/hooks/useQuickAdd';
import { useInstitutions } from '@money/core/hooks/useInstitutions';
import { apiClient } from '@money/core/lib/api-client';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import type { Account, Card, Category, Person } from '@money/core/lib/types';
import {
  defaultCountsPerformance,
  interestInAmount,
  showDiscountPerformance,
  withoutInterest,
} from '@money/core/data/entry-form';
import { entryAmountLook } from '@money/core/lib/entries';
import { formatCurrency, formatNumber, toAmountString, toNumber } from '@money/core/lib/money';
import {
  dayOfMonthHint,
  dayOfMonthOptions,
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@money/core/lib/day-of-month';
import {
  dateKeyOf,
  formatDateTime,
  monthInputToIso,
  nowTimeKey,
  timeInputOf,
  todayKey,
} from '@money/core/lib/datetime';
import {
  CURRENCY_LABEL,
  Dec,
  LEDGER_MIN_ENTRY_DATE_KEY,
  SUPPORTED_CURRENCIES,
  isCurrencyCode,
  ledgerMaxEntryDateKey,
  newLineKey,
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
import { AddTagModal } from '@/components/TagFields';
import type { EntryListItem } from '@/components/TransactionItem';
import type { EntryDraftDto } from '@money/types';
import CardColorPicker from '@/components/CardColorPicker';
import CardPerformanceField from '@/components/CardPerformanceField';
import { useApiError } from '@money/core/lib/api-error';
import {
  installmentInterestInputs,
  installmentShareInputs,
  installmentShareTotal,
  type InstallmentInterestMode,
} from '@money/core/lib/period-ledger';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const ENTRY_FORM_ID = 'entry-form';
const CARD_FORM_ID = 'card-form';
const CATEGORY_FORM_ID = 'category-form';

/** 카드사가 흔히 제공하는 할부 개월수. 빈 값이 일시불이다. */
const INSTALLMENT_MONTHS = [2, 3, 4, 5, 6, 9, 10, 12, 18, 24, 36];

/**
 * 할부 개월 목록.
 *
 * 상수가 아니라 함수다. 모듈을 처음 읽을 때의 언어로 굳으면 언어를 바꿔도
 * "일시불"만 옛 말로 남는다.
 */
function installmentOptions(t: ReturnType<typeof useTranslation>['t']) {
  return [
    { id: '', name: t('editor.installmentOnce') },
    ...INSTALLMENT_MONTHS.map((months) => ({
      id: String(months),
      name: t('editor.installmentMonths', { months }),
    })),
  ];
}

/**
 * 분류를 나눈 한 줄.
 *
 * 폼은 대분류·소분류를 나눠 들고(웹의 분류 칸이 두 개다), 저장 직전에 가장 구체적인
 * 것 하나로 합쳐 보낸다. 서버는 줄마다 카테고리 하나와 금액만 받는다.
 */
interface EntryFormSplitRow {
  mainCategoryId: string;
  subCategoryId: string;
  /** 정가. 차감을 빼기 전의 값이다. */
  amount: string;
  /**
   * 이 줄의 신원. 줄을 더하는 순간 붙고, 편집 내내 바뀌지 않는다.
   *
   * 저장할 때마다 서버가 다리를 지우고 새로 만들기 때문에 다리 id 로는 줄을 가리킬 수
   * 없다. 줄에 붙는 것(태그·차감)이 이 키에 매달리고, 서버는 키 없는 요청을 거절한다.
   */
  lineKey: string;
  /** 이 줄에서 깎인 금액. 정가보다 클 수 없다. 같으면 그 줄이 0원으로 남는다. */
  discountAmount: string;
  /** 이 줄에 붙일 태그. 나눈 두 줄이 서로 다른 태그를 가질 수 있다. */
  tagIds: string[];
}

/** 나눈 거래인가. 줄이 둘 이상인 지출·수입이다. */
function isSplitEntry(entry: EntryListItem): boolean {
  return (entry.kind === 'expense' || entry.kind === 'income') && entry.splitCount > 1;
}

/** 이 거래의 폼 갈래. 카드 대금 결제는 이체 폼으로 편다. */
function kindOf(entry: EntryListItem): 'expense' | 'income' | 'transfer' {
  if (entry.kind === 'income') return 'income';
  if (entry.kind === 'expense') return 'expense';
  return 'transfer';
}

/** 빈 분할 줄. 줄 키는 여기서 붙는다. */
function blankSplitRow(): EntryFormSplitRow {
  return {
    mainCategoryId: '',
    subCategoryId: '',
    amount: '',
    lineKey: newLineKey(),
    discountAmount: '',
    tagIds: [],
  };
}

/**
 * 분할 줄의 금액. 비었거나 0 이하면 null 이다.
 *
 * 화면 값은 문자열이라 숫자로 바꿔 더하면 원 단위가 어긋난다. Dec 로 받아 두면 줄들의
 * 합이 전체 금액과 같은지 정확히 견줄 수 있다.
 */
function splitAmountOf(value: string): Dec | null {
  const amount = Dec.of(toAmountString(value));
  return amount.isPositive() ? amount : null;
}

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
    /** 할부 개월수. 빈 값이거나 1이면 일시불 */
    installmentMonths: '',
    /** 할부에 수수료가 붙는가. '' 는 아직 고르지 않았다는 뜻이다 (기본값을 두지 않는다). */
    installmentInterest: '' as '' | 'free' | 'interest',
    /** 회차별 원금. 비어 있으면 개월수로 나눈 기본값을 쓴다. */
    installmentShares: [] as string[],
    /**
     * 유이자 할부의 이자를 어떻게 정하는가. '' 는 아직 고르지 않았다는 뜻이다.
     *
     * 고정형은 매달 같은 금액을 내고, 변동형은 연이율만 정해져 있다. 고르지 않으면
     * 이자 칸이 비어 있고 명세서를 보고 회차마다 적는다.
     */
    installmentInterestMode: '' as InstallmentInterestMode,
    /** 고정형의 월 납입액. */
    installmentMonthlyPayment: '',
    /** 변동형의 연이율 (퍼센트). */
    installmentAnnualRate: '',
    /** 회차별 이자. 비어 있으면 고른 방식으로 계산한 기본값을 쓴다. */
    installmentInterestShares: [] as string[],
    /**
     * 결제 자리에서 깎인 금액. 포인트 사용, 자동할인, 그리고 **취소**가 모두 이 칸이다.
     *
     * 셋은 전표에서 같은 모양이다 -- 정가(`amount`)는 그대로인데 계좌에서 빠지는 돈만
     * 적다. 전액을 적으면 0원 거래로 남는다. 통화는 `amount` 와 같다.
     */
    discountAmount: '',
    /**
     * 이 거래를 카드 실적에 셀지. 카드를 골랐을 때만 화면에 뜬다.
     *
     * 기본값이 갈래마다 다르다 -- 지출은 켜짐, 카드로 들어온 수입은 꺼짐이다.
     * 꺼도 갚을 대금은 그대로다. 실적과 청구액은 다른 값이다.
     */
    countsPerformance: true,
    /**
     * 차감·취소 금액을 카드 실적에서도 뺄지. 차감을 적은 카드 지출에만 화면에 뜬다.
     *
     * **기본은 뺀다.** 다리에 이미 깎인 금액이 들어가 있어 그것이 지금까지의 동작이다.
     * 끄면 실적만 정가로 세고, 갚을 대금은 어느 쪽이든 깎인 금액 그대로다.
     */
    discountCountsPerformance: true,
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
    /**
     * 이 거래에 붙일 태그. 카테고리와 달리 여럿을 고를 수 있다.
     *
     * 갈래(지출·수입·이체)를 가리지 않는다. 태그는 "무엇에 쓴 돈인가"가 아니라 "어느
     * 일에 딸린 거래인가"라, 여행에는 항공권 지출과 환불 수입이 함께 든다.
     */
    tagIds: [] as string[],
    /**
     * 분류를 나눈 줄들. 비어 있으면 분류 하나짜리 거래다.
     *
     * 줄이 있는 동안에는 위의 대분류·소분류를 쓰지 않는다. 저장도 줄들만 보낸다.
     */
    splits: [] as EntryFormSplitRow[],
    /**
     * 분류 하나짜리 거래의 줄 키. 나눈 거래는 줄마다 따로 든다.
     *
     * 폼을 열 때 정해지고 저장할 때까지 바뀌지 않는다. 이 값이 이어져야 그 줄에 붙은
     * 태그와 차감이 수정을 건너 살아남는다.
     */
    lineKey: newLineKey(),
  };
}

/** 거래 추가/수정 팝업 맨 위의 유형 탭 */
const ENTRY_TYPE_TABS = [
  { id: 'expense', labelKey: 'editor.kind.expense' },
  { id: 'income', labelKey: 'editor.kind.income' },
  { id: 'transfer', labelKey: 'editor.kind.transfer' },
] as const;

const ENTRY_KIND_KEY: Record<string, MessageKey> = {
  expense: 'editor.kind.expense',
  income: 'editor.kind.income',
  transfer: 'editor.kind.transfer',
  card_payment: 'editor.kind.card_payment',
  adjustment: 'editor.kind.adjustment',
};

/**
 * 내용을 베껴 새로 적을 수 있는 거래.
 *
 * 두 가지를 뺀다. 잔액 맞추기가 만든 조정은 이 폼이 만드는 것이 아니고(계좌 잔액에서
 * 역산된다), 분할은 이 폼이 분류 하나만 다뤄 줄들이 합쳐진 한 건이 **새로** 남는다 --
 * 고치기는 원본이 그 자리에 있어 알아챌 수 있지만 새 거래는 그렇지 않다.
 *
 * 상세를 이 컴포넌트 밖에서 그리는 화면(거래)도 이것으로 단추를 그린다. 규칙을 그쪽에
 * 또 적으면 여기가 막는 거래에 단추가 남는다.
 */
export function isCopyableEntry(entry: EntryListItem): boolean {
  return entry.kind !== 'adjustment' && entry.splitCount <= 1;
}

/**
 * 이 폼으로 고칠 수 있는 거래.
 *
 * 잔액 조정만 뺀다. 기초잔액 전표는 계좌 잔액에서 역산되는 값이라 거래 폼으로 고칠
 * 대상이 아니다 (자산 화면의 잔액 수정이 담당한다).
 *
 * 카드대금 결제는 연다. 결제일이 오기 전에 잘못 눌러 넣은 결제를 되돌리려면 금액이나
 * 날짜를 고쳐야 하고, 그것이 사용 내역을 건드리지 않고 바로잡는 가장 짧은 길이다.
 * 카드와 통장은 폼이 잠근다 (바꿀 일이면 삭제가 낫다).
 *
 * 분할 거래도 연다. 베끼기와 달리 원본이 그 자리에 있어 줄이 합쳐진 것을 알아챌 수 있다.
 *
 * 상세를 이 컴포넌트 밖에서 그리는 화면(거래)도 이것으로 단추를 그린다. 규칙을 그쪽에
 * 또 적으면 여기가 막는 거래에 단추가 남는다.
 */
export function isEditableEntry(entry: EntryListItem): boolean {
  return entry.kind !== 'adjustment';
}

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
  /** 거래를 저장하거나 지운 뒤. 화면이 목록·합계를 다시 불러온다. */
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
  // 목록 금액은 표시 통화 환산액이다. 저장 통화와 같을 때만 그 값을 폼에 되돌릴 수 있다.
  const displayCurrency = useProjectDisplayCurrency();
  const { rateOf } = useExchangeRates();
  /** 설정에서 지정한 "구성원 중 나". 새 거래의 사용자 기본값이 된다. */
  const myPersonId = useMyPersonId();
  const { options: issuerOptions } = useInstitutions('card_issuer');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
  /** 태그를 그 자리에서 만드는 창. 다른 것과 달리 목록이 이 팝업 안에 있다. */
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
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
  const OTHER_OWNER_GROUP = t('editor.otherOwner');

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
      t('editor.cardOption', {
        name: `${card.name}${card.issuer?.name ? ` · ${card.issuer.name}` : ''}`,
      });

    const options: Array<{ id: string; name: string; group: string }> = [];
    const listed = new Set<string>();

    const pushOwner = (group: string, owned: typeof accounts) => {
      for (const account of owned) {
        options.push({
          id: `account:${account.id}`,
          name: t('editor.accountOption', { name: account.name }),
          group,
        });
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
          options.push({
          id: card.liabilityAccountId!,
          name: t('editor.cardOption', { name: card.name }),
          group,
        });
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
        name: t('editor.cardOption', { name: card.name }),
        group: OTHER_OWNER_GROUP,
      });
    }

    return options;
  }, [accounts, cards, people]);

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

  /** 이체 양쪽 중 카드 부채 계정인 쪽. 없거나 둘 다 카드면 null 이다. */
  const transferCardSide = (() => {
    if (formData.type !== 'transfer') return null;
    const fromIsCard = cardLiabilityIds.has(formData.accountId);
    const toIsCard = cardLiabilityIds.has(formData.toAccountId);
    if (fromIsCard && !toIsCard) return 'refund' as const;
    if (toIsCard && !fromIsCard) return 'payment' as const;
    return null;
  })();

  /*
   * 양쪽이 다 카드인 이동. 저장할 수 없다.
   *
   * 목록은 그 전표를 카드대금으로 읽고 "어느 카드의 대금인가"를 하나로 정해야 해서
   * 어느 쪽을 골라도 반쪽만 보인다. 조립도 같은 이유로 막는다.
   */
  const transferBothCards =
    formData.type === 'transfer' &&
    cardLiabilityIds.has(formData.accountId) &&
    cardLiabilityIds.has(formData.toAccountId);

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

  /*
   * 회차 금액 칸에 보일 값. 적어 둔 것이 없으면 개월수로 나눈 기본값이다.
   *
   * 빈 칸으로 두지 않는 까닭은 고칠 자리가 한두 회차뿐이기 때문이다 -- 기본값을 보여
   * 주고 다른 회차만 고치게 한다.
   */
  const shareInputs = installmentShareInputs(
    formData.amount,
    Number(formData.installmentMonths),
    formData.installmentShares,
  );

  /*
   * 회차 이자 칸에 보일 값. 고른 방식으로 계산한 기본값이고, 고치면 그 값이 남는다.
   *
   * 방식을 고르지 않았으면 빈 칸이다 -- 0 으로 채우면 "이자 없음"과 구별되지 않는다.
   */
  const interestInputs = installmentInterestInputs({
    total: formData.amount,
    months: Number(formData.installmentMonths),
    principals: shareInputs,
    mode: formData.installmentInterestMode,
    monthlyPayment: formData.installmentMonthlyPayment,
    annualRate: formData.installmentAnnualRate,
    saved: formData.installmentInterestShares,
  });

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
        ...(only
          ? {
              mainCategoryId: only.mainCategoryId,
              subCategoryId: only.subCategoryId,
              amount: only.amount,
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

    if (!formData.personId) {
      setError(t('editor.personRequired'));
      return;
    }

    if (transferBothCards) {
      setError(t('entryForm.bothCards'));
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
      setError(t('editor.feeCategoryRequired'));
      return;
    }

    /*
     * 할부를 골랐으면 수수료가 붙는지도 골라야 한다.
     *
     * 기본값으로 대신하지 않는다. 무이자로 두면 유이자 할부가 조용히 수수료 없이
     * 지나가고, 유이자로 두면 무이자 결제마다 "수수료 미입력"이 쌓인다. 앱도 같은
     * 규칙으로 막는다 (core 의 checkEntryForm).
     */
    if (canInstall && Number(formData.installmentMonths) >= 2 && !formData.installmentInterest) {
      setError(t('entryForm.installmentInterestRequired'));
      return;
    }

    /*
     * 적어 둔 회차 금액은 개수와 합이 맞아야 한다.
     *
     * 외화 결제는 여기서 보지 않는다. 카드에 청구되는 금액이 환산 뒤에야 정해져 폼의
     * 값만으로는 견줄 수 없다 -- 그때는 서버가 카드 다리를 보고 막는다. **장부 통화와
     * 견주는 것이 요점이다.** 이 폼의 통화 칸은 비는 법이 없어(원화 결제에도 'KRW' 가
     * 들어 있다) 빈 값으로 판단하면 이 검사가 영영 돌지 않는다.
     */
    if (
      canInstall &&
      formData.installmentShares.some((share) => share.trim() !== '') &&
      formData.currency === ledgerCurrency
    ) {
      if (formData.installmentShares.length !== Number(formData.installmentMonths)) {
        setError(t('entryForm.installmentSharesCount'));
        return;
      }
      const shareSum = formData.installmentShares.reduce(
        (acc, share) => acc + toNumber(share),
        0,
      );
      if (shareSum !== toNumber(formData.amount)) {
        setError(t('entryForm.installmentSharesSum'));
        return;
      }
    }

    /*
     * 이자 쪽. 유이자 할부에만 본다.
     *
     * 고정형은 낸 돈의 합이 산 값에 못 미치면 표가 풀리지 않는다. 그때 이자 칸이 왜
     * 비어 있는지를 저장할 때가 아니라 적는 자리에서 알려 준다.
     */
    if (canInstall && formData.installmentInterest === 'interest') {
      const months = Number(formData.installmentMonths);

      /*
       * 외화가 얽힌 결제에는 유이자 할부를 적을 수 없다.
       *
       * 이자는 명세서 금액 그대로 적는 값이라 환산할 환율이 없다. 조립도 막지만
       * (`assertInterestCurrency`), 고른 자리에서 알려 주는 편이 낫다.
       *
       * **장부 통화와 견준다.** 이 폼의 통화 칸은 비어 있는 법이 없고 원화 결제에도
       * 'KRW' 가 들어 있다 -- 빈 값으로 판단하면 모든 유이자 할부가 막힌다
       * (core 의 `checkEntryForm` 은 외화일 때만 값이 차는 폼을 본다).
       */
      if (formData.currency !== ledgerCurrency) {
        setError(t('entryForm.installmentInterestCurrency'));
        return;
      }

      if (formData.installmentInterestMode === 'fixed' && formData.installmentMonthlyPayment.trim()) {
        const payment = toNumber(formData.installmentMonthlyPayment);
        if (!(payment > 0)) {
          setError(t('entryForm.installmentPaymentInvalid'));
          return;
        }
        // 외화 결제는 청구액이 환산 뒤에 정해져 폼의 금액과 견줄 수 없다 (위와 같은 판단).
        if (formData.currency === ledgerCurrency && payment * months < toNumber(formData.amount)) {
          setError(t('entryForm.installmentPaymentTooSmall'));
          return;
        }
      }

      if (
        formData.installmentInterestMode === 'rate' &&
        formData.installmentAnnualRate.trim() &&
        toNumber(formData.installmentAnnualRate) < 0
      ) {
        setError(t('entryForm.installmentRateInvalid'));
        return;
      }

      if (formData.installmentInterestShares.some((share) => share.trim() !== '')) {
        if (formData.installmentInterestShares.length !== months) {
          setError(t('entryForm.installmentInterestSharesCount'));
          return;
        }
        if (formData.installmentInterestShares.some((share) => toNumber(share) < 0)) {
          setError(t('entryForm.installmentInterestNegative'));
          return;
        }
      }
    }

    /*
     * 차감·취소. **정가보다 클 수 없다.**
     *
     * 같아도 된다 -- 그때 그 줄은 0원으로 남고, 전액 환불이 그 모양이다. 넘으면
     * 지출이 아니라 입금이 되어 서버가 거절하므로 여기서 먼저 막는다.
     */
    if (formData.type === 'expense') {
      const lines = hasSplits
        ? formData.splits.map((split) => ({
            discount: toNumber(split.discountAmount),
            amount: toNumber(split.amount),
          }))
        : [{ discount: toNumber(formData.discountAmount), amount: toNumber(formData.amount) }];
      if (lines.some((line) => line.discount > line.amount)) {
        setError(t('entryForm.discountTooLarge'));
        return;
      }
    }

    /*
     * 나눈 줄은 줄마다 분류와 금액이 있어야 하고, 합이 전체 금액과 같아야 한다.
     *
     * 서버는 줄들의 합을 그대로 그 거래의 금액으로 삼는다(entry-build 의
     * resolveRequestLines). 어긋난 채 보내면 위 칸에 적은 금액과 다른 거래가 조용히
     * 저장되므로, 남는 것을 마지막 줄에 몰아주지도 않고 여기서 막는다.
     */
    if (hasSplits) {
      let total = Dec.of(0);
      for (const split of formData.splits) {
        if (!split.mainCategoryId) {
          setError(t('editor.splitCategoryRequired'));
          return;
        }

        const line = splitAmountOf(split.amount);
        if (!line) {
          setError(t('editor.splitAmountInvalid'));
          return;
        }

        total = total.plus(line);
      }

      if (!total.eq(Dec.of(toAmountString(formData.amount)))) {
        setError(t('editor.splitSumMismatch'));
        return;
      }
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

      /*
       * 화면의 개념을 그대로 보낸다. 서버가 전표(postings)로 번역한다.
       *
       * 카드대금 결제라는 갈래는 보내지 않는다. 이체에서 카드 부채 계정을 고르면
       * 서버가 같은 전표를 만들고, 목록이 그것을 `card_payment` 로 되읽는다.
       */
      const kind =
        formData.type === 'income'
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

      /*
       * 태그는 언제나 싣는다. 비었어도 뺄 수 없다.
       *
       * 수정은 전표를 통째로 갈아 끼우고 생략은 "비운다"로 읽히므로, 여기서 빈 배열을
       * 빼면 "태그를 전부 뗀 수정"과 "태그를 건드리지 않은 수정"이 같아진다.
       */
      payload.tagIds = formData.tagIds;

      if (formData.merchant) payload.merchant = formData.merchant;
      if (formData.detailedNote) payload.detailedNote = formData.detailedNote;

      if (kind === 'transfer') {
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
          // 수수료도 분류 줄이라 키를 갖는다. 폼의 줄 키를 그대로 쓴다.
          payload.transferFeeLineKey = formData.lineKey;
        }
      } else {
        // 결제수단은 계좌와 카드 중 하나만 보낸다. 둘 다 보내면 서버가 거부한다.
        if (useCard) payload.cardId = formData.cardId;
        else payload.accountId = formData.accountId;
        // posting은 가장 구체적인 카테고리 하나만 가리킨다
        /** 그 줄에서 깎인 금액. 지출에만 싣는다. */
        const lineDiscount = (discountAmount: string) =>
          kind === 'expense' && toNumber(discountAmount) > 0
            ? { discountAmount: toAmountString(discountAmount) }
            : {};

        if (hasSplits) {
          // 나눈 줄이 있으면 대표 분류는 보내지 않는다. 줄마다 따로 있기 때문이다.
          payload.splits = formData.splits.map((split) => ({
            categoryId: split.subCategoryId || split.mainCategoryId,
            amount: toAmountString(split.amount),
            lineKey: split.lineKey,
            // 태그도 줄마다 싣는다. 비었어도 뺄 수 없다 -- 생략은 "비운다"로 읽힌다.
            tagIds: split.tagIds,
            ...lineDiscount(split.discountAmount),
          }));
          // 나눈 거래는 줄마다 태그가 다르다. 거래 단위 목록은 싣지 않는다.
          delete payload.tagIds;
        } else {
          payload.categoryId = formData.subCategoryId || formData.mainCategoryId;
          // 그 줄의 키. 이 값이 이어져야 줄에 붙은 태그와 차감이 살아남는다.
          payload.lineKey = formData.lineKey;
          Object.assign(payload, lineDiscount(formData.discountAmount));
        }

        /*
         * 카드 실적 두 칸. **분할이든 아니든 거래에 하나씩이다.**
         *
         * 카드로 냈고 기본값과 다를 때만 싣는다. 기본값은 서버가 갈래를 보고 정하므로
         * 같은 값을 굳이 보내지 않는다 -- 짐만 보고도 사용자가 손댄 자리가 드러난다.
         */
        if (useCard && formData.countsPerformance !== defaultCountsPerformance(kind)) {
          payload.countsPerformance = formData.countsPerformance;
        }
        /*
         * 차감을 실적에서 빼지 않기로 한 것. 그 칸이 화면에 떠 있었을 때만 싣는다.
         *
         * 보여 주지 않은 값을 실어 보내면, 껐다가 차감을 지운 거래가 사용자가 볼 수
         * 없는 값을 들고 다닌다 (앱과 같은 규칙: `showDiscountPerformance`).
         */
        if (
          showDiscountPerformance({
            kind,
            discountAmount: totalDiscount,
            countsPerformance: formData.countsPerformance,
            isCard: useCard,
            isLedgerCurrency: formData.currency === ledgerCurrency,
          }) &&
          !formData.discountCountsPerformance
        ) {
          payload.discountCountsPerformance = false;
        }

        // 할부는 신용카드 지출에만 붙는다. 2개월 미만이면 일시불이라 보내지 않는다.
        // canInstall이 카드 종류까지 본다. 체크카드로 바꾼 뒤 남은 값이 새지 않게 막는다.
        const months = Number(formData.installmentMonths);
        if (canInstall && months >= 2) {
          payload.installmentMonths = months;
          // 수수료가 붙는지는 사용자가 고른다. 고르지 않으면 아래 검사에서 막힌다.
          payload.installmentInterest = formData.installmentInterest === 'interest';
          /*
           * 회차 금액은 손댔을 때만 보낸다.
           *
           * 비워 두면 서버가 개월수로 나눈다. 그래야 나중에 금액을 고쳤을 때 회차도
           * 함께 다시 나뉜다 -- 한 번 채워 보내 두면 옛 금액의 회차가 남는다.
           */
          if (formData.installmentShares.some((share) => share.trim() !== '')) {
            // 비운 칸은 0 이다. 개수를 줄여 보내면 서버가 "개수가 다르다"로 거절한다.
            payload.installmentShares = formData.installmentShares.map((share) =>
              toAmountString(share),
            );
          }

          /*
           * 이자 쪽은 유이자 할부에만 싣는다.
           *
           * 무이자면 아무것도 싣지 않아 서버가 계획의 이자 칸을 비운다 -- 유이자로
           * 적었다가 되돌린 할부에 옛 이자가 남지 않는다.
           */
          if (formData.installmentInterest === 'interest') {
            /*
             * **화면에 보이는 값을 그대로 싣는다.** 계산으로 채워 준 기본값도 손대지
             * 않았다고 버리지 않는다 -- 이자는 전표 금액 안에 들어가는 값이라, 보이는
             * 대로 저장하지 않으면 고쳐 저장하는 순간 갚을 돈이 원금만 남는다.
             * 서버는 이자를 계산하지 않으므로 여기서 싣지 않으면 되살릴 자리가 없다.
             * (앱도 같은 규칙이다: core 의 `installmentInterestPayload`)
             */
            if (interestInputs.some((share) => share.trim() !== '')) {
              payload.installmentInterestShares = interestInputs.map((share) =>
                toAmountString(share),
              );
            }
            if (formData.installmentInterestMode === 'fixed' && formData.installmentMonthlyPayment.trim()) {
              payload.installmentMonthlyPayment = toAmountString(formData.installmentMonthlyPayment);
            }
            if (formData.installmentInterestMode === 'rate' && formData.installmentAnnualRate.trim()) {
              payload.installmentAnnualRate = formData.installmentAnnualRate.trim();
            }
          }
        }

      }

      let savedId: string | null = editingId;

      if (editingId) {
        // 팝업을 열 때 본 판을 함께 보낸다. 그 사이의 편집을 서버가 알아채는 근거다.
        await apiClient.updateEntry(editingId, { ...payload, baseHlc });
      } else {
        const created = await apiClient.createEntry({ ...payload, projectId: projectId });
        savedId = created.id;
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

  /** 규칙은 모듈 자리의 `isEditableEntry` 가 갖는다. 거래 화면의 상세도 그것으로 그린다. */
  const isEditable = isEditableEntry;

  /** 카드대금 결제 수정 중인지. 폼이 분류·유형·이체 칸을 감춘다. */

  /**
   * 분류를 나눠 적는 중인지.
   *
   * 이체와 카드대금 결제에는 분류 칸 자체가 없으므로 줄이 남아 있어도 쓰지 않는다
   * (유형을 바꿀 때 비우지만, 어느 쪽으로 들어와도 같게 읽히도록 갈래까지 본다).
   */
  const hasSplits =
    formData.type !== 'transfer' && formData.splits.length > 0;

  /**
   * 이 거래에서 깎인 금액의 합.
   *
   * 분할이면 줄마다 적은 값을 더한 것이 그 거래의 차감이다. "차감을 실적에서 뺄지"는
   * 거래에 하나뿐이라 그 판단에 이 합을 쓴다.
   */
  const totalDiscount = String(
    hasSplits
      ? formData.splits.reduce((sum, split) => sum + toNumber(split.discountAmount), 0)
      : toNumber(formData.discountAmount),
  );

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
    mainCategoryId
      ? categories
          .filter((c) => Boolean(c.parentId) && c.parentId === mainCategoryId)
          .map((cat) => ({ id: cat.id, name: cat.name }))
      : [{ id: '', name: t('editor.none') }];

  /** 아직 줄에 담기지 않은 금액. 저장을 눌러 보기 전에 보여 준다. */
  const splitLeft = useMemo(() => {
    const total = formData.splits.reduce(
      (sum, split) => sum.plus(splitAmountOf(split.amount) ?? Dec.of(0)),
      Dec.of(0),
    );
    return Dec.of(toAmountString(formData.amount)).minus(total).toString();
  }, [formData.amount, formData.splits]);

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

  /**
   * 목록 한 줄의 금액을 폼이 드는 정가로 되돌린다.
   *
   * 목록의 금액은 차감을 뺀 뒤의 값이고(실제로 나간 돈), 되돌린 결제는 음수다. 폼의
   * 금액 칸은 언제나 "깎이기 전의 값을 양수로" 이므로 둘을 여기서 되돌린다.
   */
  const grossAmountOf = (entry: EntryListItem): string => {
    const magnitude = Dec.of(toAmountString(entry.amount)).abs();
    if (!entry.discountAmount) return magnitude.toString();
    return magnitude.plus(toAmountString(entry.discountAmount)).toString();
  };

  /** 줄 하나의 정가. 목록이 주는 줄 금액도 차감을 뺀 뒤의 값이다. */
  const grossOfLine = (line: { amount: string; discountAmount: string | null }): string => {
    if (!line.discountAmount) return line.amount;
    return Dec.of(toAmountString(line.amount))
      .plus(toAmountString(line.discountAmount))
      .toString();
  };

  /**
   * 있는 거래를 폼 값으로 되돌린다.
   *
   * 고치기와 베끼기가 함께 쓴다. 두 길의 값이 갈리면 "고쳐 저장한 것"과 "베껴 저장한
   * 것"이 서로 다른 거래가 되므로 채우는 자리를 하나로 둔다. 어느 거래를 고치는가
   * (`editingId`)와 그 거래를 본 시점의 판(`baseHlc`)만 부르는 쪽이 정한다.
   */
  const formValuesOf = (entry: EntryListItem) => {
    const category = splitCategory(entry.categoryId);
    const fee = splitCategory(entry.feeCategoryId);
    // 분류 하나짜리 거래의 그 줄. 이체·카드 대금 결제에는 없다.
    const only = isSplitEntry(entry) ? null : entry.lines[0] ?? null;

    /*
     * 청구액을 되돌려 놓을 수 있는 거래인지.
     *
     * 아직 잠정인 거래는 채우지 않는다. 그 금액은 사용자가 넣은 적 없는 서버
     * 추정값인데, 칸에 적혀 있으면 확정된 금액처럼 보이고 그대로 저장하는 순간
     * 확정으로 넘어간다. 확정한 사실이 없는데 확정 표시가 붙으면 안 된다.
     *
     * 나머지 조건은 폼의 needsBilled 와 같다.
     */
    /*
     * 이 거래의 금액에 들어 있는 할부 이자. 유이자 할부가 아니면 0 이다.
     *
     * 금액 칸과 나눈 줄에서 같은 규칙으로 되뺀다 (`entryFormFromItem` 과 한 함수다).
     */
    const interest = interestInAmount(entry);

    const billedPrefill =
      !entry.rateProvisional &&
      isCurrencyCode(entry.originalCurrency) &&
      entry.originalCurrency !== ledgerCurrency &&
      currencyOfMethod(entry.accountId, entry.cardId) === ledgerCurrency &&
      displayCurrency === ledgerCurrency
        ? entry.amount
        : '';

    return {
      // 카드대금 결제는 통장에서 돈이 나가고 카드 부채가 줄어든다. 두 값을 다 들고 있어야
      // 저장할 때 그대로 돌려보낼 수 있으므로 method로 하나만 고르지 않는다.
      /*
       * 카드대금 결제는 이체 폼으로 편다.
       *
       * 저장된 전표는 통장 다리와 카드 부채 다리 둘뿐이라 이체와 같은 모양이고, 목록이
       * 나간 쪽을 accountId, 들어온 쪽을 toAccountId 로 준다. 앱도 같은 규칙이다
       * (core 의 entryFormFromItem).
       */
      method: entry.kind === 'card_payment' ? 'account' : entry.cardId ? 'card' : 'account',
      accountId: entry.accountId || '',
      cardId: entry.cardId || '',
      personId: entry.personId || '',
      type: entry.kind === 'card_payment' ? 'transfer' : entry.kind,
      mainCategoryId: category.mainCategoryId,
      subCategoryId: category.subCategoryId,
      /*
       * 금액과 통화.
       *
       * 서버는 목록 금액을 언제나 기준통화 환산액으로 준다. 외화 거래를 고칠 때
       * 환산액을 보여 주면 사용자가 입력했던 값과 달라 혼란스러우므로, 원 통화
       * 금액이 함께 왔으면 그것을 되돌려 놓는다.
       */
      /*
       * 유이자 할부의 이자는 전표 금액 안에 있다. 폼은 **산 값**을 든다.
       *
       * 갚을 돈 전부를 금액 칸에 넣으면 회차 원금의 합과 어긋나 저장이 막히고, 사용자가
       * 적은 적 없는 숫자가 칸에 들어앉는다. 되빼는 규칙은 앱과 한 함수를 쓴다.
       */
      amount:
        entry.originalAmount ??
        withoutInterest(grossAmountOf(entry), interest.total, interest.total),
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
      installmentMonths: entry.installmentMonths ? String(entry.installmentMonths) : '',
      /*
       * 옛 할부에는 이 값이 없다(null). 그때는 수수료 전표가 없다는 뜻이라 무이자로 연다 --
       * 고치려고 열었을 뿐인데 저장이 막히면 까닭을 알 수 없다.
       */
      installmentInterest: entry.installmentMonths
        ? entry.installmentInterest
          ? ('interest' as const)
          : ('free' as const)
        : ('' as const),
      // 적어 둔 값이 없으면 비워 둔다. 화면이 개월수로 나눈 기본값을 채워 보여 준다.
      installmentShares: entry.installmentShares ?? [],
      /*
       * 이자를 무엇으로 정했는지는 적어 둔 입력이 말해 준다. 둘 다 없으면 사용자가
       * 손으로 적은 이자라, 방식을 고르지 않은 채로 연다.
       */
      installmentInterestMode: (entry.installmentMonthlyPayment
        ? 'fixed'
        : entry.installmentAnnualRate
          ? 'rate'
          : '') as InstallmentInterestMode,
      installmentMonthlyPayment: entry.installmentMonthlyPayment ?? '',
      installmentAnnualRate: entry.installmentAnnualRate ?? '',
      installmentInterestShares: entry.installmentInterestShares ?? [],
      /*
       * 차감. 목록의 금액은 이미 차감된 뒤이므로 위 `amount` 와 짝으로 되돌린다.
       *
       * 통화는 위 `amount` 와 같다 -- 외화 거래면 둘 다 그 외화다.
       */
      /*
       * 줄에 달린 값들. 분류 하나짜리 거래는 그 줄의 것을 그대로 든다.
       *
       * 나눈 거래는 아래 `splits` 가 줄마다 들고, 여기 담긴 것은 줄을 새로 더할 때 쓰는
       * 기본값으로만 남는다. 이체와 카드 대금 결제에는 분류 줄이 없어 빈 값이다.
       */
      lineKey: only?.lineKey ?? newLineKey(),
      discountAmount: only?.discountAmount ?? '',
      // 실적 두 칸은 거래에 하나씩이다. 분할이어도 여기서 든다.
      countsPerformance: entry.countsPerformance,
      discountCountsPerformance: entry.discountCountsPerformance,
      tagIds: isSplitEntry(entry) ? [] : (only?.tags ?? entry.tags).map((tag) => tag.id),
      /*
       * 나눈 줄.
       *
       * 대표 분류(`categoryId`)는 그중 첫 줄이라, 그것만 폼에 담아 저장하면 나머지
       * 줄이 조용히 사라진다. 줄이 실려 오지 않은 분할은 아예 열지 않는다
       * (`handleEditClick`).
       */
      splits: isSplitEntry(entry)
        ? entry.lines.map((line) => ({
            ...splitCategory(line.categoryId),
            // 폼은 정가를 든다. 목록의 금액은 차감을 뺀 뒤의 값이고 이자를 품는다.
            amount: withoutInterest(
              grossOfLine(line),
              interest.shareOf(line.amount),
              interest.total,
            ),
            lineKey: line.lineKey,
            discountAmount: line.discountAmount ?? '',
            tagIds: line.tags.map((tag) => tag.id),
          }))
        : [],
    };
  };

  const handleEditClick = (entry: EntryListItem) => {
    if (!isEditable(entry)) {
      setError(t('editor.notEditable'));
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

    setEditingId(entry.id);
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

    setEditingId(null);
    setBaseHlc(null);
    setFormData(formValuesOf(entry));
    setIsModalOpen(true);
    setError('');
  };

  /**
   * 보관함의 후보로 폼을 채운다.
   *
   * 앱은 core 의 `entryFormFromDraft` 가 같은 일을 한다. 두 폼의 값 모양이 다르므로
   * (이쪽은 대분류·소분류를 나눠 들고, 결제수단도 method + id 로 나뉜다) 함수를
   * 공유하지 않고 규칙만 같게 둔다 -- 읽은 것만 덮어쓰고 나머지는 기본값이다.
   */
  const handleDraftClick = (draft: EntryDraftDto.Response) => {
    const category = splitCategory(draft.categoryId);
    const when = draft.occurredAt ? new Date(draft.occurredAt) : null;
    const hasWhen = when !== null && !Number.isNaN(when.getTime());
    const type =
      draft.kind === 'income' || draft.kind === 'transfer' ? draft.kind : 'expense';

    setEditingId(null);
    setBaseHlc(null);
    setFormData({
      ...emptyEntryForm(timeZone, ledgerCurrency),
      time: nowTimeKey(timeZone),
      type,
      // 카드가 있으면 카드로 낸 것이다. 없으면 통장이고, 둘 다 없으면 사람이 고른다.
      method: draft.cardId ? 'card' : 'account',
      cardId: draft.cardId ?? '',
      accountId: draft.accountId ?? '',
      personId: draft.personId || myPersonId || '',
      amount: draft.amount ?? '',
      /*
       * 통화. 장부 통화와 같으면 그대로 둔다.
       *
       * 후보에는 "12,000원"에서 읽은 'KRW' 가 담기는데, 장부 통화가 원화인 가계부에서
       * 그 값을 넣으면 환율·청구액 칸이 열린다. 같은 통화면 환산할 것이 없다.
       */
      currency:
        draft.currency && isCurrencyCode(draft.currency) ? draft.currency : ledgerCurrency,
      currencyTouched: Boolean(draft.currency && draft.currency !== ledgerCurrency),
      description: draft.description ?? draft.merchant ?? '',
      merchant: draft.merchant ?? '',
      mainCategoryId: type === 'transfer' ? '' : category.mainCategoryId,
      subCategoryId: type === 'transfer' ? '' : category.subCategoryId,
      /*
       * 태그. 반복에 붙여 둔 것이 후보를 지나 여기까지 온다.
       *
       * 알림·캡처 후보에는 비어 있다 -- 문구에서 태그를 읽어 낼 방법이 없다. 지운
       * 태그의 id 가 섞일 자리는 없다(서버가 다리 표로 들고 있어 함께 사라진다).
       */
      tagIds: draft.tagIds ?? [],
      installmentMonths:
        type === 'expense' && draft.installmentMonths ? String(draft.installmentMonths) : '',
      // 후보에는 수수료 여부가 없다. 문자 한 줄로는 알 수 없어 사용자가 고른다.
      installmentInterest: '' as const,
      installmentShares: [] as string[],
      installmentInterestMode: '' as InstallmentInterestMode,
      installmentMonthlyPayment: '',
      installmentAnnualRate: '',
      installmentInterestShares: [] as string[],
      ...(hasWhen
        ? {
            date: dateKeyOf(when as Date, timeZone),
            time: timeInputOf(when as Date, timeZone),
          }
        : {}),
    });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm(t('account.deleteConfirm'))) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteEntry(id);
      await onEntryChange();
    } catch (err: any) {
      const errorMsg = messageOf(err, 'editor.deleteFailed');
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
        alert(t('card.issuerRequired'));
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
      subCategories: parentId ? [{ id: '', name: '' }] : NO_SUB_CATEGORIES,
    });
    setCategoryError('');
    setIsCategoryModalOpen(true);
  };

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const subs = filledSubCategories(categoryFormData.subCategories);
    // 소분류 모드에서는 이름이 하나라도 있어야 만들 것이 있다.
    if (categoryParent && subs.length === 0) {
      setCategoryError(t('editor.subNameRequired'));
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
            ? { ...prev, subCategoryId: created[0].id }
            : prev,
        );
      }

      closeCategoryModal();
    } catch (err: any) {
      setCategoryError(messageOf(err, 'categories.addFailed'));
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
    openCopy: handleCopyClick,
    openEdit: handleEditClick,
    openDraft: handleDraftClick,
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
              {/* 유형을 맨 위에서 탭으로 고른다. 아래 입력이 유형에 따라 달라지므로 먼저 정한다. */}
              <div role="tablist" aria-label={t('editor.kindTablist')} className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {ENTRY_TYPE_TABS.map((tab) => {
                  // 카드는 지출만 만들 수 있고, 결제된 청구서에 속한 내역은 유형을 못 바꾼다.
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.amount')}</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    required
                    /* 팝업이 열리면 여기부터 입력한다 (Modal이 이 표시를 찾아 포커스한다) */
                    data-autofocus
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
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
                          {t(isCreditCardSelected ? 'editor.billedCredit' : 'editor.billedDebit', {
                    currency: ledgerCurrency,
                  })}
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
                          placeholder={t(
                    isCreditCardSelected
                      ? 'editor.billedCreditPlaceholder'
                      : 'editor.billedDebitPlaceholder',
                  )}
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          {isCreditCardSelected
                            ? t('editor.billedCreditHint')
                            : t('editor.billedDebitHint')}
                        </p>
                      </div>
                    )}

                    {/* 적용되는 환율. 입력값이 아니라 결과다. */}
                    <div className="px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">
                          {t('editor.rateLabel', { from: formData.currency, to: ledgerCurrency })}
                        </span>
                        <span className="font-medium text-gray-900">
                          {derivedRate || formatNumber(rateOf(formData.currency)) || '-'}
                          {!hasBilled && <span className="ml-1 text-gray-500">{t('editor.rateDefault')}</span>}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {convertedPreview
                          ? t('editor.recordedAs', { amount: convertedPreview })
                          : t('editor.recordedHint')}
                        {!hasBilled && t('editor.rateSettingsHint')}
                      </p>
                    </div>
                  </div>
                )}

                {paymentCurrency !== formData.currency && formData.currency !== ledgerCurrency && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t('editor.foreignHint', { payment: paymentCurrency, ledger: ledgerCurrency })}
                  </p>
                )}
              </div>

              {/* 그다음 날짜와 시각을 받는다. 자주 고치는 값이라 위쪽에 둔다. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('editor.date')}
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
                    {t('editor.time')}
                  </label>
                  <input
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {formData.type === 'transfer' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('editor.fromAccount')}
                  </label>
                  {/* 신용카드를 고르면 카드사에 대금을 갚는 것이 아니라 환불을 받는 쪽이 된다 */}
                  <CustomSelect
                    options={transferOptionsFor(formData.toAccountId)}
                    value={formData.accountId}
                    onChange={(value) =>
                      setFormData({ ...formData, method: 'account', accountId: value, cardId: '' })
                    }
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('editor.method')}
                  </label>
                  {/* 계좌와 카드를 한 목록에서 고른다. 접두사로 종류를 구분한다. */}
                  <CustomSelect
                    options={paymentMethodOptions}
                    value={selectedPaymentMethodId}
                    onChange={handlePaymentMethodChange}
                    onAddClick={() => setIsMethodChooserOpen(true)}
                    addButtonLabel={t('editor.addMethod')}
                  />

                  {/*
                    카드 실적에 셀지. 카드를 골랐을 때만 뜬다.

                    청구액과는 다른 값이다 -- 꺼도 갚을 대금은 그대로다. 지출은 켜짐이
                    기본이고(쓴 돈이다) 카드로 들어온 돈은 꺼짐이 기본이다(캐시백은
                    실적을 깎지 않는다).
                  */}
                  {formData.method === 'card' && formData.cardId && (
                    <label className="mt-2 flex items-start gap-2 rounded-lg border border-gray-200 p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.countsPerformance}
                        onChange={(e) =>
                          setFormData({ ...formData, countsPerformance: e.target.checked })
                        }
                        className="mt-0.5 h-4 w-4"
                      />
                      <span className="flex-1">
                        <span className="block text-sm text-gray-900">
                          {t('editor.countsPerformance')}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {t('editor.countsPerformanceHint')}
                        </span>
                      </span>
                    </label>
                  )}

                  {/*
                    수입을 카드로 받는 자리.

                    신용카드면 통장으로 들어오는 돈이 아니라 그 카드의 빚이 줄고,
                    체크카드면 연결 통장으로 들어온다. 둘이 전혀 다른 일이라 고른
                    뒤에야 알게 하지 않는다.
                  */}
                  {formData.type === 'income' && formData.method === 'card' && formData.cardId && (
                    <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      {isCreditCardSelected
                        ? t('editor.cardIncomeNote')
                        : t('editor.cardIncomeDebitNote', {
                            account:
                              accounts.find(
                                (account) =>
                                  account.id ===
                                  cards.find((card) => card.id === formData.cardId)
                                    ?.paymentAccountId,
                              )?.name ?? t('editor.methodAccount'),
                          })}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('editor.person')}
                </label>
                <CustomSelect
                  options={people.map((p) => ({ id: p.id, name: p.name }))}
                  value={formData.personId}
                  onChange={(value) => setFormData({ ...formData, personId: value })}
                  onAddClick={() => setIsPersonModalOpen(true)}
                  addButtonLabel={t('editor.addPerson')}
                />
              </div>

              {formData.type !== 'transfer' && (
                hasSplits ? (
                  /*
                    분류를 나눈 줄들.

                    줄이 있는 동안에는 위의 대분류·소분류 칸을 감춘다. 둘이 함께 보이면
                    어느 쪽이 저장되는지 알 수 없는데, 실제로 저장되는 것은 줄들뿐이다.
                  */
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('editor.split')}
                    </label>

                    <div className="space-y-3">
                      {formData.splits.map((split, index) => (
                        <div
                          key={index}
                          className="unfold p-3 space-y-2 border border-gray-200 rounded-lg"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-500">
                              {t('editor.splitRow', { index: index + 1 })}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeSplitRow(index)}
                              aria-label={t('editor.splitRemove')}
                              className="p-1 text-gray-400 rounded transition-colors hover:text-gray-700 hover:bg-gray-100"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <input
                            type="number"
                            value={split.amount}
                            onChange={(e) => updateSplitRow(index, { amount: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                          />

                          <CustomSelect
                            options={mainCategoryOptions}
                            value={split.mainCategoryId}
                            onChange={(value) =>
                              updateSplitRow(index, { mainCategoryId: value, subCategoryId: '' })
                            }
                            placeholder={t('editor.parentCategory')}
                            onAddClick={() => openCategoryModal()}
                            addButtonLabel={t('editor.addParentCategory')}
                          />

                          <CustomSelect
                            options={subCategoryOptions(split.mainCategoryId)}
                            value={split.subCategoryId}
                            onChange={(value) => updateSplitRow(index, { subCategoryId: value })}
                            placeholder={t('editor.none')}
                            /* 소분류는 대분류 아래에 붙는다. 고르기 전에는 붙일 곳이 없다. */
                            onAddClick={
                              split.mainCategoryId
                                ? () => openCategoryModal(split.mainCategoryId)
                                : undefined
                            }
                            addButtonLabel={t('editor.addChildCategory')}
                          />

                          {/*
                            이 줄에서 깎인 금액.

                            줄마다 따로 받는다. 여행경비만 환불받았는데 비율로 나누면
                            식비 줄까지 함께 깎여, 분류별 분석이 사실과 어긋난다.
                          */}
                          {formData.type === 'expense' && (
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-500">
                                {t('editor.discount')}
                              </label>
                              <input
                                type="number"
                                value={split.discountAmount}
                                onChange={(e) =>
                                  updateSplitRow(index, { discountAmount: e.target.value })
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0"
                              />
                              {toNumber(split.discountAmount) > 0 && (
                                <p className="mt-1 text-xs font-medium text-gray-700">
                                  {t('editor.netAmount', {
                                    amount: formatCurrency(
                                      toNumber(split.amount) - toNumber(split.discountAmount),
                                      formData.currency,
                                    ),
                                  })}
                                </p>
                              )}

                              {/*
                                깎인 만큼 실적도 줄일지. 환불액을 적은 줄 바로 아래에 둔다.

                                **값은 거래에 하나뿐이다.** 깎인 금액은 줄마다 다르지만
                                그것을 실적에서 뺄지는 카드사의 방침 하나라, 어느 줄의
                                체크를 건드려도 나머지 줄의 체크가 같이 움직인다.
                              */}
                              {showDiscountPerformance({
                                kind: 'expense',
                                discountAmount: split.discountAmount,
                                countsPerformance: formData.countsPerformance,
                                isCard: formData.method === 'card' && Boolean(formData.cardId),
                                isLedgerCurrency: formData.currency === ledgerCurrency,
                              }) && (
                                <label className="mt-2 flex items-start gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={formData.discountCountsPerformance}
                                    onChange={(e) =>
                                      setFormData({
                                        ...formData,
                                        discountCountsPerformance: e.target.checked,
                                      })
                                    }
                                    className="mt-0.5 h-4 w-4"
                                  />
                                  <span className="flex-1 text-xs text-gray-600">
                                    {t('editor.discountCountsPerformance')}
                                  </span>
                                </label>
                              )}
                            </div>
                          )}

                          {/*
                            이 줄의 태그.

                            태그가 줄에 붙으므로 여기서 고른다. 나눈 두 줄이 서로 다른
                            태그를 갖는 것이 이 바꿈의 요점이다 -- "이 결제는 여행이었다"가
                            여행경비 줄의 사실이지 식비 줄의 사실은 아니다.
                          */}
                          {tags.length > 0 && (
                            <div>
                              <span className="mb-1 block text-xs font-medium text-gray-500">
                                {t('tags.pick')}
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {tags.map((tag) => {
                                  const isSelected = split.tagIds.includes(tag.id);
                                  return (
                                    <button
                                      key={tag.id}
                                      type="button"
                                      aria-pressed={isSelected}
                                      onClick={() =>
                                        setFormData((previous) => ({
                                          ...previous,
                                          splits: previous.splits.map((row, at) =>
                                            at === index
                                              ? {
                                                  ...row,
                                                  tagIds: row.tagIds.includes(tag.id)
                                                    ? row.tagIds.filter((id) => id !== tag.id)
                                                    : [...row.tagIds, tag.id],
                                                }
                                              : row,
                                          ),
                                        }))
                                      }
                                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 ${
                                        isSelected
                                          ? 'border-blue-600 bg-blue-50 font-medium text-blue-600'
                                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                                      }`}
                                    >
                                      {tag.color && (
                                        <span
                                          className="h-2 w-2 rounded-full"
                                          style={{ backgroundColor: tag.color }}
                                        />
                                      )}
                                      {tag.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={addSplitRow}
                        className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg transition-colors hover:bg-gray-50"
                      >
                        {t('editor.splitAdd')}
                      </button>

                      {/*
                        남은 금액을 보여 준다. 합이 맞아야 저장되므로, 저장을 눌러 보고서야
                        어긋난 것을 알게 하지 않는다.
                      */}
                      <p className="text-xs text-gray-500">
                        {t('editor.splitLeft', { amount: formatNumber(splitLeft) })}
                      </p>
                      <p className="text-xs text-gray-500">{t('editor.splitHint')}</p>
                    </div>
                  </div>
                ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('editor.parentCategory')}
                    </label>
                    <CustomSelect
                      options={mainCategoryOptions}
                      value={formData.mainCategoryId}
                      onChange={(value) =>
                        setFormData({
                          ...formData,
                          mainCategoryId: value,
                          subCategoryId: '',
                        })
                      }
                      onAddClick={() => openCategoryModal()}
                      addButtonLabel={t('editor.addParentCategory')}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('editor.childCategory')}
                    </label>
                    <CustomSelect
                      options={subCategoryOptions(formData.mainCategoryId)}
                      value={formData.subCategoryId}
                      onChange={(value) =>
                        setFormData({ ...formData, subCategoryId: value })
                      }
                      placeholder={t('editor.none')}
                      /*
                        소분류는 대분류 아래에 붙는다. 대분류를 고르기 전에는 붙일 곳이
                        없으므로 버튼 자체를 내리고, 고른 뒤에는 그 대분류로 팝업을 연다.
                      */
                      onAddClick={
                        formData.mainCategoryId
                          ? () => openCategoryModal(formData.mainCategoryId)
                          : undefined
                      }
                      addButtonLabel={t('editor.addChildCategory')}
                    />
                  </div>

                  {/* 분류를 나누는 자리. 누르면 지금 적은 금액과 분류가 첫 줄로 옮겨 간다. */}
                  <button
                    type="button"
                    onClick={addSplitRow}
                    className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg transition-colors hover:bg-gray-50"
                  >
                    {t('editor.splitAdd')}
                  </button>
                </>
                )
              )}

              {formData.type === 'transfer' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('editor.toAccount')}
                    </label>
                    <CustomSelect
                      options={transferOptionsFor(formData.accountId)}
                      value={formData.toAccountId}
                      onChange={(value) => setFormData({ ...formData, toAccountId: value })}
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
                        {t('editor.receivedAmount', { currency: toCurrency })}
                      </label>
                      <input
                        type="number"
                        value={formData.toAmount}
                        onChange={(e) => setFormData({ ...formData, toAmount: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="135000"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        {t('editor.exchangeHint', { from: paymentCurrency, to: toCurrency })}
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
                        ? t('editor.toCardPayment')
                        : t('editor.toCardRefund')}{' '}
                      {t('editor.cardTransferNote')}
                    </div>
                  )}

                  {/* 카드사와의 이체에는 수수료를 붙일 수 없다 (서버도 거부한다) */}
                  <div className={transferCardSide ? 'hidden' : undefined}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('editor.transferFee')}
                    </label>
                    <input
                      type="number"
                      value={formData.transferFee}
                      onChange={(e) => setFormData({ ...formData, transferFee: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>

                  {formData.transferFee && parseInt(formData.transferFee) > 0 && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('editor.feeParentCategory')}
                        </label>
                        <CustomSelect
                          options={categories
                            .filter((c) => !c.parentId && c.type === 'expense')
                            .map((cat) => ({ id: cat.id, name: cat.name }))}
                          value={formData.transferFeeMainCategoryId}
                          onChange={(value) =>
                            setFormData({
                              ...formData,
                              transferFeeMainCategoryId: value,
                              transferFeeSubCategoryId: '',
                            })
                          }
                          onAddClick={() => openCategoryModal()}
                          addButtonLabel={t('editor.addParentCategory')}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('editor.feeChildCategory')}
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
                              : [{ id: '', name: t('editor.none') }]
                          }
                          value={formData.transferFeeSubCategoryId}
                          onChange={(value) =>
                            setFormData({
                              ...formData,
                              transferFeeSubCategoryId: value,
                            })
                          }
                          placeholder={t('editor.none')}
                        />
                      </div>

                    </>
                  )}
                </>
              )}

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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('editor.merchant')}
                </label>
                <input
                  type="text"
                  value={formData.merchant}
                  onChange={(e) => setFormData({ ...formData, merchant: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('editor.merchantPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('editor.memo')}
                </label>
                <input
                  type="text"
                  value={formData.detailedNote}
                  onChange={(e) => setFormData({ ...formData, detailedNote: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('editor.memoPlaceholder')}
                />
              </div>

              {/*
                태그. 갈래를 가리지 않으므로 이체에도 뜬다.

                카테고리와 달리 **여럿을 고른다.** 그래서 select 가 아니라 알약 줄이다 --
                여러 개 고르는 select 는 무엇이 골라졌는지 열어 봐야 알 수 있다.
              */}
              {/*
                태그가 하나도 없어도 이 자리는 선다. 만드는 길이 여기뿐이라, 비었다고
                접으면 첫 태그를 만들 곳이 없다.

                **나눈 거래에서는 감춘다.** 그때는 태그가 줄마다 붙으므로 위의 줄 칸에서
                고른다. 둘이 함께 보이면 어느 쪽이 저장되는지 알 수 없다.
              */}
              {!hasSplits && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="block text-sm font-medium text-gray-700">{t('tags.pick')}</span>
                  <button
                    type="button"
                    onClick={() => setIsTagModalOpen(true)}
                    aria-label={t('tags.add')}
                    className="rounded px-2 py-0.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
                  >
                    + {t('common.add')}
                  </button>
                </div>
                {tags.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('tags.empty')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      const isSelected = formData.tagIds.includes(tag.id);

                      return (
                        <button
                          key={tag.id}
                          type="button"
                          aria-pressed={isSelected}
                          /*
                           * 앞선 값에서 뒤집는다. 이 폼의 다른 칸과 달리 함수형으로 넘긴다.
                           *
                           * `{...formData}` 로 두면 그릴 때 잡힌 값을 쓰므로, 한 번 그리기 전에
                           * 두 개를 잇달아 누르면 뒤엣것이 앞엣것을 덮어써 하나만 남는다
                           * (실제로 그랬다). 다른 칸은 값을 갈아 끼우기만 해서 드러나지 않지만
                           * 여기는 앞선 목록에 더하고 빼는 자리다.
                           */
                          onClick={() =>
                            setFormData((previous) => ({
                              ...previous,
                              tagIds: previous.tagIds.includes(tag.id)
                                ? previous.tagIds.filter((id) => id !== tag.id)
                                : [...previous.tagIds, tag.id],
                            }))
                          }
                          /* 눌린 것이 살짝 커졌다 돌아온다. 색만으로는 방금 무엇이 바뀌었는지 잘 안 보인다. */
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50 font-medium text-blue-600'
                              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {tag.color && (
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                          )}
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {tags.length > 0 ? (
                  <p className="mt-1 text-xs text-gray-500">{t('tags.pickHint')}</p>
                ) : null}
              </div>
              )}

              {/*
                할부. 자주 쓰는 값이 아니라 폼 맨 아래에 둔다.

                신용카드 지출에만 뜬다. 체크카드는 결제 즉시 통장에서 빠지고 통장에는
                갚을 빚이 없어 나눌 청구가 없다 (서버도 같은 규칙으로 막는다).
                원금과 지출은 구매 시점에 전액 잡히고, 카드 화면의 주기별 사용액만 나뉜다.
              */}
              {canInstall && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('editor.installment')}
                  </label>
                  <CustomSelect
                    options={installmentOptions(t)}
                    value={formData.installmentMonths}
                    onChange={(value) =>
                      setFormData({
                        ...formData,
                        installmentMonths: value,
                        // 일시불로 되돌리면 고른 종류도 함께 떨어진다.
                        installmentInterest: Number(value) >= 2 ? formData.installmentInterest : '',
                        // 개월수가 바뀌면 적어 둔 회차 금액은 개수가 맞지 않는다.
                        installmentShares: [],
                        installmentInterestShares: [],
                        /*
                         * 월 납입액도 함께 비운다. **개월수와 한 쌍인 값**이라서다 --
                         * "10,000원을 3개월, 매달 4,000원"의 4,000원은 3개월일 때의
                         * 사실이고, 6개월로 바꾸면 그 값으로는 표가 풀리지 않는다.
                         * 그대로 두면 저장할 때 "매달 내는 금액 x 개월수가 결제 금액보다
                         * 적습니다"로 막혀, 어디를 고쳐야 하는지 알 수 없다.
                         *
                         * 연이율은 개월수와 무관해 그대로 둔다.
                         */
                        installmentMonthlyPayment: '',
                      })
                    }
                    placeholder={t('editor.installmentOnce')}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {t('editor.installmentHint')}
                  </p>

                  {/*
                    수수료가 붙는 할부인가. 개월수를 고른 뒤에만 묻는다.

                    기본값을 두지 않는다. 무이자로 두면 유이자 할부가 조용히 수수료 없이
                    지나가고, 유이자로 두면 무이자 결제마다 "수수료 미입력"이 쌓인다.
                  */}
                  {Number(formData.installmentMonths) >= 2 && (
                    <div className="mt-2">
                      <div className="flex gap-2">
                        {(['free', 'interest'] as const).map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                installmentInterest: choice,
                                /*
                                 * 무이자로 되돌리면 이자 쪽을 통째로 비운다. 남겨 두면
                                 * 수수료가 없는 할부에 이자가 붙어 보이고, 회차 기준으로
                                 * 볼 때 그 달 지출이 실제보다 커진다.
                                 */
                                ...(choice === 'interest'
                                  ? {}
                                  : {
                                      installmentInterestMode: '' as InstallmentInterestMode,
                                      installmentMonthlyPayment: '',
                                      installmentAnnualRate: '',
                                      installmentInterestShares: [],
                                    }),
                              })
                            }
                            className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                              formData.installmentInterest === choice
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-300 text-gray-700'
                            }`}
                          >
                            {t(
                              choice === 'free'
                                ? 'editor.installmentFree'
                                : 'editor.installmentInterest',
                            )}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {t(
                          formData.installmentInterest === 'interest'
                            ? 'editor.installmentInterestHint'
                            : 'editor.installmentFreeHint',
                        )}
                      </p>

                      {/*
                        회차 금액. 기본값을 채워 두고 다른 자리만 고치게 한다.

                        끝수를 어느 회차에 붙이는지가 카드사마다 다르다 -- 1,000원
                        3개월이 334/333/333 일 수도 334/334/332 일 수도 있어, 계산만으로는
                        명세서와 맞출 수 없다.
                      */}
                      <div className="mt-3 space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-medium text-gray-700">
                            {t('editor.installmentShares')}
                          </span>
                          {formData.installmentShares.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, installmentShares: [] })}
                              className="text-xs text-blue-600"
                            >
                              {t('editor.installmentSharesReset')}
                            </button>
                          )}
                        </div>

                        {shareInputs.map((share, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <span className="w-16 text-xs text-gray-500">
                              {t('editor.installmentShareRow', { index: index + 1 })}
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={share}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  installmentShares: shareInputs.map((old, at) =>
                                    at === index ? e.target.value : old,
                                  ),
                                })
                              }
                              className="flex-1 px-2 py-1 border rounded text-sm text-right"
                            />
                          </div>
                        ))}

                        <p className="text-right text-xs text-gray-500">
                          {t('editor.installmentSharesSum', {
                            total: installmentShareTotal(shareInputs),
                            amount: formData.amount || '0',
                          })}
                        </p>
                        <p className="text-xs text-gray-500">{t('editor.installmentSharesHint')}</p>
                      </div>

                      {/*
                        이자. 유이자 할부에만 묻는다.

                        카드사가 정하는 방식이 둘이다. 매달 같은 금액을 내는 할부는 낸
                        돈에서 이자를 먼저 떼어 앞 회차일수록 이자가 크고, 연이율만
                        정해진 할부는 남은 원금에 매달 이자가 붙어 뒤로 갈수록 가볍다.
                        어느 쪽도 아니면 빈 칸으로 두고 명세서를 보고 적는다.
                      */}
                      {formData.installmentInterest === 'interest' && (
                        <div className="mt-3 space-y-1">
                          <span className="text-xs font-medium text-gray-700">
                            {t('editor.installmentInterestMode')}
                          </span>
                          <div className="flex gap-2">
                            {(['fixed', 'rate', ''] as const).map((mode) => (
                              <button
                                key={mode || 'manual'}
                                type="button"
                                onClick={() =>
                                  setFormData({
                                    ...formData,
                                    installmentInterestMode: mode,
                                    // 방식을 바꾸면 계산이 다시 채운다. 고친 값은 그 방식의 것이다.
                                    installmentInterestShares: [],
                                  })
                                }
                                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                                  formData.installmentInterestMode === mode
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-gray-300 text-gray-700'
                                }`}
                              >
                                {t(
                                  mode === 'fixed'
                                    ? 'editor.installmentModeFixed'
                                    : mode === 'rate'
                                      ? 'editor.installmentModeRate'
                                      : 'editor.installmentModeManual',
                                )}
                              </button>
                            ))}
                          </div>

                          {formData.installmentInterestMode === 'fixed' && (
                            <>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formData.installmentMonthlyPayment}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    installmentMonthlyPayment: e.target.value,
                                    installmentInterestShares: [],
                                  })
                                }
                                placeholder={t('editor.installmentMonthlyPayment')}
                                className="w-full px-2 py-1 border rounded text-sm text-right"
                              />
                              <p className="text-xs text-gray-500">
                                {t('editor.installmentMonthlyPaymentHint')}
                              </p>
                            </>
                          )}

                          {formData.installmentInterestMode === 'rate' && (
                            <>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formData.installmentAnnualRate}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    installmentAnnualRate: e.target.value,
                                    installmentInterestShares: [],
                                  })
                                }
                                placeholder={t('editor.installmentAnnualRate')}
                                className="w-full px-2 py-1 border rounded text-sm text-right"
                              />
                              <p className="text-xs text-gray-500">
                                {t('editor.installmentAnnualRateHint')}
                              </p>
                            </>
                          )}

                          <div className="flex items-baseline justify-between pt-2">
                            <span className="text-xs font-medium text-gray-700">
                              {t('editor.installmentInterestShares')}
                            </span>
                            {formData.installmentInterestShares.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setFormData({ ...formData, installmentInterestShares: [] })
                                }
                                className="text-xs text-blue-600"
                              >
                                {t('editor.installmentInterestReset')}
                              </button>
                            )}
                          </div>

                          {interestInputs.map((interest, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <span className="w-20 text-xs text-gray-500">
                                {t('editor.installmentInterestRow', { index: index + 1 })}
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={interest}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    installmentInterestShares: interestInputs.map((old, at) =>
                                      at === index ? e.target.value : old,
                                    ),
                                  })
                                }
                                className="flex-1 px-2 py-1 border rounded text-sm text-right"
                              />
                            </div>
                          ))}

                          <p className="text-right text-xs text-gray-500">
                            {t('editor.installmentInterestTotal', {
                              total: installmentShareTotal(interestInputs),
                            })}
                          </p>
                          {/*
                            카드에 갚을 돈. 이자가 금액에 더해져 거래에 적힌다.

                            금액 칸은 산 값 그대로 두고 여기서만 밝힌다 -- 사용자가 적은
                            숫자를 화면이 말없이 올리면 무엇을 저장하는지 알 수 없다.
                          */}
                          <p className="text-right text-xs font-medium text-gray-700">
                            {t('editor.installmentTotalDue', {
                              total: installmentShareTotal([
                                formData.amount || '0',
                                installmentShareTotal(interestInputs),
                              ]),
                              amount: formData.amount || '0',
                            })}
                          </p>
                          <p className="text-xs text-gray-500">
                            {t('editor.installmentInterestSharesHint')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/*
                차감·취소. 포인트 사용, 자동할인, 그리고 취소가 이 칸 하나로 들어간다.

                셋은 전표에서 같은 모양이다 -- 정가는 위 금액 칸에 그대로 두고, 여기에는
                덜 나간 몫을 적는다. 전액을 적으면 0원 거래로 남는다. 지우지 않는 것은
                있었던 일이기 때문이다.

                **나눈 거래에서는 감춘다.** 그때는 깎인 금액을 줄마다 적으므로(위의 줄
                칸) 여기 한 칸을 더 두면 어느 쪽이 저장되는지 알 수 없다.
              */}
              {formData.type === 'expense' && !hasSplits && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('editor.discount')}
                  </label>
                  <input
                    type="number"
                    value={formData.discountAmount}
                    onChange={(e) =>
                      setFormData({ ...formData, discountAmount: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                  />
                  <p className="mt-1 text-xs text-gray-500">{t('editor.discountHint')}</p>

                  {/* 실제로 빠지는 금액. 저장하고 목록에서 보고서야 알게 하지 않는다. */}
                  {toNumber(formData.discountAmount) > 0 && (
                    <p className="mt-2 text-xs font-medium text-gray-700">
                      {t('editor.netAmount', {
                        amount: formatCurrency(
                          toNumber(formData.amount) - toNumber(formData.discountAmount),
                          formData.currency,
                        ),
                      })}
                    </p>
                  )}
                </div>
              )}

              {/*
                깎인 만큼 실적도 줄일지. 기본은 줄인다 -- 다리가 이미 순액이라 그것이
                지금까지의 동작이다. 카드사가 환불을 실적에서 빼지 않는 경우가 있어,
                끄면 실적만 정가로 센다.

                **나눈 거래에서는 감춘다.** 그때는 환불액을 적는 줄마다 같은 체크가
                바로 아래에 서 있다. 값은 어느 쪽이든 하나라 함께 움직인다.

                거래 자체를 실적에서 뺐으면 뜨지 않는다. 그때는 어느 쪽이든 실적이
                움직이지 않아 물을 것이 없다.
              */}
              {!hasSplits &&
                showDiscountPerformance({
                  kind: formData.type === 'income' ? 'income' : 'expense',
                  discountAmount: totalDiscount,
                  countsPerformance: formData.countsPerformance,
                  isCard: formData.method === 'card' && Boolean(formData.cardId),
                  isLedgerCurrency: formData.currency === ledgerCurrency,
                }) && (
                <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.discountCountsPerformance}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        discountCountsPerformance: e.target.checked,
                      })
                    }
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="flex-1">
                    <span className="block text-sm text-gray-900">
                      {t('editor.discountCountsPerformance')}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {t('editor.discountCountsPerformanceHint')}
                    </span>
                  </span>
                </label>
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
        title={t('card.add')}
        footer={
          <button
            type="submit"
            form={CARD_FORM_ID}
            disabled={cardSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {cardSubmitting ? t('account.adding') : t('account.addSubmit')}
          </button>
        }
      >
        <form id={CARD_FORM_ID} onSubmit={handleCardSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.name')}
            </label>
            <input
              type="text"
              required
              value={cardFormData.name}
              onChange={(e) => setCardFormData({ ...cardFormData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('card.namePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.account')}
            </label>
            <CustomSelect
              options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
              value={cardFormData.accountId}
              onChange={(value) => setCardFormData({ ...cardFormData, accountId: value })}
              onAddClick={() => {}}
              addButtonLabel={t('account.add')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.numberOptional')}
            </label>
            <input
              type="text"
              value={cardFormData.cardNumber}
              onChange={(e) => setCardFormData({ ...cardFormData, cardNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('card.numberPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.type')}
            </label>
            <CustomSelect
              options={[
                { id: 'debit', name: t('method.debit_card') },
                { id: 'credit', name: t('method.credit_card') },
              ]}
              value={cardFormData.cardType}
              onChange={(value) => setCardFormData({ ...cardFormData, cardType: value as 'debit' | 'credit' })}
              onAddClick={() => {}}
              addButtonLabel=""
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.issuer')}
            </label>
            <CustomSelect
              options={issuerOptions}
              value={cardFormData.issuerId}
              onChange={(value) => setCardFormData({ ...cardFormData, issuerId: value })}
              placeholder={t('card.issuerPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.expiry')}
            </label>
            <input
              type="month"
              value={cardFormData.expiryDate}
              onChange={(e) => setCardFormData({ ...cardFormData, expiryDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.color')}</label>
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
                  {t('card.limit', { currency: ledgerCurrency })}
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
                  {t('card.closingDay')}
                </label>
                <select
                  value={cardFormData.statementClosingDay}
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, statementClosingDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {dayOfMonthOptions().map((option) => (
                    <option key={option.day} value={option.day}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{dayOfMonthHint()}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.paymentDay')}
                </label>
                <select
                  value={cardFormData.paymentDueDay}
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, paymentDueDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {dayOfMonthOptions().map((option) => (
                    <option key={option.day} value={option.day}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{dayOfMonthHint()}</p>
              </div>
            </>
          )}

        </form>
      </Modal>

      {/* 대분류 추가와 "이 대분류에 소분류 추가"를 한 팝업으로 처리한다 */}
      <Modal
        isOpen={isCategoryModalOpen}
        onClose={closeCategoryModal}
        title={
          categoryParent
            ? t('editor.subCategoryAddTitle', { parent: categoryParent.name })
            : t('editor.categoryAddTitle')
        }
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
            {categorySubmitting ? t('account.adding') : t('account.addSubmit')}
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
        title={t('editor.detailTitle')}
        /*
          내용 복사. 머리글 오른쪽에 둔다 -- 아래 단추 자리는 이 거래를 고치고 지우는
          자리이고, 베끼기는 이 거래를 건드리지 않는 다른 일이다.
        */
        headerAction={
          selectedTransaction && canEdit && isCopyableEntry(selectedTransaction) ? (
            <button
              type="button"
              onClick={handleDetailCopyClick}
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
          selectedTransaction && canEdit ? (
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
                  {t('account.editSubmit')}
                </button>
              ) : (
                <div className="flex-1 px-4 py-2 text-sm text-gray-500 bg-gray-50 rounded-lg text-center">
                  {t('editor.adjustmentNotEditable')}
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
                {t('account.deleteSubmit')}
              </button>
            </div>
          ) : null
        }
      >
        {selectedTransaction && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('editor.methodLabel')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {t(selectedTransaction.cardId ? 'editor.methodCard' : 'editor.methodAccount')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t(selectedTransaction.cardId ? 'editor.methodCard' : 'editor.methodAccount')}
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
                {t('editor.person')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.personName || '-'}
              </p>
            </div>

            {/*
              붙은 태그. 다른 칸과 달리 글자가 아니라 알약이다 -- 여럿이라 쉼표로 이으면
              어디까지가 태그 하나인지 읽어야 알 수 있다.
            */}
            {selectedTransaction.tags.length > 0 && (
              <div>
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {t('tags.pick')}
                </span>
                <div className="flex flex-wrap gap-1.5 rounded-lg bg-gray-50 px-3 py-2">
                  {selectedTransaction.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[13px] text-gray-700 shadow-sm"
                    >
                      {tag.color && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                      )}
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('editor.kindLabel')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {ENTRY_KIND_KEY[selectedTransaction.kind]
                  ? t(ENTRY_KIND_KEY[selectedTransaction.kind])
                  : selectedTransaction.kind}
              </p>
            </div>

            {/*
              나눈 거래는 줄을 그대로 풀어서 보여 준다.

              예전에는 "분할 N건"으로 뭉쳐 대표 분류 하나만 적었다. 목록이 줄로 펴 보여
              주는데 상세에서 다시 뭉치면, 눌러서 연 화면이 눌렀던 줄보다 적게 말한다.
              태그와 차감도 줄마다 다를 수 있어 여기서 함께 적는다.
            */}
            {isSplitEntry(selectedTransaction) ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('editor.split')}
                </label>
                <div className="divide-y divide-gray-100 rounded-lg bg-gray-50">
                  {selectedTransaction.lines.map((line) => (
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
                      {(line.tags.length > 0 || line.discountAmount) && (
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
                          {line.discountAmount && (
                            <span className="font-medium tabular-nums text-green-600">
                              {t('entry.discount', {
                                amount: formatCurrency(
                                  toNumber(line.discountAmount),
                                  displayCurrency,
                                ),
                              })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('editor.parentCategory')}
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedTransaction.parentCategoryName ||
                      selectedTransaction.categoryName ||
                      '-'}
                  </p>
                </div>

                {selectedTransaction.parentCategoryName && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('categories.subcategories')}
                    </label>
                    <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                      {selectedTransaction.categoryName || '-'}
                    </p>
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('editor.amount')}
              </label>
              {/*
                부호와 색은 목록 한 줄과 같은 규칙을 쓴다 (core 의 entryAmountLook).
                되돌린 결제는 갈래가 지출인데 돈이 돌아온 쪽이라, 갈래만 보면 "--10,000"
                이 찍힌다.
              */}
              {(() => {
                const look = entryAmountLook(selectedTransaction);
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
              {/* 결제 자리에서 깎인 금액. 위 금액은 이미 깎인 뒤라 이것이 없으면 정가를 알 수 없다. */}
              {selectedTransaction.discountAmount && (
                <p className="mt-1 text-xs text-green-600">
                  {t('entry.discount', {
                    amount: formatCurrency(selectedTransaction.discountAmount, displayCurrency),
                  })}
                </p>
              )}
              {/* 실적에서 뺀 카드 거래만 적는다. 센 것은 굳이 말할 것이 없다. */}
              {selectedTransaction.cardId && !selectedTransaction.countsPerformance && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('tx.detail.performance')} · {t('editor.performanceExcluded')}
                </p>
              )}
              {/* 차감을 실적에서 빼지 않은 거래. 기본과 다른 것만 적는다. */}
              {selectedTransaction.cardId &&
                selectedTransaction.countsPerformance &&
                selectedTransaction.discountAmount &&
                !selectedTransaction.discountCountsPerformance && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t('tx.detail.performance')} · {t('editor.discountPerformanceKept')}
                  </p>
                )}

            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('editor.description')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.description || '-'}
              </p>
            </div>

            {selectedTransaction.merchant && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('editor.merchantPlain')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.merchant}
                </p>
              </div>
            )}

            {selectedTransaction.detailedNote && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('editor.memoPlain')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.detailedNote}
                </p>
              </div>
            )}

            {selectedTransaction.toAccountName && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('editor.toAccount')}
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
                  {t('editor.transferFeePlain')}
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
                {t('editor.date')}
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
