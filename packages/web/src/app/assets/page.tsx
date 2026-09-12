'use client';

import { useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@money/core/lib/api-client';
import type { Account, Card, Category, Person } from '@money/core/lib/types';
import { formatCurrency, toAmountString, toNumber } from '@money/core/lib/money';
import { sumNetWorth, type NetWorthParts } from '@money/core/lib/net-worth';
import { accountDueOf } from '@money/core/lib/card-settlement';
import { useUserFilter } from '@money/core/store/user-filter';
import { formatDate, monthInputToIso } from '@money/core/lib/datetime';
import { type AccountDto, type ReportDto } from '@money/types';
import { ArrowLeft, Info, Receipt, X } from 'lucide-react';
import { EMPTY_SEARCH, type TransactionSearch } from '@money/core/hooks/useTransactions';
import { useDragReorder } from '@/hooks/useDragReorder';
import AddButton from '@/components/AddButton';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import {
  dayOfMonthHint,
  dayOfMonthOptions,
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@money/core/lib/day-of-month';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
/** 구성원 상세에 보여 줄 최근 거래 수. 더 보려면 가계 화면에서 사람 필터를 쓴다. */
const PERSON_ENTRY_LIMIT = 30;

const CARD_ADD_FORM_ID = 'card-add-form';

/**
 * 오른쪽 패널이 지금 보고 있는 항목 표시.
 *
 * 구성원·계좌·카드 세 목록이 같은 모양을 쓴다. 예전에는 계좌만 표시가 있어서,
 * 사용자나 카드를 누르면 오른쪽만 바뀌고 목록에서는 무엇을 눌렀는지 알 수 없었다.
 *
 * 테두리 두께를 바꾸는 대신 ring을 쓴다. border를 굵히면 그 줄만 1px 커져서
 * 누를 때마다 목록이 미세하게 움직인다.
 */
const SELECTED_MARK = 'ring-2 ring-blue-500';
import {
  useCanEdit,
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import PersonModal from '@/components/PersonModal';
import EditAccountModal from '@/components/EditAccountModal';
import EditCardModal from '@/components/EditCardModal';
import AddAccountModal from '@/components/AddAccountModal';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import AssetTypeSummary from '@/components/AssetTypeSummary';
import HiddenItemsPanel from '@/components/HiddenItemsPanel';
import AssetHistoryChart from '@/components/AssetHistoryChart';
import CardColorPicker from '@/components/CardColorPicker';
import TransactionListView from '@/components/TransactionListView';
import TransactionsView from '@/components/TransactionsView';
import type { EntryListItem } from '@/components/TransactionItem';
import CardPerformanceField from '@/components/CardPerformanceField';
import CardPerformancePanel from '@/components/CardPerformancePanel';
import CardSettlementPanel from '@/components/CardSettlementPanel';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import { useInstitutions } from '@money/core/hooks/useInstitutions';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { useTranslation } from '@money/core/lib/i18n';
import { apiErrorCode, useApiError } from '@money/core/lib/api-error';
import { useAccountLedger } from '@money/core/hooks/useAccountLedger';
import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';



/**
 * 투자·저축 계좌의 누적 수익.
 *
 * 이체로 넣은 돈은 원금이라 잔액만 보면 불었는지 알 수 없다. 그 계좌에 수입·지출로
 * 기록한 것(배당, 매매 차익, 이자, 수수료)의 합이 수익이다.
 *
 * 어느 유형에 수익이 있는지는 서버가 정한다(reports.service.ts의 PROFIT_TYPES).
 * 화면이 유형을 한 번 더 적어 두면 한쪽만 고쳤을 때 어긋나므로, 서버가 그 계좌를
 * 돌려줬는지만 본다.
 *
 * 아직 기록이 없으면 아무것도 그리지 않는다. 0원을 적어 두면 "계산이 안 됐다"와
 * "아직 수익이 없다"를 구별할 수 없다.
 */
function AccountProfitLine({
  account,
  profit,
}: {
  account: Account;
  profit: string | undefined;
}) {
  // 훅은 이른 반환보다 앞이어야 한다.
  const { t } = useTranslation();

  if (profit === undefined) return null;

  const value = toNumber(profit);
  if (value === 0) return null;

  return (
    <p
      className={`mt-1 text-sm font-semibold ${value > 0 ? 'text-green-600' : 'text-red-600'}`}
    >
      {/* 손실에 "수익 -"를 붙이면 두 번 읽어야 한다. 부호 대신 이름을 바꾼다. */}
      {value > 0 ? t('assets.profit') : t('assets.loss')}
      {formatCurrency(Math.abs(value), account.currency)}
    </p>
  );
}

/**
 * 카드 줄 오른쪽 끝의 남은 대금.
 *
 * 아직 정산하지 않은 것이 있을 때만 적는다. 0원을 적어 두면 다 갚은 카드가 밀린
 * 카드와 같은 무게로 보인다. 체크카드는 결제 즉시 통장에서 빠져 갚을 것이 남지 않는다.
 *
 * 음수는 카드사가 갚을 돈이다(사용을 취소했거나 대금을 더 가져간 뒤). 부호만 바꿔
 * 적으면 빚으로 읽히므로 이름과 색을 함께 바꾼다 -- 정산 판과 같은 규칙이다.
 */
function CardOutstanding({ card, currency }: { card: Card; currency: string }) {
  // 훅은 이른 반환보다 앞이어야 한다.
  const { t } = useTranslation();

  if (card.cardType !== 'credit') return null;

  const outstanding = toNumber(card.currentUsage);
  if (outstanding === 0) return null;

  const refundPending = outstanding < 0;

  return (
    <p
      className={`shrink-0 text-sm font-bold tabular-nums ${
        refundPending ? 'text-emerald-700' : 'text-red-600'
      }`}
    >
      {refundPending && (
        <span className="mr-1 text-xs font-medium">{t('settlement.refundPending')}</span>
      )}
      {formatCurrency(Math.abs(outstanding), currency)}
    </p>
  );
}

/** 계좌 유형 배지. 목록과 상세 머리글이 같은 모양을 쓴다. */
function AccountTypeBadge({ type }: { type: string }) {
  return (
    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
      {accountTypeLabel(type)}
    </span>
  );
}

/**
 * 상세 머리글의 아이콘 단추. 사용자·자산·카드 세 상세가 같은 것을 쓴다.
 *
 * 셋 다 아이콘이다. 글자 단추 둘 옆에 아이콘 하나만 서면 그것이 다른 종류의
 * 것으로 읽히고, 제목 옆에 글자가 넷(이름·금액·단추 둘) 늘어서 어느 것이 누를
 * 것인지도 흐려진다. 이름은 aria-label과 title로 남겨 둔다.
 *
 * 테두리와 바탕도 없앴다. 네모 셋이 이름 옆에 서면 그쪽이 무게를 가져가, 정작
 * 보러 온 금액과 추이보다 단추가 먼저 읽힌다.
 */
function DetailIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      /*
        테두리도 바탕도 없다. 아이콘만 놓는다.

        누를 수 있다는 표시는 색으로 한다 -- 바탕 없이 크기만 잡아 두면 h-10 w-10 은
        손가락이 닿는 자리로 남고 눈에는 아이콘 셋만 보인다.
      */
      className="flex h-10 w-10 shrink-0 items-center justify-center text-gray-600 transition-colors hover:text-gray-900"
    >
      {children}
    </button>
  );
}

/**
 * 원장 줄 목록. 통장 상세와 카드 상세가 함께 쓴다.
 *
 * 줄마다 그 거래 직후의 잔액이 붙는다. 카드에서는 그 잔액이 "남은 대금"이라, 쓴 줄을
 * 만나면 늘고 결제한 줄을 만나면 줄어드는 것이 그대로 보인다.
 *
 * **카드는 부호를 뒤집어 읽는다.** 사용과 결제는 카드의 부채 계정에 쌓이는데 그 계정은
 * 빚이 늘수록 음수다. 그대로 그리면 쓴 돈이 마이너스로, 갚은 돈이 플러스로 보인다.
 * 카드에서 알고 싶은 것은 "얼마를 썼고 얼마가 남았는가"이므로 사용을 +로 세운다.
 */
function LedgerList({
  rows,
  currency,
  kind,
  hasMore,
  isLoading,
  onMore,
}: {
  rows: AccountDto.LedgerRow[];
  /** 그 계좌의 통화. 기준통화 환산액이 아니라 원장에 적힌 그대로다. */
  currency: string;
  /** 'asset' 은 통장, 'liability' 는 카드의 부채 계정이다. */
  kind: 'asset' | 'liability';
  hasMore: boolean;
  isLoading: boolean;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const isCard = kind === 'liability';

  if (rows.length === 0) {
    return <p className="text-gray-600 text-center py-8">{t('assets.noEntries')}</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        // 원장 posting의 amount는 이미 부호를 갖는다 (자산 증가 +, 감소 -).
        // 부호를 그대로 두고 앞에 '-'를 또 붙이면 '--₩10,000'이 된다. 절댓값으로 찍는다.
        const amount = isCard ? -toNumber(row.amount) : toNumber(row.amount);
        const balance = isCard ? -toNumber(row.balanceAfter) : toNumber(row.balanceAfter);
        const isUp = amount > 0;
        /*
          색. 통장은 들어온 돈이 초록이고, 카드는 반대다 -- 쌓인 대금이 갚아야 할
          돈이라 빨강, 결제가 그것을 더는 일이라 초록이다.
        */
        const color = (isCard ? !isUp : isUp) ? 'text-green-600' : 'text-red-600';
        /*
          카드 이름은 통장에서만 뜻이 있다. 그 통장에서 무엇으로 결제했는지가 줄마다
          다르기 때문이다. 카드 상세에서는 모든 줄이 그 카드라 이름만 줄줄이 남는다.
        */
        const label = (isCard ? row.merchant : row.merchant || row.cardName) || '';

        return (
          <div
            key={row.postingId}
            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
          >
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900">{row.description || t('entry.noTitle')}</p>
                {label && <p className="text-sm text-gray-600 mt-1">{label}</p>}
                <p className="text-xs text-gray-500 mt-1">{formatDate(row.date, timeZone)}</p>
              </div>
              <div className="text-right whitespace-nowrap">
                {/*
                  원장의 금액과 잔액은 그 계좌의 통화다 (기준통화 환산액이 아니다).
                  통화를 넘기지 않으면 달러 통장의 $100이 ₩100으로 보인다.
                */}
                <p className={`font-bold text-lg ${color}`}>
                  {isUp ? '+' : '-'}
                  {formatCurrency(Math.abs(amount), currency)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t(isCard ? 'assets.cardBalanceAfter' : 'assets.balanceAfter', {
                    amount: formatCurrency(balance, currency),
                  })}
                </p>
              </div>
            </div>
          </div>
        );
      })}

      {hasMore && (
        <button
          type="button"
          onClick={onMore}
          disabled={isLoading}
          className="w-full py-3 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
        >
          {isLoading ? t('feed.loadingMore') : t('assets.more')}
        </button>
      )}
    </div>
  );
}

/**
 * 상세의 머리글. 구성원·계좌·카드 셋이 같은 것을 쓴다.
 *
 * 좁은 화면에서는 이 상세가 화면을 통째로 덮는다(목록은 접힌다). 그래서 보관함·거래
 * 상세와 같은 모양을 쓴다 -- **왼쪽 위의 ←** 로 목록에 돌아가고, 오른쪽 끝의
 * 닫기(×)는 내린다. 클릭해서 들어가는 자리가 화면마다 다른 모양이면 돌아가는 길을
 * 그때마다 찾아야 한다.
 *
 * 넓은 화면에서는 목록이 옆에 그대로 있어 "돌아갈 곳"이 없으므로 지금처럼 × 만 둔다.
 */
function AssetDetailHeader({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  /** 이 상세에서만 쓰는 단추 (거래 보기·기본 정보). 좁은 화면에서는 ← 와 한 줄에 선다. */
  actions: ReactNode;
  /** 이름 아래에 붙는 것 (금액, 기관 이름, 유형 표). */
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <>
      {/* 좁은 화면. 보관함·거래 상세와 같은 머리글 줄이다. */}
      <div className="mb-4 flex items-center gap-3 lg:hidden">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.back')}
          title={t('common.back')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-gray-900">{title}</h2>
        <div className="flex shrink-0 items-center">{actions}</div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* 이름. 좁은 화면에서는 위 머리글 줄이 갖는다. */}
          <h2 className="hidden text-2xl font-bold text-gray-900 lg:block">{title}</h2>
          {children}
        </div>
        <div className="hidden shrink-0 gap-2 lg:flex">
          {actions}
          <DetailIconButton label={t('common.close')} onClick={onClose}>
            <X className="h-5 w-5" aria-hidden />
          </DetailIconButton>
        </div>
      </div>
    </>
  );
}

/**
 * "현금성 · 투자 · 부채" 한 줄.
 *
 * 전체 총자산 상자와 구성원 패널이 같은 형식을 쓴다.
 *
 * 부채도 투자도 없으면 총자산이 곧 현금성이라 쪼갤 것이 없어 아무것도 그리지 않는다.
 */
function NetWorthBreakdown({
  parts,
  className,
}: {
  parts: NetWorthParts | undefined;
  className: string;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  if (!parts) return null;
  if (toNumber(parts.liability) === 0 && toNumber(parts.investment) === 0) return null;

  return (
    <p className={className}>
      {t('assets.parts', {
        cash: formatCurrency(parts.cash, displayCurrency),
        investment: formatCurrency(parts.investment, displayCurrency),
        liability: formatCurrency(parts.liability, displayCurrency),
      })}
    </p>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  /** 읽기 전용 구성원에게는 쓰기 단추를 그리지 않는다. */
  const canEdit = useCanEdit();
  const { messageOf } = useApiError();
  const router = useRouter();
  const { setPeople: setStorePeople, selectedPersonIds, togglePersonId, setPersonFilter } =
    useUserFilter();
  const { selectedProjectId } = useProject();
  const myPersonId = useMyPersonId();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [detailType, setDetailType] = useState<'person' | 'account' | 'card' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { options: issuerOptions } = useInstitutions('card_issuer');

  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [personModalMode, setPersonModalMode] = useState<'view' | 'edit'>('view');
  // 조회(상세정보)와 수정 폼은 서로 다른 모달이다. state를 공유하면 상세정보 버튼
  // 하나로 두 모달이 동시에 열려 "수정하기를 누르지도 않았는데 수정 화면이 나온다".
  const [isAccountDetailOpen, setIsAccountDetailOpen] = useState(false);
  /*
   * 상세정보 팝업.
   *
   * 구성원과 카드도 계좌와 같은 방식으로 다룬다. 고르면 오른쪽에 그래프와 내역이
   * 나오고, 기본 정보는 이 버튼으로 연다. 예전에는 고르는 즉시 팝업이 떠서
   * 그래프를 볼 자리가 없었다.
   */
  const [isPersonDetailOpen, setIsPersonDetailOpen] = useState(false);
  const [isCardDetailOpen, setIsCardDetailOpen] = useState(false);
  /** 고른 구성원의 최근 거래. 계좌 원장과 달리 전표 단위다. */
  const [personEntries, setPersonEntries] = useState<EntryListItem[]>([]);
  /**
   * 상세에서 "거래내역 보기"로 건너간 검색. null이면 자산 화면을 그린다.
   *
   * 고른 항목(detailType·selected*)은 그대로 두므로 ←로 돌아오면 떠나온 상세가 그
   * 자리에 서 있다. 분류·태그 화면처럼 다시 펼 표시를 따로 들 필요가 없다.
   */
  const [entriesSearch, setEntriesSearch] = useState<TransactionSearch | null>(null);
  /**
   * 사용자 상세에서 거래내역으로 건너가기 전의 자산주인 선택.
   *
   * 사용자의 거래는 검색 조건으로 걸지 않는다. "이 사람의 거래"는 **돈이 오간 계좌의
   * 주인**이 그 사람인 거래이고(상세의 최근 거래도 같은 기준이다), 그 조건을 가진
   * 것은 화면 위쪽의 자산주인 선택뿐이다. 검색 창의 사람 조건은 "거래를 낸 사람"이라
   * 남의 카드로 쓴 건에서 갈린다.
   *
   * 전역 선택을 건드리는 값이므로 떠나기 전 상태를 들고 있다가 돌아올 때 되돌린다.
   */
  const personScope = useRef<{
    selectedPersonIds: string[];
    personFilterTouched: boolean;
  } | null>(null);
  const [isEditAccountModalOpen, setIsEditAccountModalOpen] = useState(false);
  const [isEditCardModalOpen, setIsEditCardModalOpen] = useState(false);

  /** 카드 추가 팝업을 띄울지. 다른 추가는 저마다 팝업 상태를 따로 갖는다. */
  const [addType, setAddType] = useState<'card' | null>(null);
  /**
   * 계좌 추가 폼의 통장 주인을 미리 채울 사람.
   *
   * 목록에서 그 사람의 "계좌 추가"를 눌러 들어오면 그 사람이고, 구성원 상세에서
   * 들어와도 마찬가지다. 폼에서 바꿀 수 있다.
   */
  const [addedForPersonId, setAddedForPersonId] = useState<string | null>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isPersonAddModalOpen, setIsPersonAddModalOpen] = useState(false);
  const [cardForm, setCardForm] = useState({
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
  const [addError, setAddError] = useState('');

  const [accountTransactions, setAccountTransactions] = useState<AccountDto.LedgerRow[]>([]);
  /** 원장의 다음 페이지 커서. null이면 끝까지 봤다는 뜻이다. */
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);
  const [netWorth, setNetWorth] = useState<ReportDto.NetWorth | null>(null);
  /** 투자·저축 계좌별 누적 수익. 계좌 id -> 금액 (계좌 통화) */
  const [accountProfit, setAccountProfit] = useState<Map<string, string>>(new Map());
  /*
   * 남이 고친 것도 이 화면에 들어와야 한다.
   *
   * 아래 counter 들은 이 화면이 제 손으로 고쳤을 때만 오른다. 그것만 보면 다른 기기에서
   * 만든 통장·카드·거래가 이 화면에는 영영 나타나지 않는다.
   */
  const mirrorVersion = useMirrorVersion();
  /**
   * 어느 프로젝트를 이미 그렸는가.
   *
   * 신호가 올 때마다 다시 받는데, 그때마다 로딩 화면을 씌우면 보고 있던 목록이 계속
   * 깜빡인다. 처음 여는 순간에만 씌운다.
   */
  const loadedProjectRef = useRef<string | null>(null);
  /** 항목을 숨기거나 되돌리면 올린다. 숨긴 항목 패널이 이 값을 보고 다시 읽는다. */
  const [hiddenVersion, setHiddenVersion] = useState(0);
  /** 거래를 고치거나 지우면 올린다. 구성원 거래와 계좌 원장이 이 값을 보고 다시 읽는다. */
  const [entryVersion, setEntryVersion] = useState(0);
  /** 거래 상세·추가 팝업. 가계 화면과 같은 컴포넌트를 쓴다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);

  /**
   * 총자산과 사람별 소계, 그리고 계좌 수익.
   *
   * 계좌 잔액이나 카드 부채가 바뀌면 이 값도 함께 다시 받아야 한다. 목록만
   * 갱신하면 왼쪽의 총자산이 옛 값으로 남아, 새로고침해야 맞는 숫자가 나온다.
   * 계좌 수익도 같은 거래에서 나오는 값이라 한 함수에서 함께 받는다.
   */
  const loadNetWorth = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const [netWorthData, profitData] = await Promise.all([
        apiClient.getNetWorth(selectedProjectId),
        apiClient.getAccountProfit(selectedProjectId),
      ]);
      setNetWorth(netWorthData ?? null);
      setAccountProfit(new Map((profitData ?? []).map((row) => [row.accountId, row.profit])));
    } catch (err) {
      console.error('총자산 조회 실패:', err);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    const loadData = async () => {
      try {
        if (loadedProjectRef.current !== selectedProjectId) setIsLoading(true);
        const [accountsData, peopleData, cardsData, categoriesData, netWorthData, profitData] =
          await Promise.all([
            apiClient.getAccountsV2(selectedProjectId),
            apiClient.getPeople(selectedProjectId),
            apiClient.getCards(selectedProjectId),
            apiClient.getCategories(selectedProjectId),
            apiClient.getNetWorth(selectedProjectId),
            apiClient.getAccountProfit(selectedProjectId),
          ]);
        setAccounts(accountsData || []);
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setCategories(categoriesData || []);
        setNetWorth(netWorthData ?? null);
        setAccountProfit(new Map((profitData ?? []).map((row) => [row.accountId, row.profit])));
      } catch (err) {
        setError(t('home.loadFailed'));
      } finally {
        loadedProjectRef.current = selectedProjectId;
        setIsLoading(false);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, mirrorVersion]);

  usePersonFilterSync(selectedProjectId, people);

  /*
   * 자산주인에서 빠진 항목은 오른쪽 패널에서도 내린다.
   *
   * 왼쪽 목록에 없는 계좌의 내역이 오른쪽에 남아 있으면 어디서 온 것인지 알 수 없고,
   * 위의 총자산에도 들어가지 않아 화면 안에서 숫자가 어긋난다.
   *
   * 주인을 알 수 없는 경우(주인 없는 계좌, 계좌 목록을 아직 못 받은 경우)는 그대로 둔다.
   * 걸러낼 근거가 없는데 닫으면 열자마자 닫히는 것처럼 보인다.
   */
  useEffect(() => {
    if (!detailType) return;

    const ownerId =
      detailType === 'person'
        ? selectedPerson?.id ?? null
        : detailType === 'account'
          ? selectedAccount?.ownerId ?? null
          : accounts.find((account) => account.id === selectedCard?.paymentAccountId)?.ownerId ??
            null;

    if (!ownerId || selectedPersonIds.includes(ownerId)) return;
    setDetailType(null);
  }, [detailType, selectedPersonIds, accounts, selectedPerson, selectedAccount, selectedCard]);

  /**
   * 한 사람의 거래내역으로 건너간다.
   *
   * 자산주인 선택을 그 사람만으로 좁힌다. 거래 화면은 이 선택으로 목록·합계를
   * 만들므로, 그렇게 해야 상세에 있던 최근 거래와 같은 기준이 된다.
   */
  const showPersonEntries = (personId: string) => {
    const state = useUserFilter.getState();
    personScope.current = {
      selectedPersonIds: state.selectedPersonIds,
      personFilterTouched: state.personFilterTouched,
    };
    // 건드림 표시를 함께 켠다. 켜지 않으면 거래 화면의 usePersonFilterSync 가 이
    // 선택을 "한 번도 고르지 않은 상태"로 보고 전체 선택으로 되돌린다.
    setPersonFilter([personId], true);
    setEntriesSearch(EMPTY_SEARCH);
  };

  /**
   * 거래내역을 접고 떠나온 상세로 돌아간다.
   *
   * 좁혀 두었던 자산주인 선택을 떠나기 전 그대로 되돌린다. 거래 화면에서 사람을
   * 바꿔 봤더라도 되돌린다 -- 이 화면은 거래 탭이 아니라 자산 상세에서 한 걸음
   * 들어온 자리다. 그 걸음이 화면 전체의 자산주인 설정을 바꿔 놓고 끝나면, 돌아온
   * 자산 목록이 들어가기 전과 달라져 있다.
   */
  const closeEntries = () => {
    setEntriesSearch(null);

    const before = personScope.current;
    personScope.current = null;
    if (before) setPersonFilter(before.selectedPersonIds, before.personFilterTouched);
  };

  /**
   * 상세를 접는다.
   *
   * 좁은 화면의 ←, 넓은 화면의 ×, 그리고 브라우저의 뒤로가기가 함께 쓴다. 세 곳이
   * 각자 지우면 어느 하나가 빠져 목록에 없는 항목의 상세가 남는다.
   */
  const closeDetail = () => {
    setDetailType(null);
    setSelectedPerson(null);
    setSelectedAccount(null);
    setSelectedCard(null);
  };

  /*
   * 브라우저(그리고 휴대폰)의 뒤로가기는 머리글의 ← 를 누른 것과 같게 동작한다.
   *
   * 한 걸음 들어간 자리가 둘이다 -- 상세를 펴고, 거기서 거래내역까지 들어갈 수 있다.
   * 나중에 연 것이 먼저 닫힌다(useCloseOnBack 이 쌓인 차례대로 닫는다).
   */
  useCloseOnBack(detailType !== null, closeDetail);
  useCloseOnBack(entriesSearch !== null, closeEntries);

  /**
   * 거래를 저장하거나 지운 뒤.
   *
   * 목록(구성원 거래, 계좌 원장)은 entryVersion을 보고 각자 다시 읽는다. 잔액과
   * 총자산은 여기서 받는다. 고른 계좌·카드는 목록에서 다시 집어 온다 — 상세 패널이
   * 들고 있는 것은 렌더 시점의 사본이라 그대로 두면 옛 잔액이 남는다.
   */
  const handleEntryChange = useCallback(async () => {
    setEntryVersion((version) => version + 1);
    if (!selectedProjectId) return;

    const [accountsData, cardsData] = await Promise.all([
      apiClient.getAccountsV2(selectedProjectId),
      apiClient.getCards(selectedProjectId),
    ]);
    setAccounts(accountsData || []);
    setCards(cardsData || []);
    setSelectedAccount((prev) => (prev ? accountsData?.find((a) => a.id === prev.id) ?? prev : prev));
    setSelectedCard((prev) => (prev ? cardsData?.find((c) => c.id === prev.id) ?? prev : prev));
    await loadNetWorth();
  }, [selectedProjectId, loadNetWorth]);

  /** 거래 팝업 안에서 계좌·카드·분류·사람을 새로 만들었을 때. */
  const handleReferenceDataChange = useCallback((patch: ReferenceDataPatch) => {
    if (patch.accounts) setAccounts(patch.accounts);
    if (patch.cards) setCards(patch.cards);
    if (patch.categories) setCategories(patch.categories);
    if (patch.people) setPeople(patch.people);
  }, []);

  /**
   * 계좌 원장 조회.
   *
   * 예전에는 거래 목록에서 accountId/toAccountId를 조합하고 credit_usage를 빼야 했다.
   * 원장 구조에서는 이 계좌의 posting만 시간순으로 오고 잔액 추이까지 함께 온다.
   */
  const LEDGER_PAGE_SIZE = 100;

  const loadAccountTransactions = useCallback(async (accountId: string) => {
    try {
      setIsLoadingLedger(true);
      const response = await apiClient.getAccountPostings(accountId, { limit: LEDGER_PAGE_SIZE });
      setAccountTransactions(response?.data ?? []);
      setLedgerCursor(response?.nextCursor ?? null);
    } catch (err) {
      console.error('거래 내역 조회 실패:', err);
      setAccountTransactions([]);
      setLedgerCursor(null);
    } finally {
      setIsLoadingLedger(false);
    }
  }, []);

  /**
   * 원장 다음 페이지.
   *
   * 예전에는 100건만 받고 커서를 버려서, 그보다 오래된 거래를 볼 방법이 없었다.
   * 서버는 페이지마다 그 구간의 잔액 추이를 맞춰서 준다.
   */
  const loadMoreAccountTransactions = useCallback(async () => {
    if (!selectedAccount || !ledgerCursor) return;
    try {
      setIsLoadingLedger(true);
      const response = await apiClient.getAccountPostings(selectedAccount.id, {
        limit: LEDGER_PAGE_SIZE,
        cursor: ledgerCursor,
      });
      setAccountTransactions((prev) => [...prev, ...(response?.data ?? [])]);
      setLedgerCursor(response?.nextCursor ?? null);
    } catch (err) {
      console.error('거래 내역 조회 실패:', err);
    } finally {
      setIsLoadingLedger(false);
    }
  }, [selectedAccount, ledgerCursor]);

  /** 카드 선택 시 미결제 청구서 조회. 가장 오래된 것부터 갚는다. */
  /**
   * 구성원의 최근 거래.
   *
   * 계좌 원장(posting)과 달리 전표 단위로 본다. 한 사람이 여러 계좌를 쓰므로
   * 계좌별 잔액 흐름보다 "이 사람이 무엇을 썼는가"가 알고 싶은 것이다.
   */
  useEffect(() => {
    if (!selectedPerson || detailType !== 'person') {
      setPersonEntries([]);
      return;
    }

    let cancelled = false;
    apiClient
      .getEntries({ personId: selectedPerson.id, limit: PERSON_ENTRY_LIMIT }, selectedProjectId)
      .then((res) => {
        if (!cancelled) setPersonEntries((res?.data ?? []) as EntryListItem[]);
      })
      .catch((err) => {
        console.error('구성원 거래 조회 실패:', err);
        if (!cancelled) setPersonEntries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPerson, detailType, selectedProjectId, entryVersion, mirrorVersion]);

  // 계좌 선택 시 거래 내역 로드
  useEffect(() => {
    if (selectedAccount && detailType === 'account') {
      loadAccountTransactions(selectedAccount.id);
    } else {
      setAccountTransactions([]);
      setLedgerCursor(null);
    }
  }, [selectedAccount, detailType, loadAccountTransactions, entryVersion, mirrorVersion]);

  /*
   * 카드의 사용·결제 내역.
   *
   * 카드의 부채 계정 원장이다. 통장 상세가 보는 것과 같은 줄이라 받아 오는 자리도
   * 같다(core 의 useAccountLedger). 체크카드는 그 계정이 없어 비어 있다.
   */
  const cardLedger = useAccountLedger(
    detailType === 'card' ? selectedCard?.liabilityAccountId ?? null : null,
    entryVersion + mirrorVersion,
  );

  const getAccountCards = (accountId: string) =>
    cards.filter((c) => c.paymentAccountId === accountId);

  /**
   * 카드 금액의 통화. 사용액·한도·남은 대금은 전부 결제 통장의 통화다.
   * 기준통화 환산액이 아니라서 원으로 찍으면 달러 카드가 1/1380로 보인다.
   */
  const currencyOfCard = (card: { paymentAccountId?: string } | null): string =>
    accounts.find((a) => a.id === card?.paymentAccountId)?.currency ?? 'KRW';

  /**
   * 없애기. **삭제를 먼저 시도하고, 거절당하면 숨기기를 묻는다.**
   *
   * 조용히 숨기면 지운 줄 알고, 아무 말 없이 실패하면 눌러도 안 되는 것으로 보인다.
   * 그래서 거래내역이 남아 있다는 이유를 그대로 보여 주고, 그 자리에서 숨기기로 이어
   * 갈지 묻는다. 사용자가 그만두면 false 를 돌려준다 (목록을 건드리지 않는다).
   */
  const HIDE_INSTEAD_CODES = [
    'PERSON_HAS_ENTRIES',
    'PERSON_HAS_RECORDS',
    'ACCOUNT_HAS_ENTRIES',
    'ACCOUNT_HAS_RECORDS',
    'CARD_HAS_ENTRIES',
    'CARD_HAS_RECORDS',
  ];

  const deleteOrAskToHide = async (
    remove: () => Promise<void>,
    hide: () => Promise<void>,
  ): Promise<boolean> => {
    try {
      await remove();
      return true;
    } catch (err) {
      if (!HIDE_INSTEAD_CODES.includes(apiErrorCode(err) ?? '')) throw err;
      const reason = messageOf(err, 'assets.removeFailed');
      if (!window.confirm(`${reason}\n\n${t('assets.hideInstead')}`)) return false;
      await hide();
      return true;
    }
  };

  const handleDeletePerson = async () => {
    if (!selectedPerson || !window.confirm(t('assets.deleteConfirm'))) return;
    try {
      setIsSubmitting(true);
      const done = await deleteOrAskToHide(
        () => apiClient.deletePerson(selectedPerson.id),
        () => apiClient.deletePerson(selectedPerson.id, { hide: true }),
      );
      if (!done) return;
      const peopleData = await apiClient.getPeople(selectedProjectId);
      setPeople(peopleData || []);
      setIsPersonDetailOpen(false);
      setDetailType(null);
      setSelectedPerson(null);
      setHiddenVersion((v) => v + 1);
      await loadNetWorth();
    } catch (err: any) {
      alert(messageOf(err, 'assets.removeFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedAccount || !window.confirm(t('assets.deleteConfirm'))) return;
    try {
      setIsSubmitting(true);
      const done = await deleteOrAskToHide(
        () => apiClient.deleteAccountV2(selectedAccount.id),
        () => apiClient.deleteAccountV2(selectedAccount.id, { hide: true }),
      );
      if (!done) return;
      const accountsData = await apiClient.getAccountsV2(selectedProjectId);
      setAccounts(accountsData || []);
      setIsAccountDetailOpen(false);
      setDetailType(null);
      setSelectedAccount(null);
      setHiddenVersion((v) => v + 1);
      await loadNetWorth();
    } catch (err: any) {
      alert(messageOf(err, 'assets.removeFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCard = async () => {
    if (!selectedCard || !window.confirm(t('assets.deleteConfirm'))) return;
    try {
      setIsSubmitting(true);
      const done = await deleteOrAskToHide(
        () => apiClient.deleteCard(selectedCard.id),
        () => apiClient.deleteCard(selectedCard.id, { hide: true }),
      );
      if (!done) return;
      const cardsData = await apiClient.getCards(selectedProjectId);
      setCards(cardsData || []);
      setIsCardDetailOpen(false);
      setDetailType(null);
      setSelectedCard(null);
      setHiddenVersion((v) => v + 1);
      await loadNetWorth();
    } catch (err: any) {
      alert(messageOf(err, 'assets.removeFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 카드 쪽 숫자가 바뀐 뒤의 새로고침.
   *
   * 카드 목록의 사용액과 총자산은 같은 부채 잔액에서 나온다. 한쪽만 다시 읽으면
   * 같은 화면에 두 숫자가 서로 다르게 남는다.
   *
   * 남은 대금은 CardSettlementPanel이 스스로 다시 읽는다.
   */
  const refreshAfterCardChange = useCallback(async () => {
    if (!selectedProjectId) return;
    setCards((await apiClient.getCards(selectedProjectId)) || []);
    // 카드 부채는 총자산에서 빠지는 값이라 함께 다시 받는다.
    await loadNetWorth();
    // 대금을 기록하면 거래가 하나 생긴다. 그 줄을 보는 목록들도 다시 읽어야 한다.
    setEntryVersion((version) => version + 1);
  }, [loadNetWorth, selectedProjectId]);

  /*
   * 추가는 목록 안에서 시작한다.
   *
   * 예전에는 머리글의 "추가하기" 하나로 들어가 무엇을 만들지 고르고, 그다음에 주인이나
   * 결제 통장을 다시 골랐다. 만들 자리를 화면에서 이미 누르고 들어왔는데 그것을 폼에서
   * 또 고르는 셈이었다. 지금은 그 자리의 버튼이 주인·통장을 채운 채로 연다.
   */
  const openPersonAdd = () => setIsPersonAddModalOpen(true);

  const openAccountAdd = (personId: string) => {
    setAddedForPersonId(personId);
    setIsAccountModalOpen(true);
  };

  const openCardAdd = (accountId: string) => {
    setCardForm((prev) => ({ ...prev, accountId }));
    setAddType('card');
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setAddError('');

      // 카드사는 필수다. CustomSelect는 <input required>와 달리 브라우저 검증이 없어
      // 비워 두면 서버에서 "기관을 찾을 수 없습니다"가 돌아와 원인을 알기 어렵다.
      if (!cardForm.issuerId) {
        setAddError(t('card.issuerRequired'));
        setIsSubmitting(false);
        return;
      }

      // 만료일은 월까지만 받는다. 저장은 그 달 말일로 한다.
      const isoDate = monthInputToIso(cardForm.expiryDate) ?? undefined;
      await apiClient.createCard({
        paymentAccountId: cardForm.accountId,
        name: cardForm.name,
        cardNumber: cardForm.cardNumber || undefined,
        cardType: cardForm.cardType,
        issuerId: cardForm.issuerId,
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit:
          cardForm.cardType === 'credit' ? toAmountString(cardForm.creditLimit) : undefined,
        // 실적은 카드 종류를 가리지 않는다. 비워 두면 조건 없음이라 빈 문자열로 보낸다.
        performanceAmount: cardForm.performanceAmount
          ? toAmountString(cardForm.performanceAmount)
          : '',
        // 비워 두면 보내지 않는다. 서버는 null로 두고 화면이 종류별 기본색을 쓴다.
        color: cardForm.color || undefined,
        statementClosingDay:
          cardForm.cardType === 'credit' ? cardForm.statementClosingDay : undefined,
        paymentDueDay: cardForm.cardType === 'credit' ? cardForm.paymentDueDay : undefined,
      });
      const cardsData = await apiClient.getCards(selectedProjectId);
      setCards(cardsData || []);
      await loadNetWorth();
      setCardForm({
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
      setAddType(null);
    } catch (err: any) {
      setAddError(messageOf(err, 'card.addFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  /** 조회 팝업을 닫고 수정 폼을 연다. 둘이 겹쳐 열리지 않게 순서를 지킨다. */
  const handleEditPersonClick = () => {
    setIsPersonDetailOpen(false);
    setPersonModalMode('edit');
    setPersonModalOpen(true);
  };

  /** 드래그로 바꾼 구성원 순서 저장 */
  const handleReorderPeople = async (ids: string[]) => {
    try {
      const updated = await apiClient.reorderPeople(ids, selectedProjectId);
      setPeople((updated || []) as Person[]);
      setStorePeople((updated || []) as Person[]);
    } catch (err: any) {
      setError(messageOf(err, 'assets.orderSaveFailed'));
    }
  };

  /**
   * 드래그로 바꾼 계좌 순서 저장.
   *
   * sortOrder는 프로젝트 단위지만 화면은 구성원별로 묶어 보여준다.
   * 한 묶음 안의 순서만 다시 매기므로 묶음끼리는 서로 영향을 주지 않는다.
   */
  const handleReorderAccounts = async (ids: string[]) => {
    try {
      const updated = await apiClient.reorderAccounts(ids, selectedProjectId);
      setAccounts((updated || []) as Account[]);
    } catch (err: any) {
      setError(messageOf(err, 'assets.orderSaveFailed'));
    }
  };

  /** 드래그로 바꾼 카드 순서 저장. 계좌와 같은 규칙(묶음 안에서만 다시 매긴다). */
  const handleReorderCards = async (ids: string[]) => {
    try {
      const updated = await apiClient.reorderCards(ids, selectedProjectId);
      setCards((updated || []) as Card[]);
    } catch (err: any) {
      setError(messageOf(err, 'assets.orderSaveFailed'));
    }
  };

  /** 조회 모달을 닫고 수정 폼을 연다. 둘이 겹쳐 열리지 않게 순서를 지킨다. */
  const handleEditAccountClick = () => {
    setIsAccountDetailOpen(false);
    setIsEditAccountModalOpen(true);
  };

  /** 조회 팝업을 닫고 수정 폼을 연다. 둘이 겹쳐 열리지 않게 순서를 지킨다. */
  const handleEditCardClick = () => {
    setIsCardDetailOpen(false);
    setIsEditCardModalOpen(true);
  };

  // 총자산과 사람별 소계는 서버가 계산한다 (/reports/net-worth).
  // 투자성 계좌는 최신 시가로 환산되고, 카드 부채가 차감되며, 자본 계정은 제외된다.
  // 계좌 잔액만 더하던 예전 계산으로는 이 셋 중 아무것도 반영되지 않았다.
  /** 오른쪽 패널이 지금 보고 있는 항목의 id */
  const selectedIdOfDetail =
    detailType === 'person'
      ? selectedPerson?.id
      : detailType === 'account'
        ? selectedAccount?.id
        : detailType === 'card'
          ? selectedCard?.id
          : undefined;

  type PersonNetWorth = ReportDto.NetWorth['byPerson'][number];
  const netWorthByPerson = new Map<string, PersonNetWorth>(
    (netWorth?.byPerson ?? []).map((row) => [row.personId, row]),
  );

  // 계좌가 없는 구성원도 표시한다. 제목에서 고른 자산주인만 남는다.
  const displayPeople = people.filter((person) => selectedPersonIds.includes(person.id));

  /*
   * 전원을 고른 상태인지.
   *
   * 총자산과 추이 그래프는 이때만 서버의 전체 기준 값을 그대로 쓴다. 주인이 없는
   * 계좌는 사람별 소계에 들어가지 않으므로, 전체를 보고 있는데 소계를 더해 쓰면
   * 그만큼 금액이 빠진다. 목록 필터(personIds)가 전체일 때 조건을 빼는 것과 같은 규칙이다.
   */
  const allPeopleSelected = people.length > 0 && selectedPersonIds.length === people.length;
  const scopedNetWorth = allPeopleSelected
    ? netWorth
    : sumNetWorth(selectedPersonIds.map((id) => netWorthByPerson.get(id)));

  /*
   * 거래내역을 펼쳐 둔 동안에는 그것만 그린다 (분류·태그 화면과 같은 규칙).
   *
   * 자산 목록을 아래에 남겨 두면 한 화면에 목록 둘이 서서 어느 것을 보고 있는지가
   * 흐려진다. 거래 화면이 제 머리글을 그대로 들고 오므로 돌아가는 길인 ←만 얹는다.
   */
  if (entriesSearch) {
    return (
      <TransactionsView
        projectId={selectedProjectId}
        search={entriesSearch}
        onBack={closeEntries}
      />
    );
  }

  /*
   * 좁은 화면에서 상세를 펼쳐 두었을 때 접는 자리.
   *
   * 넓은 화면은 목록과 상세가 나란하다. 좁은 화면에서는 둘이 위아래로 쌓여 상세가
   * 목록 한참 아래에 서고, 그래프를 보려면 그만큼 훑어 내려야 한다. 그래서 고른
   * 항목의 상세가 화면을 통째로 쓰고 나머지는 접는다 (앱과 같은 규칙이다).
   *
   * 닫으면 접었던 것이 그대로 돌아온다. 좁은 화면에서는 상세 머리글의 ← 가, 넓은
   * 화면에서는 닫기(×)가 그 일을 한다 (`AssetDetailHeader`).
   */
  const hideOnNarrow = detailType ? 'hidden lg:block' : '';

  return (
    /*
      좁은 화면에서 상세를 펼치면 위의 칸들이 접힌다(hideOnNarrow). 접힌 칸도 줄
      간격의 대상이라 상세만 남아도 위에 한 칸이 비는데, 그러면 보관함처럼 화면 맨
      위에서 시작하지 않는다. 그때는 간격을 넓은 화면에만 둔다 -- 좁은 화면에 남는
      칸은 상세 하나뿐이라 벌릴 사이가 없다.
    */
    <div className={detailType ? 'space-y-0 lg:space-y-6' : 'space-y-6'}>
      {/*
        화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을, 유형 카드를 누르면
        무엇을 더한 금액인지 고른다. 홈에 있던 칸을 그대로 옮겨 왔다. 자산 금액은
        자산 화면에서 보는 것이 제자리고, 홈에서는 이 달의 흐름만 본다.
      */}
      <div className={hideOnNarrow}>
        <AssetTypeSummary
          byType={scopedNetWorth?.byType}
          hasNoScope={people.length > 0 && selectedPersonIds.length === 0}
          scopeTitle={
            <PersonScopeTitle
              noun={t('home.assetsNoun')}
              people={people}
              myPersonId={myPersonId}
              selectedPersonIds={selectedPersonIds}
              onTogglePerson={togglePersonId}
            />
          }
        />
      </div>

      {/*
        전체 추이는 계좌를 골라도 그대로 둔다. 고른 계좌는 아래 오른쪽에 펼친다.
        고른 자산주인만 그린다. 전원이면 ownerIds를 빼서 주인 없는 계좌까지 담는다.
      */}
      <div className={hideOnNarrow}>
        <AssetHistoryChart
          projectId={selectedProjectId}
          ownerIds={allPeopleSelected ? undefined : selectedPersonIds}
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-gray-600">{t('common.loading')}</p>
      ) : displayPeople.length === 0 ? (
        <p className="text-gray-600">{t('assets.noSelection')}</p>
      ) : (
        /*
          왼쪽은 항상 구성원·계좌·카드 목록, 오른쪽은 고른 계좌의 내역이다.
          예전에는 계좌를 누르면 목록이 사라지고 화면이 통째로 바뀌어서, 다른 계좌로
          옮기려면 매번 닫아야 했다.
        */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* 왼쪽: 구성원별 목록. 드래그로 순서를 바꿀 수 있다. */}
          <div className={hideOnNarrow}>
          <PersonAssetList
            people={displayPeople}
            accounts={accounts}
            cardsOf={getAccountCards}
            netWorthByPerson={netWorthByPerson}
            accountProfit={accountProfit}
            /*
              지금 펼쳐 둔 항목. detailType과 함께 넘겨야 한다. 고른 계좌·카드·구성원은
              닫아도 state에 남으므로 id만 보면 오른쪽에 없는 항목까지 강조된다.
            */
            selected={
              detailType && selectedIdOfDetail ? { type: detailType, id: selectedIdOfDetail } : null
            }
            onPersonClick={(person) => {
              setSelectedPerson(person);
              setDetailType('person');
            }}
            onAccountClick={(account) => {
              setSelectedAccount(account);
              setDetailType('account');
            }}
            onCardClick={(card) => {
              setSelectedCard(card);
              setDetailType('card');
            }}
            onReorderPeople={handleReorderPeople}
            onReorderAccounts={handleReorderAccounts}
            onReorderCards={handleReorderCards}
            onAddPerson={openPersonAdd}
            onAddAccount={openAccountAdd}
            onAddCard={openCardAdd}
          />
          </div>

          {/* 오른쪽: 고른 계좌의 잔액 추이와 거래 내역 */}
          {detailType === 'account' && selectedAccount ? (
            /*
              좁은 화면에서는 상세가 화면을 통째로 쓰므로 감싸는 상자를 두지 않는다
              (보관함과 같은 모양이다). 그래프가 제 상자를 갖고 있어 두 겹이 되기도 한다.
              넓은 화면에서는 목록 옆에 놓이는 칸이라 상자가 그 경계를 그린다.
            */
            <div className="lg:rounded-lg lg:bg-white lg:p-6 lg:shadow">
              {/* 헤더: 계좌명 및 버튼 */}
              <div className="mb-6">
                <AssetDetailHeader
                  title={selectedAccount.name}
                  onClose={closeDetail}
                  actions={
                    <>
                      <DetailIconButton
                        label={t('assets.viewEntries')}
                        onClick={() =>
                          setEntriesSearch({
                            ...EMPTY_SEARCH,
                            paymentAccountIds: [selectedAccount.id],
                          })
                        }
                      >
                        <Receipt className="h-5 w-5" aria-hidden />
                      </DetailIconButton>
                      <DetailIconButton
                        label={t('account.detail')}
                        onClick={() => setIsAccountDetailOpen(true)}
                      >
                        <Info className="h-5 w-5" aria-hidden />
                      </DetailIconButton>
                    </>
                  }
                >
                  {/* 예전에는 상단 총자산 박스가 이 값을 보여줬다. 총자산을 그대로 두는 대신 여기에 적는다. */}
                  <p className="text-xl font-bold text-blue-600 mt-1">
                    {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {selectedAccount.institution?.name && (
                      <p className="text-sm text-gray-600">{selectedAccount.institution.name}</p>
                    )}
                    <AccountTypeBadge type={selectedAccount.type} />
                  </div>
                </AssetDetailHeader>
              </div>

              {/* 이 계좌의 잔액 추이 */}
              <AssetHistoryChart accountId={selectedAccount.id} projectId={selectedProjectId} />
              {/*
                추이는 기준통화 장부가다. 위 잔액(계좌 통화)과 단위가 다르므로 밝혀 둔다.
                거래마다 그때의 환율로 쌓인 값이라 최신 환율로 다시 환산한 값과도 다르다.
              */}
              {selectedAccount.currency !== displayCurrency && (
                <p className="-mt-2 text-xs text-gray-500">
                  {t('assets.trendNote', {
                    display: displayCurrency,
                    account: selectedAccount.currency,
                  })}
                </p>
              )}

              {/* 거래 내역 */}
              <LedgerList
                rows={accountTransactions}
                currency={selectedAccount.currency}
                kind="asset"
                hasMore={Boolean(ledgerCursor)}
                isLoading={isLoadingLedger}
                onMore={loadMoreAccountTransactions}
              />
            </div>
          ) : detailType === 'person' && selectedPerson ? (
            /* 구성원: 그 사람 계좌들의 합계 추이와 최근 거래 */
            <div className="space-y-4 lg:rounded-lg lg:bg-white lg:p-6 lg:shadow">
              <AssetDetailHeader
                title={selectedPerson.name}
                onClose={closeDetail}
                actions={
                  <>
                    <DetailIconButton
                      label={t('assets.viewEntries')}
                      onClick={() => showPersonEntries(selectedPerson.id)}
                    >
                      <Receipt className="h-5 w-5" aria-hidden />
                    </DetailIconButton>
                    <DetailIconButton
                      label={t('assets.detail')}
                      onClick={() => setIsPersonDetailOpen(true)}
                    >
                      <Info className="h-5 w-5" aria-hidden />
                    </DetailIconButton>
                  </>
                }
              >
                <p className="text-xl font-bold text-blue-600 mt-1">
                  {formatCurrency(netWorthByPerson.get(selectedPerson.id)?.total ?? 0, displayCurrency)}
                </p>
                {/* 전체 총자산 상자와 같은 형식으로 무엇이 얼마인지 쪼개 보여 준다 */}
                <NetWorthBreakdown
                  parts={netWorthByPerson.get(selectedPerson.id)}
                  className="text-sm text-gray-600 mt-1"
                />
              </AssetDetailHeader>

              {/* 이 사람이 가진 계좌들의 합계 추이 */}
              <AssetHistoryChart ownerId={selectedPerson.id} projectId={selectedProjectId} />

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">{t('assets.recentEntries')}</h3>
                {personEntries.length === 0 ? (
                  <p className="text-gray-600 text-center py-8">{t('assets.noEntries')}</p>
                ) : (
                  <>
                    <TransactionListView
                      entries={personEntries}
                      onEntryClick={(entry) => entryEditorRef.current?.openDetail(entry)}
                    />
                    {personEntries.length >= PERSON_ENTRY_LIMIT && (
                      <p className="mt-2 text-xs text-gray-500">
                        {t('assets.personEntriesNote', { count: PERSON_ENTRY_LIMIT })}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : detailType === 'card' && selectedCard ? (
            /*
              카드: 대금과 청구 주기.
              카드 번호나 유효기간 같은 기본 정보는 "카드 상세정보" 팝업으로 옮겼다.
              이 자리에서 자주 보는 것은 남은 대금과 이번 주기 사용액이다.
            */
            <div className="space-y-4 lg:rounded-lg lg:bg-white lg:p-6 lg:shadow">
              <AssetDetailHeader
                title={selectedCard.name}
                onClose={closeDetail}
                actions={
                  <>
                    <DetailIconButton
                      label={t('assets.viewEntries')}
                      onClick={() =>
                        setEntriesSearch({ ...EMPTY_SEARCH, paymentCardIds: [selectedCard.id] })
                      }
                    >
                      <Receipt className="h-5 w-5" aria-hidden />
                    </DetailIconButton>
                    <DetailIconButton
                      label={t('card.detail')}
                      onClick={() => setIsCardDetailOpen(true)}
                    >
                      <Info className="h-5 w-5" aria-hidden />
                    </DetailIconButton>
                  </>
                }
              >
                <p className="text-xl font-bold text-blue-600 mt-1">
                  {formatCurrency(selectedCard.currentUsage, currencyOfCard(selectedCard))}
                </p>
                {selectedCard.issuer?.name && (
                  <p className="text-sm text-gray-600 mt-1">{selectedCard.issuer.name}</p>
                )}
              </AssetDetailHeader>

              {/* 실적은 카드 종류를 가리지 않는다. 세는 구간만 다르다. */}
              <CardPerformancePanel cardId={selectedCard.id} reloadToken={entryVersion} />

              <div className="pt-4 border-t">
                <CardSettlementPanel
                  card={selectedCard}
                  paymentAccountOwnerId={
                    accounts.find((a) => a.id === selectedCard.paymentAccountId)?.ownerId
                  }
                  reloadToken={entryVersion}
                  onChange={refreshAfterCardChange}
                />
              </div>

              {/*
                사용·결제 내역. 통장 상세의 거래 내역과 같은 목록이다.

                신용카드만 그린다. 체크카드는 쓰는 즉시 통장에서 빠져 쌓이는 대금이
                없고, 그 내역은 결제 통장의 거래 내역에 그대로 있다.
              */}
              {selectedCard.liabilityAccountId && (
                <div className="pt-4 border-t space-y-3">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700">{t('assets.cardLedger')}</h3>
                    <p className="mt-1 text-xs text-gray-500">{t('assets.cardLedgerHint')}</p>
                  </div>
                  <LedgerList
                    rows={cardLedger.rows}
                    currency={currencyOfCard(selectedCard)}
                    kind="liability"
                    hasMore={cardLedger.hasMore}
                    isLoading={cardLedger.isLoading}
                    onMore={cardLedger.loadMore}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
              <p className="text-gray-500">
                {t('assets.emptyHint')}
              </p>
            </div>
          )}
        </div>
      )}

      {/*
        숨긴 항목은 **목록 맨 아래**다.

        되돌리는 일은 드물다. 위에 두면 오늘의 자산을 보러 온 사람이 치워 둔 것을 먼저
        읽고, 목록은 그만큼 아래로 밀린다. 다 보고 나서 "숨긴 게 있었나" 할 때 그 자리에
        있으면 된다.
      */}
      <div className={hideOnNarrow}>
      <HiddenItemsPanel
        projectId={selectedProjectId}
        reloadToken={hiddenVersion}
        onRestored={async () => {
          const [accountsData, peopleData, cardsData] = await Promise.all([
            apiClient.getAccountsV2(selectedProjectId),
            apiClient.getPeople(selectedProjectId),
            apiClient.getCards(selectedProjectId),
          ]);
          setAccounts(accountsData || []);
          setPeople(peopleData || []);
          setCards(cardsData || []);
          await loadNetWorth();
        }}
      />
      </div>

      {/* 계좌 상세정보 모달 */}
      {isAccountDetailOpen && selectedAccount && (
        <Modal
          isOpen={true}
          onClose={() => setIsAccountDetailOpen(false)}
          title={t('account.detail')}
          footer={
            /* 읽기 전용 구성원에게는 손댈 단추가 없다. 상세는 그대로 읽힌다. */
            !canEdit ? null : (
            <div className="flex gap-2">
              {/*
                계좌 밑에 만들 수 있는 것은 카드뿐이라 선택 팝업을 거치지 않는다.
                결제 통장은 이 계좌로 미리 채워 둔다.
              */}
              <button
                onClick={() => {
                  setIsAccountDetailOpen(false);
                  openCardAdd(selectedAccount.id);
                }}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                {t('card.add')}
              </button>
              <button
                onClick={handleEditAccountClick}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('account.editSubmit')}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {t('assets.remove')}
              </button>
            </div>
            )
          }
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('account.owner')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount.owner?.name || '-'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('account.name')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount.name}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('account.bank')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount.institution?.name || '-'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('account.type')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {accountTypeLabel(selectedAccount.type)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('account.balance')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900 font-semibold">
                {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
              </p>
            </div>

            {selectedAccount.accountNumber && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('account.numberPlain')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedAccount.accountNumber}
                </p>
              </div>
            )}
          </div>

        </Modal>
      )}

      {/* 계좌 수정 모달 */}

      {/* 구성원 상세정보 모달. 오른쪽 패널의 "상세정보" 버튼으로 연다. */}
      {isPersonDetailOpen && selectedPerson && (
        <Modal
          isOpen={true}
          onClose={() => setIsPersonDetailOpen(false)}
          title={t('person.detail')}
          footer={
            /* 읽기 전용 구성원에게는 손댈 단추가 없다. 상세는 그대로 읽힌다. */
            !canEdit ? null : (
            <div className="flex gap-2">
              {/*
                이 사람 밑에 계좌를 바로 만든다. 카드는 계좌 밑에 붙으므로 여기서 고를 것이
                없다 -- 목록의 계좌 안에 그 버튼이 있다.

                상세를 닫고 여는 것은 이 화면의 다른 팝업과 같은 규칙이다. 모달을 겹쳐
                띄우지 않는다.
              */}
              <button
                onClick={() => {
                  setIsPersonDetailOpen(false);
                  openAccountAdd(selectedPerson.id);
                }}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                {t('account.add')}
              </button>
              <button
                onClick={handleEditPersonClick}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('account.editSubmit')}
              </button>
              <button
                onClick={handleDeletePerson}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {t('assets.remove')}
              </button>
            </div>
            )
          }
        >
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('person.name')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedPerson.name}
                </p>
              </div>
            </div>

          </>
        </Modal>
      )}


      {/* 카드 상세정보 모달. 수정 폼이 열리면 감춘다 (겹쳐 열리면 안 된다).
          detailType은 청구서 조회 effect가 쓰므로 그대로 둔다. */}
      {isCardDetailOpen && selectedCard && !isEditCardModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsCardDetailOpen(false)}
          title={t('card.detail')}
          footer={
            /* 읽기 전용 구성원에게는 손댈 단추가 없다. 상세는 그대로 읽힌다. */
            !canEdit ? null : (
            <div className="flex gap-2">
              <button
                onClick={handleEditCardClick}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('account.editSubmit')}
              </button>
              <button
                onClick={handleDeleteCard}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {t('assets.remove')}
              </button>
            </div>
            )
          }
        >
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.name')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedCard.name}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.account')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {accounts.find((a) => a.id === selectedCard.paymentAccountId)?.name || '-'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.number')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedCard.cardNumberMasked}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.type')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {t(selectedCard.cardType === 'debit' ? 'method.debit_card' : 'method.credit_card')}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.issuer')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedCard.issuer?.name}
                </p>
              </div>

              {selectedCard.cardType === 'credit' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('card.usage')}
                    </label>
                    <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                      {formatCurrency(selectedCard.currentUsage, currencyOfCard(selectedCard))}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('card.limitPlain')}
                    </label>
                    <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                      {formatCurrency(selectedCard.creditLimit, currencyOfCard(selectedCard))}
                    </p>
                  </div>

                </>
              )}
            </div>

          </>
        </Modal>
      )}

      <PersonModal
        isOpen={personModalOpen}
        onClose={() => setPersonModalOpen(false)}
        person={selectedPerson}
        mode={personModalMode as 'view' | 'edit'}
        onSuccess={(updatedPeople) => {
          setPeople(updatedPeople);
          setSelectedPerson(null);
          setPersonModalOpen(false);
        }}
        onDelete={handleDeletePerson}
      />

      <EditAccountModal
        isOpen={isEditAccountModalOpen}
        onClose={() => setIsEditAccountModalOpen(false)}
        account={selectedAccount as any}
        people={people}
        onSuccess={(updatedAccounts) => {
          setAccounts(updatedAccounts as Account[]);
          setSelectedAccount(null);
          setIsEditAccountModalOpen(false);
          // 잔액을 고치면 총자산도 달라진다.
          loadNetWorth();
        }}
        onDelete={handleDeleteAccount}
      />

      <EditCardModal
        isOpen={isEditCardModalOpen}
        onClose={() => setIsEditCardModalOpen(false)}
        card={selectedCard}
        accounts={accounts}
        onSuccess={(updatedCards) => {
          setCards(updatedCards || []);
          setSelectedCard(null);
          setIsEditCardModalOpen(false);
          // 한도나 결제 통장을 바꾸면 부채가 걸리는 자리가 달라진다.
          loadNetWorth();
        }}
        onDelete={handleDeleteCard}
      />

      {/* 구성원 추가 모달 */}
      <PersonModal
        isOpen={isPersonAddModalOpen}
        onClose={() => setIsPersonAddModalOpen(false)}
        person={null}
        mode="add"
        onSuccess={(updatedPeople) => {
          setPeople(updatedPeople);
          setStorePeople(updatedPeople);
          setIsPersonAddModalOpen(false);
        }}
        onDelete={async () => {}}
      />

      {/* 계좌 추가 모달 */}
      <AddAccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onSuccess={(newAccounts) => {
          setAccounts(newAccounts);
          loadNetWorth();
        }}
        people={people}
        projectId={selectedProjectId}
        /* 구성원 상세에서 들어왔으면 그 사람이 주인이다. 폼에서 바꿀 수 있다. */
        defaultOwnerId={addedForPersonId}
      />

      {/* 카드 추가 모달 */}
      <Modal
        isOpen={addType === 'card'}
        onClose={() => {
          setAddType(null);
          setCardForm({
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
          setAddError('');
        }}
        title={t('card.add')}
        footer={
          <button
            type="submit"
            form={CARD_ADD_FORM_ID}
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? t('account.adding') : t('account.addSubmit')}
          </button>
        }
      >
        <form id={CARD_ADD_FORM_ID} onSubmit={handleAddCard} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.name')}
            </label>
            <input
              type="text"
              required
              value={cardForm.name}
              onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
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
              value={cardForm.accountId}
              onChange={(value) => setCardForm({ ...cardForm, accountId: value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.numberOptional')}
            </label>
            <input
              type="text"
              value={cardForm.cardNumber}
              onChange={(e) => setCardForm({ ...cardForm, cardNumber: e.target.value })}
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
              value={cardForm.cardType}
              onChange={(value) => setCardForm({ ...cardForm, cardType: value as 'debit' | 'credit' })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.issuer')}
            </label>
            <CustomSelect
              options={issuerOptions}
              value={cardForm.issuerId}
              onChange={(value) => setCardForm({ ...cardForm, issuerId: value })}
              placeholder={t('card.issuerPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.expiry')}
            </label>
            <input
              type="month"
              value={cardForm.expiryDate}
              onChange={(e) => setCardForm({ ...cardForm, expiryDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('card.color')}
            </label>
            <CardColorPicker
              value={cardForm.color}
              onChange={(color) => setCardForm({ ...cardForm, color })}
            />
            <p className="mt-1 text-xs text-gray-500">
              {t('card.colorHint', {
                default: t(
                    cardForm.cardType === 'credit'
                      ? 'card.colorDefaultCredit'
                      : 'card.colorDefaultDebit',
                  ),
              })}
            </p>
          </div>

          <CardPerformanceField
            cardType={cardForm.cardType}
            value={cardForm.performanceAmount}
            onChange={(performanceAmount) => setCardForm({ ...cardForm, performanceAmount })}
            statementClosingDay={cardForm.statementClosingDay}
          />

          {cardForm.cardType === 'credit' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.limit', { currency: displayCurrency })}
                </label>
                <input
                  type="number"
                  value={cardForm.creditLimit}
                  onChange={(e) => setCardForm({ ...cardForm, creditLimit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="5000000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.closingDay')}
                </label>
                <select
                  value={cardForm.statementClosingDay}
                  onChange={(e) =>
                    setCardForm({ ...cardForm, statementClosingDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {dayOfMonthOptions().map((option) => (
                    <option key={option.day} value={option.day}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{dayOfMonthHint()}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('card.paymentDay')}
                </label>
                <select
                  value={cardForm.paymentDueDay}
                  onChange={(e) =>
                    setCardForm({ ...cardForm, paymentDueDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {dayOfMonthOptions().map((option) => (
                    <option key={option.day} value={option.day}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{dayOfMonthHint()}</p>
              </div>
            </>
          )}

          {addError && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {addError}
            </div>
          )}

        </form>
      </Modal>

      <EntryEditor
        ref={entryEditorRef}
        projectId={selectedProjectId}
        accounts={accounts}
        cards={cards}
        categories={categories}
        people={people}
        onReferenceDataChange={handleReferenceDataChange}
        onEntryChange={handleEntryChange}
      />
    </div>
  );
}

/**
 * 구성원별 자산 목록. 구성원과 계좌를 각각 드래그로 정렬한다.
 *
 * 계좌 목록은 구성원마다 별도 컴포넌트로 두어야 한다. 훅은 목록 하나를 다루므로
 * 한 컴포넌트에서 여러 묶음을 처리할 수 없다.
 */
/** 오른쪽 패널이 보고 있는 항목. 세 목록이 이것을 보고 저마다 한 줄을 강조한다. */
type SelectedItem = { type: 'person' | 'account' | 'card'; id: string } | null;

function PersonAssetList({
  people,
  accounts,
  cardsOf,
  netWorthByPerson,
  accountProfit,
  selected,
  onPersonClick,
  onAccountClick,
  onCardClick,
  onReorderPeople,
  onReorderAccounts,
  onReorderCards,
  onAddPerson,
  onAddAccount,
  onAddCard,
}: {
  people: Person[];
  accounts: Account[];
  cardsOf: (accountId: string) => Card[];
  netWorthByPerson: Map<string, { total: string }>;
  /** 투자·저축 계좌별 누적 수익. 계좌 id -> 금액 */
  accountProfit: Map<string, string>;
  selected: SelectedItem;
  onPersonClick: (person: Person) => void;
  onAccountClick: (account: Account) => void;
  onCardClick: (card: Card) => void;
  onReorderPeople: (ids: string[]) => void;
  onReorderAccounts: (ids: string[]) => void;
  onReorderCards: (ids: string[]) => void;
  /*
   * 추가는 만들 자리에서 시작한다. 구성원은 목록 끝에서, 계좌는 그 사람 안에서,
   * 카드는 그 계좌 안에서. 눌러서 들어온 자리가 곧 주인·결제 통장이라 폼에서 다시
   * 고를 것이 없다.
   */
  onAddPerson: () => void;
  onAddAccount: (personId: string) => void;
  onAddCard: (accountId: string) => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const { items, dragProps, draggingId } = useDragReorder(people, onReorderPeople);

  return (
    <div>
      {/*
        구성원은 목록 맨 위에서 더한다. 만들 자리가 목록보다 먼저 보인다.

        사람 카드끼리는 넓게(space-y-8) 벌리지만 이 버튼은 바로 아래 카드에 붙여 둔다.
        같은 간격으로 띄우면 어느 목록에 더하는 버튼인지 멀어져 읽히지 않는다.
      */}
      <AddButton label={t('person.add')} onClick={onAddPerson} />

      <div className="space-y-8">
      {items.map((person) => (
        <div
          key={person.id}
          {...dragProps(person.id)}
          className={`bg-white rounded-lg shadow p-6 hover:shadow-md transition ${
            selected?.type === 'person' && selected.id === person.id ? SELECTED_MARK : ''
          } ${draggingId === person.id ? 'opacity-50' : ''}`}
        >
          {/*
            이름과 소계를 한 줄의 양 끝에 둔다. "소계"라는 말은 적지 않는다 -- 사람
            이름 옆의 금액은 그 사람 몫이라는 뜻 말고 읽힐 것이 없다. 계좌·카드 줄도
            같은 자리에 금액을 두어, 오른쪽 끝을 따라 내려가며 셋을 견줄 수 있다.
          */}
          <button onClick={() => onPersonClick(person)} className="w-full text-left mb-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="min-w-0 truncate text-xl font-bold text-gray-900">
                {person.name}
              </h2>
              <p className="shrink-0 text-xl font-bold tabular-nums text-gray-900">
                {formatCurrency(netWorthByPerson.get(person.id)?.total ?? 0, displayCurrency)}
              </p>
            </div>
          </button>

          <AddButton label={t('account.add')} onClick={() => onAddAccount(person.id)} />

          <AccountList
            accounts={accounts.filter((account) => account.ownerId === person.id)}
            cardsOf={cardsOf}
            accountProfit={accountProfit}
            selected={selected}
            onAccountClick={onAccountClick}
            onCardClick={onCardClick}
            onReorder={onReorderAccounts}
            onReorderCards={onReorderCards}
            onAddCard={onAddCard}
          />

        </div>
      ))}
      </div>
    </div>
  );
}

/**
 * 목록 안에서 하나 더 만드는 버튼.
 *
 * 점선으로 둘러 "여기에 하나 더"로 읽히게 한다. 채워진 버튼으로 두면 목록의 항목과
 * 같은 무게가 되어, 있는 것과 만들 자리가 눈에 섞인다.
 */
/** 한 구성원의 계좌 목록 */
function AccountList({
  accounts,
  cardsOf,
  accountProfit,
  selected,
  onAccountClick,
  onCardClick,
  onReorder,
  onReorderCards,
  onAddCard,
}: {
  accounts: Account[];
  cardsOf: (accountId: string) => Card[];
  accountProfit: Map<string, string>;
  selected: SelectedItem;
  onAccountClick: (account: Account) => void;
  onCardClick: (card: Card) => void;
  onReorder: (ids: string[]) => void;
  onReorderCards: (ids: string[]) => void;
  onAddCard: (accountId: string) => void;
}) {
  const { t } = useTranslation();
  const { items, dragProps, draggingId } = useDragReorder(accounts, onReorder);

  if (items.length === 0) {
    return <p className="text-gray-600">{t('assets.noAccounts')}</p>;
  }

  return (
    <div className="space-y-4">
      {items.map((account) => {
        const cards = cardsOf(account.id);
        /* 이 통장으로 빠져나갈 카드 대금과, 그것을 뺀 남은 금액. 셈은 core 가 한다. */
        const { due, remaining } = accountDueOf(account.balance, cards);

        return (
          <div
            key={account.id}
            {...dragProps(account.id)}
            /* 오른쪽 패널에 펼쳐 둔 계좌를 목록에서도 알 수 있게 표시한다 */
            className={`rounded-lg border border-gray-200 p-4 hover:shadow-md transition ${
              selected?.type === 'account' && selected.id === account.id
                ? `${SELECTED_MARK} bg-blue-50`
                : ''
            } ${draggingId === account.id ? 'opacity-50' : ''}`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAccountClick(account);
              }}
              className="w-full text-left hover:opacity-70 transition"
            >
              {/*
                왼쪽에 계좌명, 오른쪽 끝에 남은 금액이다. 어느 계좌인지 먼저 알아야 하고,
                금액은 오른쪽 끝에 모여 있어야 위아래로 훑으며 견줄 수 있다.

                유형은 총자산을 현금성·투자·부채로 나누는 기준이라 목록에서 바로 보여야
                하므로 계좌명 옆에 붙인다.
              */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-sm text-gray-600">{account.name}</p>
                  <AccountTypeBadge type={account.type} />
                </div>
                {/*
                  잔액이 아니라 카드 대금을 뺀 남은 금액이다. 통장에 찍힌 돈에는 카드사가
                  이미 가져가기로 된 몫이 섞여 있어, 잔액만 보면 쓸 수 있는 돈을 그만큼
                  부풀려 읽는다.
                */}
                <p className="shrink-0 text-2xl font-bold tabular-nums text-gray-900">
                  {formatCurrency(remaining, account.currency)}
                </p>
              </div>
              {/*
                무엇을 뺀 값인지는 대금이 있을 때만 풀어 쓴다. 대금이 없으면 남은 금액이
                곧 잔액이라, 같은 수를 한 번 더 적는 줄이 된다.
              */}
              {due !== 0 && (
                <p className="mt-1 text-right text-xs tabular-nums text-gray-500">
                  {t(due > 0 ? 'assets.balanceWithDue' : 'assets.balanceWithRefund', {
                    balance: formatCurrency(account.balance, account.currency),
                    due: formatCurrency(Math.abs(due), account.currency),
                  })}
                </p>
              )}
              <AccountProfitLine
                account={account}
                profit={accountProfit.get(account.id)}
              />
              {account.accountNumber && (
                <p className="text-xs text-gray-400 mt-1">{account.accountNumber}</p>
              )}
            </button>

            {/*
              카드는 결제 통장 밑에 붙는다. 그 통장이 곧 이 계좌다.

              가름줄은 이 묶음 위에 둔다. 버튼과 카드 목록이 한 덩이로 보이고, 계좌
              자신의 정보와 갈린다. 줄이 버튼 아래에 있으면 버튼이 계좌 쪽에 붙어
              "이 계좌를 고치는 버튼"처럼 읽힌다.
            */}
            <div className="mt-4 border-t border-gray-200 pt-4">
              <AddButton label={t('card.add')} onClick={() => onAddCard(account.id)} />

              <CardList
                cards={cards}
                /* 사용액·남은 대금은 모두 결제 통장의 통화다 (기준통화 환산액이 아니다). */
                currency={account.currency}
                selected={selected}
                onCardClick={onCardClick}
                onReorder={onReorderCards}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 한 계좌에 연결된 카드 목록 */
function CardList({
  cards,
  currency,
  selected,
  onCardClick,
  onReorder,
}: {
  cards: Card[];
  /** 결제 통장의 통화. 카드 금액은 전부 이 통화다. */
  currency: string;
  selected: SelectedItem;
  onCardClick: (card: Card) => void;
  onReorder: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const { items, dragProps, draggingId } = useDragReorder(cards, onReorder);

  if (items.length === 0) return null;

  /* 가름줄과 위 여백은 부르는 쪽(AccountList)이 갖는다. 카드 추가 버튼과 한 덩이라서다. */
  return (
    <div className="space-y-2">
      {items.map((card) => (
        <div
          key={card.id}
          {...dragProps(card.id)}
          className={`px-3 py-2 rounded border transition ${
            selected?.type === 'card' && selected.id === card.id
              ? `${SELECTED_MARK} border-blue-200 bg-blue-50`
              : 'border-green-100 bg-green-50 hover:bg-green-100'
          } ${draggingId === card.id ? 'opacity-50' : ''}`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCardClick(card);
            }}
            className="w-full text-left"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium text-gray-900">
                💳 {card.name}
              </p>
              <CardOutstanding card={card} currency={currency} />
            </div>
            <p className="text-xs text-gray-600">
              {t(card.cardType === 'debit' ? 'method.debit_card' : 'method.credit_card')}
            </p>
          </button>
        </div>
      ))}
    </div>
  );
}
