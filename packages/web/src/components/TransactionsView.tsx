'use client';

/*
 * 거래. 오간 돈을 훑어보는 자리다.
 *
 * 세 겹으로 파고든다. **년월 -> (날짜·분류·수단) -> 거래.** 줄을 누르면 바로 아래가
 * 펼쳐지고 다시 누르면 접힌다. 화면을 갈아 끼우지 않으므로 어느 달의 어느 분류를 보고
 * 있는지가 줄의 위치로 남는다.
 *
 * 이 화면은 고치지 않는다. 줄을 누르면 편집기가 아니라 상세가 뜬다. 거래를 적고 고치는
 * 자리는 가계 화면이다.
 *
 * 값과 상태는 `useTransactions` 가 갖는다. 앱의 거래 화면과 같은 훅이라, 두 화면이
 * 서로 다른 규칙으로 파고들 일이 없다.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  List,
  Copy,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Shapes,
  Tag,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_ENTRY_PERIOD,
  originalEntry,
  type EntryListItem as EntryListItemDto,
  type EntryPeriodUnit,
} from '@money/types';

import {
  formatDateTime,
  isLongPeriodLabel,
  periodLabel,
  periodLabelLines,
} from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { tagPickResult, tagPickState, toggleTagPick } from '@money/core/lib/tag-pick';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import {
  useTransactions,
  type TransactionRow,
  type TransactionSearch,
  type TransactionTab,
} from '@money/core/hooks/useTransactions';
import { paybackCountOf, paybackDeleteNote } from '@money/core/hooks/usePaybacks';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { refreshInboxCount, useInboxCount } from '@money/core/store/inbox-count';
import {
  useCanEdit,
  useMyPersonId,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';
import { installmentLabel } from '@money/core/lib/period-ledger';

import EntryEditor, {
  isCopyableEntry,
  isEditableEntry,
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import CountBadge from '@/components/CountBadge';
import Modal from '@/components/Modal';
import TransactionCalendarView from '@/components/TransactionCalendarView';
import AnalysisView from '@/components/AnalysisView';
import NavIcon from '@/components/NavIcon';
import PageHeader from '@/components/PageHeader';
import RevealTop from '@/components/RevealTop';
import SearchChips from '@/components/SearchChips';
import TransactionSearchModal, { Chip } from '@/components/TransactionSearchModal';
import CategoryPickModal from '@/components/CategoryPickModal';
import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useSwapScroll } from '@/hooks/useSwapScroll';
import { useRenderBudget } from '@/hooks/useRenderBudget';
import { useLongPress } from '@/hooks/useLongPress';
import { useTopReveal } from '@/hooks/useTopReveal';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import PaybackSection from '@/components/PaybackSection';
import TransactionItem from '@/components/TransactionItem';

const TABS: Array<{ id: TransactionTab; labelKey: MessageKey }> = [
  { id: 'date', labelKey: 'tx.tab.date' },
  { id: 'category', labelKey: 'tx.tab.category' },
  { id: 'method', labelKey: 'tx.tab.method' },
];

/**
 * 체크박스. 세 상태를 보인다 -- 빈 칸 / 체크 / 줄(일부만 고름).
 *
 * 년월 줄은 그 달의 거래 일부만 골랐을 수 있어 셋이 필요하다.
 */
/**
 * 체크박스. 켜짐과 꺼짐 둘뿐이다.
 *
 * **반쯤 골라진 상태를 따로 그리지 않는다** -- 지우는 화면에서 애매한 표시는 "이걸
 * 누르면 무엇이 지워지는가"를 흐린다. 줄에 든 거래가 하나라도 빠지면 꺼진 것으로 본다.
 */
function CheckBox({
  checked,
  pending,
  onToggle,
}: {
  checked: boolean;
  /** 그 범위의 거래를 세는 중. 누른 것이 먹혔다는 표시가 된다. */
  pending?: boolean;
  onToggle: () => void;
}) {
  if (pending) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
      </span>
    );
  }

  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
        checked ? 'border-blue-600 bg-blue-600' : 'border-gray-400 bg-white'
      }`}
    >
      {checked ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * 한 줄. 오른쪽에 수입과 지출을 나란히 적는다.
 *
 * 한쪽만 적으면 이체가 섞인 달에서 줄의 금액과 아래를 펴서 나온 거래의 합이 어긋나
 * 보인다. 들어온 돈이 왼쪽, 나간 돈이 오른쪽이다 -- 나간 돈이 줄의 끝에 붙어 있어야
 * 여러 줄을 훑을 때 금액의 오른쪽 끝이 한 줄로 선다.
 *
 * 세로로 쌓지 않는다. 금액과 건수를 제목 옆에 같이 두어 **한 줄 높이**로 끝낸다.
 */
/**
 * 금액 글자 크기. 년월 줄은 제목과 같은 15px, 안쪽 줄은 그보다 한 단 작다.
 *
 * 제목보다 작은 금액은 줄에서 뒤로 물러나 보인다. 년월 줄에서 먼저 읽는 것은 달 이름이
 * 아니라 그 달에 얼마가 오갔는가라, 둘을 같은 크기로 둔다. 안쪽 줄은 제목도 14px 이라
 * 금액도 그에 맞춘다.
 */
const AMOUNT_SIZE: Record<0 | 1, string> = { 0: 'text-[15px]', 1: 'text-sm' };

/**
 * 요일 색. 토요일은 파랑, 일요일은 빨강, 나머지는 제목과 같은 먹색이다.
 *
 * 달력이 주말을 그렇게 적어 왔으니 같은 규칙을 쓴다. 표로 두는 것은 줄마다 도는
 * 자리라 조건을 두 번 견주지 않기 위해서다.
 */
const WEEKDAY_COLOR: Record<number, string> = { 0: 'text-red-600', 6: 'text-blue-600' };

function Line({
  label,
  weekday,
  meta,
  expense,
  income,
  open,
  depth,
  showNet,
  check,
  onClick,
  onLongPress,
}: {
  label: string;
  /** 날짜별 줄에서 일자 옆에 붙는 요일. 다른 탭에는 없다. */
  weekday?: { label: string; day: number };
  /** 제목 오른쪽에 붙는 잔글씨. 건수나 통장 주인 이름이다. */
  meta?: string;
  expense: number;
  income: number;
  open?: boolean;
  /**
   * 수입에서 지출을 뺀 값을 둘째 줄에 적을지. 년월 줄만 켜고 쓴다.
   *
   * 자리가 남는 웹에서도 세 번째 칸을 만들지 않고 앱과 같은 두 줄로 둔다. 두 화면이
   * 같은 숫자를 다른 자리에서 보여 주면, 폰으로 본 것을 웹에서 다시 찾게 된다.
   * (앱은 자리가 아예 없다 -- 360dp 기기에서 줄 안쪽 304dp 중 수입·지출이 30% 씩을
   * 쓰고 `₩1,234,567` 하나가 83dp 라, 칸을 더 넣으면 달 이름 자리가 6dp 만 남는다.)
   */
  showNet?: boolean;
  /** 고르는 중이면 왼쪽에 체크박스를 둔다. */
  check?: { checked: boolean; pending?: boolean; onToggle: () => void };
  /**
   * 0 이면 년월 줄, 1 이면 그 안의 줄.
   *
   * 여백은 가르지 않는다. 세 겹(년월·안쪽 줄·거래)이 모두 같은 자리에서 글자를
   * 시작해야 목록을 위에서 아래로 훑을 때 눈이 좌우로 흔들리지 않는다. 계층은
   * 글자 크기와 굵기가 알린다.
   */
  depth: 0 | 1;
  onClick: () => void;
  /** 길게 누르면 삭제할 거래 고르기로 들어서며 이 줄을 골라 둔다. 고르는 중에는 주지 않는다. */
  onLongPress?: () => void;
}) {
  const { t } = useTranslation();
  const longPress = useLongPress(onLongPress);
  const currency = useProjectDisplayCurrency();

  /*
   * 순수입 줄은 오간 돈이 있을 때만 선다. 이체만 있던 달은 수입도 지출도 0 이라
   * "순수입 0" 을 적어 봐야 위 줄의 "-" 를 되풀이할 뿐이다.
   */
  const net = income - expense;
  /*
   * 지출은 음수일 수 있다. 그 기간에 쓴 돈보다 되돌려 받은 페이백이 많으면 그렇다
   * (PAYBACK_DESIGN.md). 0 만 "오간 돈이 없다"로 본다.
   */
  const showsNet = Boolean(showNet) && (income > 0 || expense !== 0);

  return (
    <button
      type="button"
      onClick={onClick}
      {...longPress}
      aria-expanded={Boolean(open)}
      /*
        가로로 이름과 금액 묶음이 서고, 둘을 세로 가운데에 맞춘다. 금액 묶음은 금액 줄과
        순수입 줄을 쌓은 것이라, 이름이 한 줄이든 두 줄이든 위아래 여백이 고르다 (앱과 같다).

        년월 줄의 왼쪽 여백은 오른쪽 분석 아이콘과 화면 끝 사이만큼으로 줄인다 (2026-10-07
        사용자 요청). 고르는 중에는 체크가 안쪽 줄의 체크와 같은 세로선에 서야 해서 그대로 둔다.
      */
      className={`flex w-full items-center gap-2 py-2 text-left ${
        depth === 0 && !check ? 'pl-1 pr-3' : 'px-3'
      }`}
    >
      {check ? (
        <CheckBox checked={check.checked} pending={check.pending} onToggle={check.onToggle} />
      ) : null}
      {/*
        펼침 표시(▸▾)는 두지 않는다. 누르면 바로 아래가 열리고 닫히는 것이 보이므로
        화살표는 한 줄에서 자리만 차지한다. 열린 상태는 aria-expanded 로만 알린다.
      */}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        {/*
          긴 기간 이름(주차, 직접 정한 기간, 시작일을 옮긴 달)은 한 단 작게, 두 줄까지 쓴다.
          "…"로 잘리면 그 줄이 어느 기간인지 읽을 수 없다 (`isLongPeriodLabel`).
        */}
        {depth === 0 && isLongPeriodLabel(label) ? (
          <span className="flex min-w-0 flex-col text-[13px] font-semibold leading-snug text-gray-900">
            {periodLabelLines(label).map((line, index) => (
              <span key={index} className="truncate">
                {line}
              </span>
            ))}
          </span>
        ) : (
          <span
            className={`truncate text-gray-900 ${
              depth === 0 ? 'text-[15px] font-semibold' : 'text-sm font-medium'
            }`}
          >
            {label}
          </span>
        )}
        {/*
          요일. 일자 바로 옆에 붙여 "9 (토)" 로 읽히게 한다. 잔글씨(건수)보다 앞에
          두는 것은 요일이 날짜의 일부이기 때문이다.
        */}
        {weekday ? (
          <span className={`shrink-0 text-sm ${WEEKDAY_COLOR[weekday.day] ?? 'text-gray-900'}`}>
            ({weekday.label})
          </span>
        ) : null}
        {meta ? <span className="shrink-0 text-xs text-gray-500">{meta}</span> : null}
      </span>
      {/*
        들어온 돈과 나간 돈에 각자의 칸을 주고, 칸 안에서는 둘 다 오른쪽 끝에 붙인다.

        한 덩어리로 두면 두 숫자가 서로 옆에 붙어 어느 쪽이 들어온 돈인지 색으로만
        갈린다. 한쪽이 없는 달에는 남은 숫자가 오른쪽으로 미끄러져, 줄을 훑을 때
        같은 자리에서 같은 뜻을 읽을 수 없다. 칸을 고정하면 없는 쪽은 빈 자리로
        남고 있는 쪽은 늘 제 자리에 선다.

        칸 안에서 가운데에 두지 않는 것은 자릿수 때문이다. 1,110 과 222,110 이 위아래로
        서면 일의 자리가 서로 어긋나, 어느 쪽이 큰 금액인지 길이로 읽을 수 없다.
        오른쪽에 붙이면 일의 자리가 한 줄로 서서 자릿수가 그대로 보인다.
      */}
      {/*
        금액 묶음. 수입·지출 칸과 그 아래 순수입 줄을 한 덩어리로 쌓아, 왼쪽 이름과 세로
        가운데를 맞춘다. 이름이 두 줄(긴 기간 이름)일 때 금액 줄만 이름 첫 줄에 붙이고
        순수입을 그 아래로 늘어뜨리면, 줄 아래쪽 여백만 크게 남는다.
      */}
      {/* 폭은 예전의 30% 칸 둘과 그 사이 여백(gap-2)을 합친 것이다. 칸이 좁아지면 큰 금액이 잘린다. */}
      <span className="flex w-[calc(60%+0.5rem)] shrink-0 flex-col">
        <span className="flex items-center gap-2">
          <span
            className={`flex min-w-0 flex-1 justify-end overflow-hidden font-semibold tabular-nums ${AMOUNT_SIZE[depth]}`}
          >
            {income > 0 ? (
              <span className="truncate text-green-600">+{formatCurrency(income, currency)}</span>
            ) : null}
          </span>
          <span
            className={`flex min-w-0 flex-1 justify-end overflow-hidden font-semibold tabular-nums ${AMOUNT_SIZE[depth]}`}
          >
            {expense > 0 ? (
              <span className="truncate text-red-600">-{formatCurrency(expense, currency)}</span>
            ) : expense < 0 ? (
              // 페이백이 쓴 돈보다 많았다. 지출 칸에 돌아온 돈으로 적는다.
              <span className="truncate text-green-600">+{formatCurrency(-expense, currency)}</span>
            ) : income === 0 ? (
              <span className="font-normal text-gray-400">-</span>
            ) : null}
          </span>
        </span>

        {/*
          순수입. 수입·지출 칸 바로 아래, 같은 오른쪽 끝에 세운다.

          위 두 숫자를 세로로 더한 결과라 같은 세로선에 서야 눈이 옆으로 새지 않는다.
          낱말을 앞에 붙이는 것은 색만으로는 "적게 쓴 달"과 "수입이 컸던 달"이 갈리지
          않아서다 -- 초록 숫자가 둘이 되면 위의 것이 수입인지 남은 돈인지 모른다.

          글자는 한 단 작게 둔다. 이 줄은 위의 두 숫자에서 나온 값이라, 같은 크기로
          두면 달마다 굵은 금액이 셋이 되어 무엇을 먼저 읽을지 알 수 없다.
        */}
        {showsNet ? (
          <span className="flex justify-end pt-0.5">
            <span
              className={`text-xs font-semibold tabular-nums ${
                net >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {t('ledgerSummary.net')} {net >= 0 ? '+' : '-'}
              {formatCurrency(Math.abs(net), currency)}
            </span>
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * 거래 화면의 본문 전부.
 *
 * `/transactions` 가 이것을 그대로 그리고, 분류·태그 화면도 상세에서 "거래내역 보기"를
 * 누르면 **제 자리에서** 이것을 그린다. 거래 탭으로 넘기지 않는 것은 거기서 돌아오는
 * 길이 탭을 되짚는 길이 되기 때문이다 -- 분류를 보다가 그 분류의 거래를 들여다보는
 * 일은 분류 화면 안에서 끝나는 한 걸음이다.
 *
 * 그래서 화면(page)이 아니라 부품이다. 프로젝트를 고르는 일과 돌아갈 자리는 부르는
 * 쪽이 정한다.
 */
export default function TransactionsView({
  projectId: selectedProjectId,
  search,
  unit,
  locked = false,
  onBack,
}: {
  /** 어느 프로젝트의 거래인가. 화면이 제 방식으로 정해 넘긴다. */
  projectId: string | null;
  /**
   * 열자마자 걸어 둘 검색. 분류·태그에서 건너올 때 그 조건이 담겨 온다.
   *
   * 한 번만 건다. 그 뒤로는 사용자가 검색 창에서 고치는 것이 이긴다 -- 다시 걸면
   * 조건 하나를 빼자마자 도로 채워진다.
   *
   * 주지 않으면 거래 탭의 조건이다 -- 검색·묶는 단위·세는 방식을 분석 탭과 함께 쓴다
   * (`useEntryConditions`). 분석 탭의 거래내역 단추도 그래서 아무것도 넘기지 않는다. 주면 그
   * 조건은 이 화면만의 것이라 탭으로 새어 나가지 않는다.
   */
  search?: TransactionSearch;
  /** search 와 함께 처음 맞출 묶는 단위. 분석 탭의 거래내역 단추가 그 단위 그대로 연다. */
  unit?: EntryPeriodUnit;
  /**
   * 조건을 못 고치게 한다. 머리글에는 ← 만 서고 알약은 알리기만 한다 -- 분석 탭의 거래내역
   * 단추가 그 기간으로 연 화면이다. 거래 탭의 분석 아이콘이 연 분석과 같은 규칙이다.
   */
  locked?: boolean;
  /** 주면 머리글에 ← 가 선다. 부르는 쪽이 돌아가는 일을 맡는다. */
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const currency = useProjectDisplayCurrency();
  const myPersonId = useMyPersonId();
  /** 읽기 전용 구성원에게는 베끼기·고치기 단추를 그리지 않는다. */
  const canEdit = useCanEdit();
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const tx = useTransactions(selectedProjectId, {
    shared: search === undefined,
    // 넘겨받은 조건이면 첫 그림부터 그것으로 받는다 (빈 검색으로 한 번 받지 않는다).
    initial: search ? { search, unit: unit ?? DEFAULT_ENTRY_PERIOD } : undefined,
  });

  /*
   * 길게 누르면 삭제할 거래 고르기로 들어서며 누른 것을 골라 둔다 (2026-10-09 사용자 요청, 앱과
   * 같다). 고칠 수 없는 구성원과 이미 고르는 중에는 걸지 않는다.
   */
  const canLongPress = canEdit && !tx.isSelecting;

  /*
   * 뒤로가기는 머리글의 ← 를 누른 것과 같게 동작한다.
   *
   * 고르는 중에는 머리글이 통째로 바뀌고 그 왼쪽에 서는 것이 ← 다. 그때의 뒤로가기는
   * 화면을 떠나는 것이 아니라 고르기를 그만두는 일이어야 한다.
   */
  useCloseOnBack(tx.isSelecting, tx.stopSelecting);

  /*
   * 보관함에 몇 건이 기다리는가.
   *
   * 목록을 여기서 그리지는 않지만 숫자는 이 화면에 있어야 한다 -- 아이콘만 있으면
   * 눌러 보지 않고는 볼 것이 있는지 알 수 없다. 아래 탭의 거래 칸과 같은 수다(`store/inbox-count`).
   * 웹은 기기 사본이 없어 새 후보가 저절로 오지 않으므로, 이 화면에 들어올 때 한 번 더 센다.
   */
  const inboxCount = useInboxCount(selectedProjectId);
  useEffect(() => {
    void refreshInboxCount(selectedProjectId);
  }, [selectedProjectId]);
  // 사람 목록과 선택을 프로젝트에 맞춘다. 다른 화면과 같은 훅을 쓴다.
  usePersonFilterSync(selectedProjectId, tx.people);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /**
   * 분석 보기. null 이면 닫혀 있다. 년월 줄의 분석 아이콘이 그 줄의 기간 열쇠를 들고 연다.
   *
   * 분석 탭과 같은 화면(AnalysisView)을 이 자리에 그린다 -- 분석 탭의 거래내역 단추가 제
   * 자리에서 거래 화면을 그리는 것과 방향만 반대인 같은 길이다. 머리글에는 ← 만 서고, 그것이나
   * 브라우저 뒤로가기로 돌아오면 이 화면이 그대로 세워져 있어 펼침·검색이 떠날 때 그대로다.
   * 열 때마다 새로 세운다 -- 그때의 검색·단위·기간으로 열어야 한다.
   */
  const [analysisFrom, setAnalysisFrom] = useState<{ key: string } | null>(null);
  /** 분석에서 거래를 고쳤을 수 있어 돌아올 때 목록을 다시 받는다. 받아 둔 줄은 그대로 서 있다. */
  const closeAnalysis = () => {
    setAnalysisFrom(null);
    tx.reload();
  };
  useCloseOnBack(analysisFrom !== null, closeAnalysis);
  /* 펴면 맨 위로, 돌아오면 목록에서 보던 자리로 (자산 화면의 상세와 같다). */
  const rememberListScroll = useSwapScroll(analysisFrom !== null);
  const openAnalysis = (key: string) => {
    rememberListScroll();
    setAnalysisFrom({ key });
  };
  /** 더보기 선택창. 지금은 삭제 하나뿐이다. */
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  /**
   * 달력으로 보는 중인가. 머리글의 단추가 켜고 끈다.
   *
   * 목록 보기와 묻는 것이 다르다 -- 목록은 "무엇으로 묶어 볼까", 달력은 "그 달 어느
   * 날에 무엇이 있었나" 다. 한 화면에 섞으면 어느 쪽도 또렷하지 않다.
   */
  const [isCalendar, setIsCalendar] = useState(false);
  /*
   * 목록의 줄은 **내려가 볼 때만** 세운다(`useRenderBudget`). 한 달을 펴거나 검색으로
   * 여러 기간을 펴면 수백 건이라, 다 세우면 보지도 않을 줄에 시간을 쓴다. 앱과 같은 규칙이다.
   *
   * 보는 목록 자체가 바뀌면(탭·탭 다시 누르기·단위·기준·검색·가계부) 처음 몫으로 돌아간다.
   *
   * 다 세운 끝이 화면 아래에 가까우면 펼친 모양으로만 선 다음 기간 줄들을 받는다
   * (`revealMore`). 앱과 같이 스크롤만으로 잇는다 -- 기간 줄은 이미 펼친 모양이라, 당겨야
   * 안이 채워지면 "불러오는 중"에서 멈춘 것으로 보인다. 받는 중이면 기다린다(`isLoadingOpen`).
   * 받기도 전에 이으면 결국 한꺼번에 받은 것과 같아진다. 달력에서는 목록이 없다.
   */
  const lazy = useRenderBudget(
    `${selectedProjectId}|${tx.tab}|${tx.tabLevel}|${tx.unit}|${tx.basis}|${JSON.stringify(tx.search)}`,
    () => {
      if (tx.canRevealMore && !tx.isLoadingOpen && !isCalendar) tx.revealMore();
    },
  );
  /** 고른 거래에 붙일 태그를 정하는 창. */
  const [isTagPickOpen, setIsTagPickOpen] = useState(false);
  const [isCategoryPickOpen, setIsCategoryPickOpen] = useState(false);
  /**
   * 태그 창에서 사용자가 켜고 끈 것. 여기 없는 태그는 처음 상태 그대로다.
   *
   * 켠 것과 끈 것을 함께 담아야 "처음부터 꺼져 있던 것"과 "켜져 있던 것을 껐다"를
   * 가를 수 있다. 앞은 손대지 않고 뒤는 뗀다.
   */
  const [tagChanged, setTagChanged] = useState<Record<string, boolean>>({});
  /** 지우다 남은 것 같은 알림. 빈 글자면 아무것도 그리지 않는다. */
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<EntryListItemDto | null>(null);
  /** 거래 입력 팝업. 상세의 베끼기와 고치기가 값을 담아 연다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);
  /**
   * 추가 팝업 안에서 새로 만든 계좌·카드·분류·구성원.
   *
   * 훅이 준 목록(`pickerAccounts` 등)은 프로젝트가 바뀔 때만 다시 읽으므로, 팝업에서
   * 계좌를 하나 만들면 그 목록은 옛것으로 남는다. 새로 받은 목록을 여기 덮어 둔다.
   */
  const [refPatch, setRefPatch] = useState<ReferenceDataPatch>({});

  /**
   * 펼친 자리의 거래 목록.
   *
   * 달과 줄을 받아 그때그때 만든다. 여러 달을 함께 펼 수 있어서 목록이 하나가 아니다.
   */
  /**
   * 지우기 전에 묻는다. 몇 건인지 함께 적는다.
   *
   * 년월 줄을 체크하면 수십 건이 한꺼번에 골라질 수 있다. 그 숫자를 보여 주지 않으면
   * 무엇을 지우는지 모르고 확인을 누른다. 묻는 방식은 웹의 다른 삭제와 같다.
   */
  const askDelete = async () => {
    if (tx.selectedCount === 0) {
      setNotice(t('tx.deleteNone'));
      return;
    }
    /*
     * 할부·분할·환불이 걸린 거래가 섞였으면 무엇이 함께 지워지는지 적는다 (2026-10-08 사용자 결정). 회차 하나나
     * 분할 줄 하나를 골라도 거래가 통째로 지워진다.
     */
    const { installment, split, paybacks } = tx.selectedShapes;
    const notes = [
      installment > 0 ? t('tx.deleteInstallmentNote', { count: installment }) : '',
      split > 0 ? t('tx.deleteSplitNote', { count: split }) : '',
      paybacks > 0 ? t('tx.deletePaybackNote', { count: paybacks }) : '',
    ].filter(Boolean);
    const question = [t('tx.deleteConfirm', { count: tx.selectedCount }), ...notes].join('\n');
    if (!window.confirm(question)) return;

    const { failed } = await tx.deleteSelected();
    setNotice(failed > 0 ? t('tx.deleteFailed', { count: failed }) : '');
  };

  /**
   * 상세에서 이 거래 하나만 지운다.
   *
   * 고르기를 거치지 않는 길이라 한 번만 묻는다. 묻기 전에 상세를 닫지 않는다 --
   * 취소했을 때 읽고 있던 거래가 사라지면 안 된다.
   */
  const askDeleteDetail = async () => {
    if (!detail) return;
    // 원거래면 걸린 환불·페이백도 함께 지워진다. 그 수를 함께 묻는다 (7-6).
    const note = paybackDeleteNote(await paybackCountOf(detail, selectedProjectId), t);
    if (!window.confirm([t('tx.detail.deleteConfirm'), note].filter(Boolean).join('\n'))) return;

    setDetail(null);
    const deleted = await tx.deleteEntry(detail.id);
    setNotice(deleted ? '' : t('tx.deleteFailed', { count: 1 }));
  };

  /*
   * 받아 온 검색을 건다. 값이 바뀔 때만 다시 건다.
   *
   * 부르는 쪽이 그릴 때마다 새 객체를 만들어도 한 번만 걸려야 한다. 그래서 참조가
   * 아니라 값을 견준다 -- 여기서 다시 걸면 사용자가 방금 뺀 조건이 도로 채워진다.
   */
  const searchKey = search ? JSON.stringify(search) : '';
  useEffect(() => {
    if (!searchKey) return;
    tx.setSearch(JSON.parse(searchKey) as TransactionSearch);
  }, [searchKey, tx.setSearch]);

  const activeTabIndex = Math.max(
    0,
    TABS.findIndex((item) => item.id === tx.tab),
  );

  /*
   * 위쪽 한 덩어리(제목·탭·조건)가 비켜서 있는가와 그 높이.
   *
   * 년월 줄은 그 아래에 선다. 덩어리가 비켜서면 화면 맨 위(0), 되돌아오면 그 높이만큼
   * 내려온 자리다 -- 같은 길이의 시간을 들여 함께 움직여야 두 줄이 겹쳐 보이지 않는다.
   */
  const topReveal = useTopReveal<HTMLDivElement>();
  /** 년월 줄이 붙을 높이. 머리글이 내려와 있는 만큼이다 (비켜서도 조건 알약 줄은 남는다). */
  const stickyTop = topReveal.inset;

  const entryList = (yearMonth: string, key: string) => {
    // 한 번만 묻는다. 두 번 물으면 그 달을 날짜로 묶는 일이 줄마다 두 번씩 돈다.
    const entries = tx.entriesOf(yearMonth, key);
    /*
     * 나눈 거래를 줄로 편다.
     *
     * 10,000원을 식비 5,000 + 여행경비 5,000으로 나눴다면 두 줄이 선다. 뭉쳐서 한 줄로
     * 보여 주면 대표 분류 하나만 남아 "여행경비를 썼다"가 사라진다. 분류나 태그로 좁힌
     * 목록에서는 걸린 줄만 나온다 (그 판단은 서버와 사본이 같은 함수로 한다).
     */
    const rows = tx.entryRowsOf(yearMonth, key);

    /*
     * 거래 사이는 선으로만 나눈다. 줄마다 카드를 띄우면 그림자와 여백이 줄 수만큼
     * 쌓여, 한 날짜를 펼쳤을 때 한 화면에 두세 건밖에 들어가지 않는다. 가계 화면의
     * 하루 상자(TransactionListView)와 같은 규칙이다.
     *
     * divide-y 는 자식 사이에만 선을 긋는다. 고르는 중에 체크박스와 함께 감싸는 칸도
     * 자식 하나라 그대로 듣는다.
     */
    // 몫에서 이 줄의 것을 떼어 온다. 모자라면 앞에서부터 그만큼만 세운다.
    const shown = rows.slice(0, lazy.take(rows.length));

    return (
      <div className="unfold divide-y divide-gray-100 bg-white">
        {tx.isLoadingRow(yearMonth, key) ? (
          <p className="px-3 py-3 text-sm text-gray-500">{t('common.loading')}</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-3 text-sm text-gray-500">{t('feed.empty')}</p>
        ) : (
          shown.map((row) => {
            // 그 줄의 태그를 고른다. 나눈 줄마다 따로 표시할 수 있어야 한다.
            const toggle = () =>
              tx.toggleEntrySelected(
                row.entry.id,
                row.line?.lineKey ?? null,
                row.entry.lines.map((line) => line.lineKey),
              );

            /*
             * 고르는 중에는 옆에 체크박스를 세운다. 고르는 것은 체크박스뿐이고, 줄을
             * 누르면 평소처럼 상세가 뜬다 (2026-10-09 사용자 요청) -- 고르기 전에 무슨
             * 거래인지 들여다볼 수 있어야 한다.
             *
             * TransactionItem 은 가계 화면도 쓰는 컴포넌트라 손대지 않고 체크박스를 옆에 세운다.
             */
            return tx.isSelecting ? (
              /*
               * 체크박스는 년월 줄·안쪽 줄과 같은 자리에 선다. 그 줄들은 px-3 안에서
               * 체크박스를 세우므로 여기도 pl-3 이다. 세 겹의 체크박스가 한 세로줄에
               * 서지 않으면 훑을 때 눈이 좌우로 흔들린다.
               *
               * TransactionItem 은 제 px-3 을 가지고 있어 그대로 두면 글자가 줄보다
               * 한 칸 더 들어간다. 그만큼 왼쪽으로 당겨 글자도 같은 자리에서 시작하게
               * 한다 -- 줄과 거래가 같은 세로줄에 서는 것은 이 화면의 규칙이다.
               */
              <div key={row.key} className="flex items-center gap-2 pl-3">
                <CheckBox
                  checked={tx.isEntrySelected(row.entry.id, row.line?.lineKey ?? null)}
                  onToggle={toggle}
                />
                <div className="-ml-3 min-w-0 flex-1">
                  <TransactionItem
                    entry={row.entry}
                    row={row}
                    onClick={() => setDetail(originalEntry(row.entry))}
                  />
                </div>
              </div>
            ) : (
              <TransactionItem
                key={row.key}
                entry={row.entry}
                row={row}
                // 여는 것은 사용자가 적은 거래다. 목록에 선 것은 그 달의 회차 몫이다.
                onClick={() => setDetail(originalEntry(row.entry))}
                onLongPress={
                  canEdit ? () => tx.startDeleteWith({ entryId: row.entry.id }) : undefined
                }
              />
            );
          })
        )}
      </div>
    );
  };

  /** 그 달의 안쪽 줄. 세 탭이 같은 모양으로 내려오므로 한 번만 적는다. */
  const level2 = (yearMonth: string) => {
    if (tx.isLoadingMonth(yearMonth)) {
      return <p className="px-3 py-3 text-sm text-gray-500">{t('common.loading')}</p>;
    }

    const rows = tx.rowsOf(yearMonth);
    if (rows.length === 0) {
      const emptyKey: MessageKey =
        tx.tab === 'date' ? 'tx.noDays' : tx.tab === 'category' ? 'tx.noCategories' : 'tx.noMethods';
      return <p className="px-3 py-3 text-sm text-gray-500">{t(emptyKey)}</p>;
    }

    return rows.map((row: TransactionRow, index: number) => {
      const open = tx.isRowOpen(yearMonth, row.key);

      /*
       * 펴 둔 줄과 다음 줄 사이에 파란 선을 긋는다.
       *
       * 거래내역이 끝나는 자리와 다음 줄이 시작하는 자리가 맞붙어 있어, 선이 없으면
       * 마지막 거래가 다음 줄에 딸린 것처럼 읽힌다. 바깥 테두리와 **같은 색**으로 두어
       * 그 상자 안의 칸막이임을 보인다 -- 그래서 테두리를 회색으로 바꾸면 이 선도
       * 함께 간다. 혼자 파랑으로 남으면 상자와 무관한 줄로 읽힌다.
       *
       * 접힌 줄 사이에는 긋지 않는다. 그 줄들은 한 줄 높이로 나란히 서 있어 선을
       * 넣으면 목록이 표가 된다 -- 나눌 것이 생기는 것은 사이에 거래내역이 끼어들
       * 때뿐이다. 마지막 줄 뒤에도 긋지 않는다. 그 자리는 상자의 아래 변이다.
       */
      const divided = open && index < rows.length - 1;

      /*
       * 줄도 몫에서 한 자리를 떼어 간다. 차례가 아닌 줄도 **세기는 한다** -- 세지 않으면
       * 남은 것이 없다고 보고 몫이 더 늘지 않아, 그 아래가 영영 서지 않는다.
       */
      if (lazy.take(1) === 0) {
        if (open) lazy.take(tx.entryRowsOf(yearMonth, row.key).length);
        return null;
      }

      return (
        <div
          key={`${tx.tab}-${row.key}`}
          className={divided ? 'border-b border-gray-200' : undefined}
        >
          <Line
            depth={1}
            label={row.label}
            weekday={row.weekday}
            meta={
              row.sub ?? (row.count === undefined ? undefined : t('tx.entryCount', { count: row.count }))
            }
            expense={row.expense}
            income={row.income}
            open={open}
            check={
              tx.isSelecting
                ? {
                    checked: tx.rowChecked(yearMonth, row.key),
                    pending: tx.isRangePending(yearMonth, row.key),
                    onToggle: () => void tx.toggleRange(yearMonth, row),
                  }
                : undefined
            }
            onClick={() => {
              lazy.restart();
              tx.toggleRow(yearMonth, row.key);
            }}
            onLongPress={canLongPress ? () => tx.startDeleteWith({ yearMonth, row }) : undefined}
          />
          {open ? entryList(yearMonth, row.key) : null}
        </div>
      );
    });
  };

  /** 알약 하나가 놓인 자리. 손대지 않았으면 처음 상태 그대로다 (규칙은 core 의 tag-pick). */
  const tagStateOf = (tagId: string) =>
    tagPickState(tagId, tagChanged, tx.commonTagIds, tx.partialTagIds);

  /** 처음 상태에서 달라진 것만 보낸다. 손대지 않은 태그는 그대로 둔다. */
  const { addTagIds: tagAddIds, removeTagIds: tagRemoveIds } = tagPickResult(
    tx.pickerTags.map((tag) => tag.id),
    tagChanged,
    tx.commonTagIds,
  );
  const hasTagChange = tagAddIds.length > 0 || tagRemoveIds.length > 0;

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
        { label: t('tx.detail.person'), value: detail.personName },
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

  /*
   * 그릴 기간 줄. 아직 받을 차례가 아닌 첫 달(`isMonthWaiting`)까지다.
   *
   * 그 달은 "불러오는 중"으로 서고, 그 아래는 그리지 않는다. 그려 봐야 같은 문구의 빈
   * 상자들이고, 세운 끝이 화면에서 멀어져 다음 몫을 부르지 못한다.
   */
  const firstWaiting = tx.months.findIndex((month) => tx.isMonthWaiting(month.yearMonth));
  const drawnMonths = firstWaiting < 0 ? tx.months : tx.months.slice(0, firstWaiting + 1);

  /* 분석을 펴 둔 동안에는 그것만 그린다 (analysisFrom). */
  if (analysisFrom) {
    return (
      <AnalysisView
        projectId={selectedProjectId}
        initial={{
          search: tx.search,
          unit: tx.unit,
          periodKey: analysisFrom.key,
        }}
        onBack={closeAnalysis}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/*
        위쪽 한 덩어리 -- 제목, 알림, 탭, 걸어 둔 조건.

        **내리는 동안에는 비켜서고, 조금이라도 위로 올리면 되돌아온다**(`useTopReveal`).
        화면 위에 계속 붙여 두면 긴 목록에서 자리를 빼앗고, 그냥 흘려보내면 탭 하나를
        옮기거나 검색을 고치려고 맨 위까지 되돌아가야 한다. 올릴 때 한 덩어리로
        내려오므로 제목과 탭 중 무엇이 필요했든 같은 손짓으로 닿는다. 단 **걸어 둔 조건
        알약 줄부터 아래(탭)는 비켜서지 않는다** -- 무엇으로 거른 목록인지 내내 보여야 한다.

        굴러가는 동안 화면 맨 위에 남는 것은 이 덩어리가 아니라 **그 달의 년월 줄**이다
        (아래 목록의 sticky). 지금 보고 있는 것이 몇 월인지가 탭 이름보다 먼저 알고 싶은
        것이라, 늘 붙어 있을 한 줄의 자리를 그쪽에 내주었다. 조건 알약 줄이 남아 있으면 그
        아래에 선다 (`stickyTop`).
      */}
      <RevealTop reveal={topReveal}>
        {/*
          고르는 중에는 머리글이 통째로 바뀐다.
          뒤로가기 · 몇 개를 골랐는지 · 삭제. 제목과 검색은 그때 쓸 것이 아니다.
        */}
        {tx.isSelecting ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={tx.stopSelecting}
              aria-label={t('common.back')}
              title={t('common.back')}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4 text-gray-600" aria-hidden />
            </button>

            {/*
              태그를 붙이러 왔으면 그 버튼이 왼쪽, 뒤로가기 옆에 선다.
              지우기는 오른쪽 끝이다 -- 되돌릴 수 없는 일이라 뒤로가기에서 멀어야 한다.
            */}
            {tx.selectPurpose === 'tag' ? (
              <button
                type="button"
                onClick={() => {
                  // 열 때마다 비운다. 지난번에 손댄 것이 남으면 엉뚱한 태그가 바뀐다.
                  setTagChanged({});
                  setIsTagPickOpen(true);
                }}
                disabled={tx.isTagging}
                aria-label={t('tx.tagSelected')}
                title={t('tx.tagSelected')}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white hover:bg-blue-50 disabled:opacity-50"
              >
                <Tag className="h-4 w-4 text-blue-600" aria-hidden />
              </button>
            ) : null}
            {/* 분류를 바꾸러 왔으면 태그 단추 자리에 분류 단추가 선다. */}
            {tx.selectPurpose === 'category' ? (
              <button
                type="button"
                onClick={() => setIsCategoryPickOpen(true)}
                disabled={tx.isRecategorizing}
                aria-label={t('tx.categorySelected')}
                title={t('tx.categorySelected')}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white hover:bg-blue-50 disabled:opacity-50"
              >
                <Shapes className="h-4 w-4 text-blue-600" aria-hidden />
              </button>
            ) : null}

            <p className="flex-1 text-base font-semibold text-gray-900">
              {t('tx.selected', { count: tx.selectedCount })}
            </p>

            {tx.selectPurpose === 'delete' ? (
              <button
                type="button"
                onClick={askDelete}
                disabled={tx.isDeleting}
                aria-label={t('tx.deleteSelected')}
                title={t('tx.deleteSelected')}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-300 bg-white hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <PageHeader
            /*
              분류·태그 상세에서 건너왔으면 ←가 선다. 누르면 떠나온 상세가 다시 펴진다.
              평소의 거래 화면은 메뉴에 있는 자리라 돌아갈 곳이 없다.
            */
            onBack={onBack}
            title={
              <PersonScopeTitle
                noun={t('tx.noun')}
                people={tx.people}
                myPersonId={myPersonId}
                selectedPersonIds={selectedPersonIds}
                onTogglePerson={togglePersonId}
              />
            }
            action={
              // 분석 탭에서 그 기간으로 건너왔으면 ← 만 둔다 (locked).
              locked ? undefined : (
                <div className="flex gap-2">
                  {/*
                    보관함. 검색 왼쪽에 둔다.

                    아직 거래가 아닌 후보가 쌓이는 자리라 거래 화면에서 들어가는 것이
                    맞다 -- 그 후보가 되려는 것이 이 화면의 줄이다. 대기 건수는 아이콘
                    오른쪽 위에 빨간 배지로 얹는다.
                  */}
                  <Link
                    href="/transactions/inbox"
                    aria-label={t('inbox.open')}
                    title={t('inbox.title')}
                    className="flex items-center px-2 py-2 text-gray-600"
                  >
                    <span className="relative">
                      <Archive className="h-4 w-4" aria-hidden />
                      <CountBadge count={inboxCount} />
                    </span>
                  </Link>
                  {/*
                    보기를 바꾸는 단추. 지금 무엇을 보고 있는지가 아니라 **누르면 무엇이
                    되는지**를 그린다 -- 목록을 보는 중이면 달력, 달력을 보는 중이면 목록이다.
                    누를 자리와 그 결과가 한 그림이라 설명이 필요 없다.
                  */}
                  <button
                    type="button"
                    onClick={() => setIsCalendar((on) => !on)}
                    aria-label={t(isCalendar ? 'tx.viewList' : 'tx.viewCalendar')}
                    title={t(isCalendar ? 'tx.viewList' : 'tx.viewCalendar')}
                    className={`flex items-center justify-center p-2 ${
                      isCalendar ? 'text-blue-600' : 'text-gray-600'
                    }`}
                  >
                    {isCalendar ? (
                      <List className="h-4 w-4" aria-hidden />
                    ) : (
                      <CalendarDays className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                  {/*
                    검색. 달력 보기에서도 둔다 -- 걸어 둔 조건이 달력에도 그대로 걸린다.
                  */}
                  <button
                      type="button"
                      onClick={() => setIsSearchOpen(true)}
                      aria-label={t('tx.search')}
                      title={t('tx.search')}
                      /*
                        아이콘만 둔다. 테두리·바탕도, 손을 올렸을 때의 바탕도 없다. 앱과
                        같은 모양이다 -- 머리글에서는 상자보다 아이콘이 먼저 보여야 한다.
                        검색이 걸려 있다는 신호는 파란 돋보기와 그 옆 숫자가 맡는다.
                      */
                      className={`flex items-center gap-1.5 px-2 py-2 text-sm font-medium ${
                        tx.searchCount > 0 ? 'text-blue-600' : 'text-gray-600'
                      }`}
                    >
                      {/* 돋보기만 둔다. 몇 개를 걸어 두었는지는 옆에 숫자로 붙인다. */}
                      <Search className="h-4 w-4" aria-hidden />
                      {tx.searchCount > 0 ? (
                        <span className="font-semibold">{tx.searchCount}</span>
                      ) : null}
                    </button>
                  <button
                    type="button"
                    onClick={() => setIsMoreOpen(true)}
                    aria-label={t('tx.more')}
                    title={t('tx.more')}
                    className="flex items-center justify-center p-2 text-gray-600"
                  >
                    <MoreVertical className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )
            }
          />
        )}

        {tx.hasError ? (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('tx.loadFailed')}</div>
        ) : null}

        {notice ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {notice}
          </div>
        ) : null}

        {/*
          탭과 걸어 둔 조건. 둘을 한 상자에 묶는다 -- 조건이 걸려 있으면 내려가는 동안에도 이
          상자는 화면 위에 남고 그 위(제목 줄)만 비켜선다(useTopReveal 의 keepRef). 조건이 없으면
          통째로 비켜선다. 달력 보기에서는 탭이 빠지고 조건만 남는다.
        */}
        {!isCalendar || tx.searchChips.length > 0 ? (
          <div
            ref={tx.searchChips.length > 0 ? topReveal.keepRef : undefined}
            className="space-y-4"
          >
            {/* 달력 보기에서는 목록 쪽 손잡이를 감춘다 (바로 아래 주석 참고). */}
            {!isCalendar ? (
              <>
                {/*
                  보기 방식.

                  흰 알약을 눌린 칸에 그리지 않고 **하나를 두고 옮긴다.** 칸마다 바탕을 켜고
                  끄면 탭이 순간이동해, 세 탭이 한 줄에 나란한 것인지 서로 다른 화면인지가
                  흐려진다. 미끄러져 가면 "옆으로 옮겼다"가 그대로 보인다.

                  폭과 걸음은 calc 로 센다 -- 글자 길이가 언어마다 달라(날짜/Date/日付) 미리
                  적어 둘 수 없고, 재서 옮기려면 그리고 난 뒤를 기다려야 한다.
                  `p-1`(0.25rem) 과 `gap-2`(0.5rem) 가 아래 숫자의 출처다.
                */}
                <div className="relative flex gap-2 rounded-lg bg-gray-200 p-1">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-1 left-1 rounded-md bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
                    style={{
                      width: 'calc((100% - 1.5rem) / 3)',
                      // 여기서의 100% 는 알약 자신의 폭, 곧 칸 하나다.
                      transform: `translateX(calc(${activeTabIndex} * (100% + 0.5rem)))`,
                    }}
                  />
                  {TABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => tx.changeTab(item.id)}
                      /* 바탕은 위의 알약이 맡는다. 글자가 그 위에 오도록 자리를 잡아 준다. */
                      className={`relative flex flex-1 items-center justify-center gap-1 rounded-md px-4 py-2 font-medium ${
                        tx.tab === item.id ? 'text-blue-600' : 'text-gray-600'
                      }`}
                    >
                      {t(item.labelKey)}
                      {/*
                        고른 탭에만 꺾쇠를 둔다. 다음 누름이 무엇을 할지 미리 말한다 -- 거래가
                        하나라도 보이면 위(전부 접는다), 아니면 아래(한 단 더 편다)다.
                        이것이 없으면 이미 고른 탭을 다시 누를 까닭을 아무도 모른다.
                      */}
                      {tx.tab === item.id ? (
                        tx.tabOpen ? (
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {/*
              걸려 있는 조건. 탭 **아래** 둔다(2026-10-07 사용자 요청). 달력 보기에서도 남는다 --
              달력에도 같은 조건이 걸린다.

              검색 창을 열어야 무엇을 골랐는지 알 수 있으면, 결과가 비었을 때 이유를 찾으려
              창을 다시 열게 된다. 여기 늘어놓으면 그 걸음이 사라지고, 하나만 빼는 일도
              창을 열지 않고 끝난다.
            */}
            <SearchChips chips={tx.searchChips} onRemove={locked ? undefined : tx.removeSearchChip} />
          </div>
        ) : null}
      </RevealTop>

      {/*
        달력 보기. 머리글의 단추가 고른다.

        묶음 알약과 기간 줄은 감춘다(검색 조건은 달력에도 걸린다) -- 달력은 한 달을 펼쳐
        놓고 날을 짚는 자리라, 해·주로 묶거나 분류로 파고드는 손잡이가 뜻을 갖지 않는다.
      */}
      {isCalendar ? (
        <TransactionCalendarView
          projectId={selectedProjectId}
          search={tx.search}
          /* 상세는 목록 보기의 줄과 같은 자리로 연다 (읽기 전용 구성원도 읽는다). */
          onOpenEntry={setDetail}
        />
      ) : (
      <div
        /*
          자르지 않는다(overflow-hidden 을 두지 않는다). 안의 년월 줄이 굴러도 화면 위에
          남아야 하는데, 잘라 내는 상자는 그 줄을 제 안에 가둬 sticky 를 죽인다. 상자에는
          바탕도 테두리도 없어 잘라 낼 것도 없다.
        */
        className="rounded-lg"
      >
        {tx.isLoadingMonths && tx.months.length === 0 ? (
          <p className="p-3 text-sm text-gray-500">{t('common.loading')}</p>
        ) : tx.months.length === 0 ? (
          <p className="p-3 text-sm text-gray-500">{t('tx.noMonths')}</p>
        ) : (
          drawnMonths.map((month, index) => {
            const level = tx.levelOf(month.yearMonth);
            /*
             * 년월 줄끼리 맞붙는 자리에 선을 긋는다.
             *
             * 접힌 달은 한 줄 높이로 서로 붙어 서 있어, 선이 없으면 두 줄을 가르는
             * 것이 글자 사이 여백뿐이다. 줄마다 순수입이 아래 붙어 두 줄 높이가
             * 되면서 그 여백이 더 흐려졌다 -- 어느 금액이 어느 달의 것인지 눈으로
             * 끊기 어렵다.
             *
             * **위 달이 접혀 있을 때만 긋는다.** 펴 둔 달은 아래에 테두리 상자가
             * 따라오고 그 상자가 mb-2 만큼 떨어져 있어 이미 눈에 보이는 경계가 있다.
             * 거기에 선을 더하면 여백 뒤에 뜬 선 하나가 남아 상자의 일부처럼 읽힌다.
             */
            const touchesPrevious =
              index > 0 && tx.levelOf(tx.months[index - 1].yearMonth) === 0;

            return (
              <div
                key={month.yearMonth}
                className={touchesPrevious ? 'border-t border-gray-200' : undefined}
              >
                {/*
                  년월 줄은 그 달을 지나는 동안 화면 위에 남는다(sticky).

                  9월을 훑는 동안 "9월"이 위에 붙어 있고, 8월이 올라와 제 줄이 그 자리에
                  닿으면 9월을 밀어내고 8월이 선다. 붙박이 상자는 제 달(바깥 div) 안에서만
                  움직이므로, 미는 일에 따로 손댈 것이 없다 -- 9월 상자가 끝나는 곳이
                  9월 줄이 갈 수 있는 끝이다.

                  서는 높이는 위 덩어리가 정한다. 비켜서 있으면 화면 맨 위, 되돌아와
                  있으면 그 아래다. 덩어리와 같은 시간을 들여 움직여야 내려오는 제목 밑으로
                  이 줄이 미끄러져 들어가는 것으로 보인다.

                  바탕은 페이지와 같은 회색이다. 투명하게 두면 아래를 지나가는 흰 거래줄이
                  달 이름과 겹쳐 읽힌다.
                */}
                <div
                  className="sticky z-10 flex items-center bg-gray-50 transition-[top] duration-200 ease-out motion-reduce:transition-none"
                  style={{ top: stickyTop }}
                >
                  <div className="min-w-0 flex-1">
                  <Line
                    depth={0}
                    label={periodLabel(month.yearMonth)}
                    expense={toNumber(month.expense)}
                    income={toNumber(month.income)}
                    open={level >= 1}
                    /*
                      순수입은 검색을 걸지 않았을 때만 적는다.

                      검색을 켜면 이 줄의 수입·지출은 걸린 거래만 센 값이라, 그 차액은
                      그 달에 남은 돈이 아니라 "골라 낸 것들의 차액"이다. 같은 자리에
                      같은 낱말로 적히면 달의 순수입으로 읽힌다.
                    */
                    showNet={!tx.isFiltering}
                    check={
                      tx.isSelecting
                        ? {
                            checked: tx.monthChecked(month.yearMonth),
                            pending: tx.isRangePending(month.yearMonth),
                            onToggle: () => void tx.toggleRange(month.yearMonth),
                          }
                        : undefined
                    }
                    onClick={() => {
                      lazy.restart();
                      tx.cycleMonth(month.yearMonth);
                    }}
                    onLongPress={
                      canLongPress
                        ? () => tx.startDeleteWith({ yearMonth: month.yearMonth })
                        : undefined
                    }
                  />
                  </div>
                  {/*
                    이 기간의 분석. 줄의 오른쪽 끝, 금액 바로 뒤에 둔다. 줄 자체가 펼치는
                    단추라 그 안에 넣지 않고 옆에 세운다. 고르는 중에는 체크와 헷갈리지
                    않게 감춘다.
                  */}
                  {tx.isSelecting ? null : (
                    <button
                      type="button"
                      onClick={() => openAnalysis(month.yearMonth)}
                      aria-label={t('tx.analysisOfPeriod', { period: periodLabel(month.yearMonth) })}
                      title={t('tx.analysisOfPeriod', { period: periodLabel(month.yearMonth) })}
                      className="flex shrink-0 items-center justify-center self-stretch pl-2 pr-1 text-gray-400 hover:text-gray-700"
                    >
                      <NavIcon name="analysis" className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {/*
                    펼친 것을 테두리로 두른다. "여기서 여기까지가 그 달의 것" 을
                    네 변이 말한다.

                    한때 파랑이었다. 회색 테두리가 이 화면에서 걷어낸 상자와 같은
                    색이라, 그 색으로 두르면 지운 상자가 되돌아온 것처럼 보이고 안에
                    든 거래내역의 흰 상자와도 겹으로 읽힐 것을 걱정해서였다. 회색으로
                    바꿔 눈으로 견준 결과 그렇게 보이지 않아, 년월 줄 사이의 구분선과
                    같은 회색으로 두었다 -- 이 화면에서 선을 긋는 자리는 모두 한 색이고,
                    파랑은 "지금 고른 것"(알약·단추)에만 남는다.

                    안에 든 것을 테두리 모양대로 잘라 낸다(overflow-hidden). 맨 아래
                    거래내역은 흰 바탕에 모서리가 각져 있어, 그대로 두면 그 흰 사각이
                    둥근 테두리의 아래 모서리를 덮는다. 마지막 줄에만 둥근 모서리를
                    주는 방법도 있지만, 맨 아래에 오는 것이 그때그때 다르다 -- 거래내역
                    일 때도 있고 안쪽 줄이나 "기다리는 중" 한 줄일 때도 있다. 자르는
                    쪽이 무엇이 오든 맞는다.

                    안쪽 여백은 두지 않는다. 줄이 스스로 px-3 을 가지고 있고, 세 겹의
                    글자가 같은 자리에서 시작해야 한다 -- 테두리는 그 여백 안에 선다.
                  */}
                {level >= 1 ? (
                  <div className="unfold mb-2 overflow-hidden rounded-lg border border-gray-200">
                    {level2(month.yearMonth)}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        {/* 세운 줄의 끝. 화면 아래에 가까워지면 다음 줄을 세운다(`useRenderBudget`). */}
        <div ref={lazy.sentinel} aria-hidden />
      </div>
      )}

      {/*
        더보기 선택창.

        태그가 위, 지우기가 아래다. 되돌릴 수 있는 일을 먼저 둔다 -- 잘못 누를 때의
        값이 다르다.
      */}
      <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} title={t('tx.more')}>
        <button
          type="button"
          onClick={() => {
            setIsMoreOpen(false);
            setNotice('');
            tx.startSelecting('tag');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-gray-50"
        >
          <Tag className="h-4 w-4 text-blue-600" aria-hidden />
          <span className="text-base text-gray-900">{t('tx.tagSelect')}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setIsMoreOpen(false);
            setNotice('');
            tx.startSelecting('category');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-gray-50"
        >
          <Shapes className="h-4 w-4 text-blue-600" aria-hidden />
          <span className="text-base text-gray-900">{t('tx.categorySelect')}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setIsMoreOpen(false);
            setNotice('');
            tx.startSelecting('delete');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-gray-50"
        >
          <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
          <span className="text-base text-gray-900">{t('tx.select')}</span>
        </button>
      </Modal>

      <CategoryPickModal
        isOpen={isCategoryPickOpen}
        onClose={() => setIsCategoryPickOpen(false)}
        categories={tx.pickerCategories}
        count={tx.selectedCount}
        installmentCount={tx.selectedShapes.installment}
        isSubmitting={tx.isRecategorizing}
        onApply={(categoryId) => {
          void tx.recategorizeSelected(categoryId).then(({ changed, failed, skipped, excluded }) => {
            setIsCategoryPickOpen(false);
            /*
             * 결과를 글자로 알린다. 유형이 달라 그대로 둔 것과 사라진 줄은 덧붙인다 -- 조용히
             * 넘기면 고른 것이 전부 바뀐 줄 안다.
             */
            if (failed) {
              setNotice(t('tx.categoryFailed'));
              return;
            }
            setNotice(
              [
                changed > 0 ? t('tx.categoryDone', { count: changed }) : t('tx.tagNothingNew'),
                excluded > 0 ? t('tx.categoryExcluded', { count: excluded }) : '',
                skipped > 0 ? t('tx.categorySkipped', { count: skipped }) : '',
              ]
                .filter(Boolean)
                .join(' '),
            );
          });
        }}
      />

      {/*
        고른 거래에 붙일 태그를 정하는 창.

        **더하기만 한다.**

        고른 거래가 **모두** 가진 태그는 체크된 채로, 풀 수 없게 보인다. 이미 붙어 있다는
        사실을 알려 주는 것이고, 풀 수 없는 것은 이 창이 더하기만 하기 때문이다 -- 풀리게
        두면 풀고 확인했을 때 떨어질 것으로 읽히는데 그런 일은 없다.

        일부만 가진 태그는 체크하지 않는다. 체크로 보이면 "이미 다 붙어 있다"로 읽히는데,
        그 상태에서 확인을 눌러도 나머지에는 붙지 않아 말과 결과가 어긋난다.
      */}
      <Modal
        isOpen={isTagPickOpen}
        onClose={() => setIsTagPickOpen(false)}
        title={t('tx.tagSelected')}
        footer={
          <button
            type="button"
            disabled={!hasTagChange || tx.isTagging}
            onClick={() => {
              void tx.tagSelected(tagAddIds, tagRemoveIds).then(({ tagged, failed, skipped }) => {
                setIsTagPickOpen(false);
                if (failed) setNotice(t('tx.tagFailed'));
                /*
                 * 사라진 줄은 한 번 알린다. 다른 기기가 그 사이 분할을 고친 자리다.
                 *
                 * 조용히 넘기면 사용자는 표시가 된 줄 알고, 다음 동기화가 태그 없는
                 * 모습으로 덮을 때에야 알게 된다.
                 */
                else if (skipped > 0) setNotice(t('tx.tagSkipped', { count: skipped }));
                else if (tagged === 0) setNotice(t('tx.tagNothingNew'));
                else setNotice(t('tx.tagDone', { count: tagged }));
              });
            }}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t(tx.isTagging ? 'common.saving' : 'common.confirm')}
          </button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {t('tx.tagTargets', { count: tx.selectedCount })}
          </p>
          {/* 회차 하나를 골라도 태그는 원거래에 붙는다. 함께 켜진 까닭을 적는다. */}
          {tx.selectedShapes.installment > 0 ? (
            <p className="text-xs text-amber-700">
              {t('tx.tagInstallmentNote', { count: tx.selectedShapes.installment })}
            </p>
          ) : null}

          {tx.pickerTags.length === 0 ? (
            <p className="text-sm text-gray-500">{t('tags.empty')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tx.pickerTags.map((tag) => {
                const state = tagStateOf(tag.id);

                return (
                  <Chip
                    key={tag.id}
                    label={tag.name}
                    color={tag.color}
                    selected={state === 'on'}
                    partial={state === 'partial'}
                    mark
                    /* 누르면 켜지고 꺼진다. "일부"는 켜짐과 일부 사이만 오간다 (tag-pick). */
                    onClick={() =>
                      setTagChanged((prev) =>
                        toggleTagPick(tag.id, prev, tx.commonTagIds, tx.partialTagIds),
                      )
                    }
                  />
                );
              })}
            </div>
          )}

          {/*
            무엇이 벌어지는지 글자로 못 박는다. 여러 건을 한꺼번에 다루는 자리라, 이미
            붙어 있던 것이 사라질지 모른다는 걱정이 실제로 생긴다.
          */}
          <p className="text-xs leading-5 text-gray-500">{t('tx.tagHowTo')}</p>
          {tx.partialTagIds.length > 0 ? (
            <p className="text-xs leading-5 text-gray-500">{t('tx.tagPartialHint')}</p>
          ) : null}
        </div>
      </Modal>

      <TransactionSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onApply={tx.applySearch}
        current={tx.search}
        categories={tx.pickerCategories}
        accounts={tx.pickerAccounts}
        cards={tx.pickerCards}
        tags={tx.pickerTags}
        people={tx.people}
        unit={tx.unit}
      />

      <Modal
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
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
                  entryEditorRef.current?.openCopy(detail);
                  setDetail(null);
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
                  entryEditorRef.current?.openEdit(detail);
                  setDetail(null);
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
                onClick={askDeleteDetail}
                disabled={tx.isDeleting}
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
            <p className="mb-1 text-3xl font-bold text-gray-900">
              {formatCurrency(detail.amount, currency)}
            </p>
            <p className="mb-4 text-base text-gray-600">
              {detail.description || t('entry.noTitle')}
            </p>
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
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
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
                onAdd={(original) => {
                  entryEditorRef.current?.openPayback(original);
                  setDetail(null);
                }}
                onOpen={(payback) => setDetail(payback)}
              />
            </div>
          </div>
        ) : null}
      </Modal>

      {/*
        거래 추가. 화면 오른쪽 아래에 붙박인다(fixed).

        목록 위에 두지 않는다 -- 이 화면의 목록은 달을 펴고 줄을 펴며 얼마든지 길어져,
        위에 둔 단추는 몇 번만 굴리면 화면 밖으로 사라진다. 고르는 중에는 거두어 둔다.
        그때의 누름은 체크이고, 머리글에 지우기·태그 단추가 따로 서 있다.

        좁은 화면에서는 아래쪽 탭 막대를 피해 그 위에 선다. 읽기 전용 구성원에게는
        그리지 않는다.
      */}
      {canEdit && !tx.isSelecting ? (
        <button
          type="button"
          onClick={() => entryEditorRef.current?.openAdd()}
          aria-label={t('entryForm.addButton')}
          title={t('entryForm.addButton')}
          className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 md:bottom-6 md:right-6"
        >
          <Plus className="h-6 w-6" aria-hidden />
        </button>
      ) : null}

      {/*
        거래 입력 팝업. 붙박이 추가 단추와, 상세의 베끼기·고치기가 이것을 연다.

        고를 목록은 훅이 이미 읽어 둔 것을 그대로 준다 -- 검색 창이 고르는 계좌·카드·
        분류가 거래를 적을 때 고르는 것과 같은 목록이다.
      */}
      <EntryEditor
        ref={entryEditorRef}
        projectId={selectedProjectId}
        accounts={refPatch.accounts ?? tx.pickerAccounts}
        cards={refPatch.cards ?? tx.pickerCards}
        categories={refPatch.categories ?? tx.pickerCategories}
        people={refPatch.people ?? tx.people}
        onReferenceDataChange={(patch) => setRefPatch((prev) => ({ ...prev, ...patch }))}
        onEntryChange={tx.reload}
      />
    </div>
  );
}
