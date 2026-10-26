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
import { Plus } from 'lucide-react';
import {
  DEFAULT_ENTRY_PERIOD,
  originalEntry,
  type EntryListItem as EntryListItemDto,
  type EntryPeriodUnit,
} from '@money/types';

import { periodLabel } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { toNumber } from '@money/core/lib/money';
import {
  useTransactions,
  type TransactionRow,
  type TransactionSearch,
} from '@money/core/hooks/useTransactions';
import { paybackCountOf, paybackDeleteNote } from '@money/core/hooks/usePaybacks';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useScreenReturn } from '@money/core/hooks/useScreenReturn';
import { refreshInboxCount, useInboxCount } from '@money/core/store/inbox-count';
import { useCanEdit, useMyPersonId } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import EntryEditor, { type EntryEditorHandle, type ReferenceDataPatch } from '@/components/EntryEditor';
import TransactionCalendarView from '@/components/TransactionCalendarView';
import AnalysisView from '@/components/AnalysisView';
import NavIcon from '@/components/NavIcon';
import PageHeader from '@/components/PageHeader';
import RevealTop from '@/components/RevealTop';
import SearchChips from '@/components/SearchChips';
import TransactionSearchModal from '@/components/TransactionSearchModal';
import CategoryPickModal from '@/components/CategoryPickModal';
import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useSwapScroll } from '@/hooks/useSwapScroll';
import { useRenderBudget } from '@/hooks/useRenderBudget';
import { useTopReveal } from '@/hooks/useTopReveal';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import TransactionItem from '@/components/TransactionItem';
import { ScreenVisibility } from '@/components/ScreenVisible';
import { CheckBox, Line } from '@/components/transactions/TransactionLine';
import TransactionDetailModal from '@/components/transactions/TransactionDetailModal';
import SelectionBar from '@/components/transactions/SelectionBar';
import HeaderActions from '@/components/transactions/HeaderActions';
import TransactionTabs from '@/components/transactions/TransactionTabs';
import MoreActionsModal from '@/components/transactions/MoreActionsModal';
import TagPickModal from '@/components/transactions/TagPickModal';

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
   * 단추가 그 기간으로 덮어 연 화면이다. 분석으로 가는 단추(오른쪽 위·년월 줄)도 없다.
   */
  locked?: boolean;
  /** 주면 머리글에 ← 가 선다. 부르는 쪽이 돌아가는 일을 맡는다. */
  onBack?: () => void;
}) {
  const { t } = useTranslation();
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
  /* 분석은 위에 덮이듯 밀려 들어오고, 닫으면 목록이 제자리로 돌아온다 (2026-10-10 사용자 요청). */
  const returnClass = useScreenReturn(analysisFrom !== null) ? 'screen-return' : '';
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
  /*
   * 가계부를 바꾸면 덮어 둔 목록을 버린다 (2026-10-16). 이 화면은 가계부를 바꿔도 다시 서지 않아, 앞 가계부에서
   * 팝업으로 받은 계좌·카드·분류가 새 가계부의 편집기에 그대로 남았다. 그때는 훅이 새로 받은 목록을 쓴다.
   */
  useEffect(() => {
    setRefPatch({});
  }, [selectedProjectId]);

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

  /*
   * 그릴 기간 줄. 아직 받을 차례가 아닌 첫 달(`isMonthWaiting`)까지다.
   *
   * 그 달은 "불러오는 중"으로 서고, 그 아래는 그리지 않는다. 그려 봐야 같은 문구의 빈
   * 상자들이고, 세운 끝이 화면에서 멀어져 다음 몫을 부르지 못한다.
   */
  const firstWaiting = tx.months.findIndex((month) => tx.isMonthWaiting(month.yearMonth));
  const drawnMonths = firstWaiting < 0 ? tx.months : tx.months.slice(0, firstWaiting + 1);

  /*
    분석을 펴 둔 동안에는 그것만 보인다(analysisFrom).
    아래 화면은 지우지 않고 숨겨 둔다 (2026-10-15 사용자 요청 -- 팝업처럼). 받아 둔 값·펼침·고른
    탭이 그대로 남아 닫으면 다시 받지 않고, 숨어 있는 동안에도 다른 기기의 변경을 받는다.
  */
  return (
    <>
      {analysisFrom ? (
        <div className="screen-push">
          <AnalysisView
            projectId={selectedProjectId}
            initial={{
              search: tx.search,
              unit: tx.unit,
              periodKey: analysisFrom.key,
            }}
            onBack={closeAnalysis}
          />
        </div>
      ) : null}
    <div className={`space-y-4 ${analysisFrom ? 'hidden' : returnClass}`}>
      <ScreenVisibility visible={!analysisFrom}>
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
          <SelectionBar
            purpose={tx.selectPurpose}
            selectedCount={tx.selectedCount}
            isTagging={tx.isTagging}
            isRecategorizing={tx.isRecategorizing}
            isDeleting={tx.isDeleting}
            onBack={tx.stopSelecting}
            onTag={() => {
              // 열 때마다 비운다. 지난번에 손댄 것이 남으면 엉뚱한 태그가 바뀐다.
              setTagChanged({});
              setIsTagPickOpen(true);
            }}
            onCategory={() => setIsCategoryPickOpen(true)}
            onDelete={askDelete}
          />
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
              /*
                분석에서 그 기간으로 덮어 열었으면 ← 만 둔다 (locked). 분석 단추도 두지 않는다 -- 그
                아래에 이 화면을 연 분석이 있다 (2026-10-10 사용자 요청).
              */
              locked ? undefined : (
                <HeaderActions
                  inboxCount={inboxCount}
                  isCalendar={isCalendar}
                  searchCount={tx.searchCount}
                  onToggleCalendar={() => setIsCalendar((on) => !on)}
                  onSearch={() => setIsSearchOpen(true)}
                  onMore={() => setIsMoreOpen(true)}
                />
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
              <TransactionTabs tab={tx.tab} tabOpen={tx.tabOpen} onChange={tx.changeTab} />
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
                    않게 감춘다. 분석이 덮어 연 화면(locked)에도 두지 않는다 -- 그 아래가 분석이다.
                  */}
                  {tx.isSelecting || locked ? null : (
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

      {/* 더보기 선택창. 고른 일로 고르기를 시작한다. */}
      <MoreActionsModal
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        onChoose={(purpose) => {
          setIsMoreOpen(false);
          setNotice('');
          tx.startSelecting(purpose);
        }}
      />

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

      {/* 고른 거래에 붙일 태그를 정하는 창. 더하기만 한다 (TagPickModal 의 주석). */}
      <TagPickModal
        isOpen={isTagPickOpen}
        onClose={() => setIsTagPickOpen(false)}
        tags={tx.pickerTags}
        changed={tagChanged}
        onChangedChange={setTagChanged}
        commonTagIds={tx.commonTagIds}
        partialTagIds={tx.partialTagIds}
        selectedCount={tx.selectedCount}
        installmentCount={tx.selectedShapes.installment}
        isTagging={tx.isTagging}
        onApply={(tagAddIds, tagRemoveIds) => {
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
      />

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

      {/* 거래 상세. 베끼기·고치기는 상세를 닫고 편집기를 연다 -- 팝업 둘이 겹치면 뒤로가기가 어느 것을 닫는지 알 수 없다. */}
      <TransactionDetailModal
        detail={detail}
        onClose={() => setDetail(null)}
        isDeleting={tx.isDeleting}
        onCopy={(entry) => {
          entryEditorRef.current?.openCopy(entry);
          setDetail(null);
        }}
        onEdit={(entry) => {
          entryEditorRef.current?.openEdit(entry);
          setDetail(null);
        }}
        onDelete={askDeleteDetail}
        onAddPayback={(original) => {
          entryEditorRef.current?.openPayback(original);
          setDetail(null);
        }}
        onOpen={(payback) => setDetail(payback)}
      />

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
      </ScreenVisibility>
    </div>
    </>
  );
}
