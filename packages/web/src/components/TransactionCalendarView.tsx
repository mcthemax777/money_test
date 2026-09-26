'use client';

/*
 * 거래 화면의 **달력 보기**.
 *
 * 머리글의 달력 단추로 들어온다. 목록 보기가 "무엇으로 묶어 볼까"(해·달·주 × 날짜·분류·
 * 수단)를 묻는 자리라면, 이쪽은 **한 달을 통째로 펼쳐 놓고 날을 짚는** 자리다. 두
 * 물음이 한 화면에 섞이면 어느 쪽도 또렷하지 않아 보기를 갈랐다.
 *
 * 달 머리글과 달력은 가계 화면의 날짜별 보기에서 그대로 가져왔다. 앱의 같은 이름
 * 컴포넌트와도 짜임이 같다 -- 두 화면이 같은 달을 다르게 그리면 폰으로 본 것을 웹에서
 * 다시 찾게 된다.
 *
 * **거래 줄만은 거래 화면의 것이다.** 한 화면 안에서 달력으로 보든 목록으로 보든 거래
 * 한 건은 같은 모양이어야 한다 -- 달력을 켜고 끌 때마다 줄의 생김새가 바뀌면 같은
 * 거래인지 눈으로 좇아야 한다.
 */
import { useEffect, useState } from 'react';
import { entryRows, originalEntry, type EntryListItem } from '@money/types';

import { useLedgerData } from '@money/core/hooks/useLedgerData';
import type { TransactionSearch } from '@money/core/hooks/useTransactions';
import { currentYearMonth } from '@money/core/lib/datetime';
import { sumEntries } from '@money/core/lib/entries';
import { useTranslation } from '@money/core/lib/i18n';
import { useProjectTimeZone } from '@money/core/store/project';

import MonthHeader from '@/components/MonthHeader';
import TransactionCalendar from '@/components/TransactionCalendar';
import TransactionItem from '@/components/TransactionItem';

export default function TransactionCalendarView({
  projectId,
  search,
  onOpenEntry,
}: {
  projectId: string | null;
  /**
   * 목록 보기에서 걸어 둔 검색. 달력도 같은 조건으로 거른다 -- 보기를 바꿨다고 조건이
   * 풀리면, 걸어 둔 것이 아직 살아 있는지 머리글의 숫자만 보고는 알 수 없다.
   */
  search?: TransactionSearch;
  /** 줄을 누르면 상세를 연다. */
  onOpenEntry?: (entry: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();

  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);
  const [view, setView] = useState({ year: thisYear, month: thisMonth });

  /**
   * 고른 날. null 이면 그 달 전체를 본다.
   *
   * 달을 옮기면 푼다 -- 9월 3일을 고른 채 10월로 가면 10월 3일이 고른 것으로 남는데,
   * 그것은 사용자가 고른 날이 아니다.
   */
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dayEntries, setDayEntries] = useState<EntryListItem[]>([]);

  const ledger = useLedgerData({ projectId, year: view.year, month: view.month, search });

  /*
   * 검색을 바꾸면 고른 날을 푼다. 고른 날의 거래는 누를 때 받아 둔 것이라, 조건이 바뀐
   * 뒤에도 그대로 두면 달력에서는 사라진 거래가 아래 목록에 남는다.
   */
  const searchKey = search ? JSON.stringify(search) : '';
  useEffect(() => {
    setSelectedDate(null);
    setDayEntries([]);
  }, [searchKey]);
  const totals = sumEntries(ledger.entries);

  const changeMonth = (year: number, month: number) => {
    setView({ year, month });
    setSelectedDate(null);
    setDayEntries([]);
  };

  return (
    <div className="space-y-4">
      <MonthHeader
        year={view.year}
        month={view.month}
        incomeTotal={totals.incomeTotal}
        expenseTotal={totals.expenseTotal}
        onMonthChange={changeMonth}
        /* 기간 보기는 가계 화면의 것이다. 여기서는 달만 오간다. */
        showModeSwitch={false}
      />

      {ledger.isLoading && ledger.entries.length === 0 ? (
        <p className="text-gray-600">{t('common.loading')}</p>
      ) : (
        <>
          <TransactionCalendar
            entries={ledger.entries}
            year={view.year}
            month={view.month}
            startDate={selectedDate}
            endDate={selectedDate}
            onMonthChange={changeMonth}
            onDateSelect={(date, entries) => {
              // 같은 날을 다시 누르면 고르기를 푼다. 그 달 전체로 돌아간다.
              const isSame = selectedDate?.getTime() === date.getTime();
              setSelectedDate(isSame ? null : date);
              setDayEntries(isSame ? [] : entries);
            }}
          />

          {ledger.entries.length === 0 ? (
            // 필터로 비었는지 원래 없는지 구분해 준다 (가계 화면과 같은 규칙).
            <p className="text-gray-600">
              {ledger.isFilterNarrowed ? t('ledger.noFiltered') : t('feed.empty')}
            </p>
          ) : (
            /*
              거래 목록. **거래 화면의 3단과 같은 줄이다.**

              한 화면 안에서 달력으로 보든 목록으로 보든 거래 한 건은 같은 모양이어야
              한다. 나눈 거래를 줄로 펴는 것(`entryRows`)도 그 규칙의 일부다 -- 10,000원을
              식비 5,000 + 여행경비 5,000으로 나눴다면 여기서도 두 줄이 선다.
            */
            <div className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white">
              {entryRows(selectedDate ? dayEntries : ledger.entries).map((row) => (
                <TransactionItem
                  key={row.key}
                  entry={row.entry}
                  row={row}
                  // 여는 것은 사용자가 적은 거래다 (`originalEntry`).
                  onClick={onOpenEntry ? () => onOpenEntry(originalEntry(row.entry)) : undefined}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
