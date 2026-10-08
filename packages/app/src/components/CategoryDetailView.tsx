/*
 * 분류 하나(또는 그 유형 전체)의 상세. 화면을 통째로 덮는다.
 *
 * 웹에서는 분류별 탭의 오른쪽 절반에 나란히 서지만, 폰에서는 나란히 세울 자리가
 * 없다. 목록 아래에 이어 붙이면 그래프가 한참 밑으로 밀려 무엇을 보고 있는지도
 * 흐려지므로, 자산 상세와 같은 규칙으로 화면을 덮는다 -- 머리글의 ← 와 기기의
 * 뒤로가기가 같은 일을 한다.
 *
 * 무엇을 받아 무엇을 그릴지는 core 의 useCategoryDetail 이 정한다(웹의 상세와 같은
 * 훅이다). 같은 분류를 누르면 두 화면이 같은 값을 말한다.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import type { EntryScopeQuery, EntryListItem } from '@money/types';

import { useCategoryDetail } from '@money/core/hooks/useCategoryDetail';
import { type ReportPeriod } from '@money/core/lib/api-client';
import { useTranslation } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';
import type { MethodSlice, PatternMode } from '@money/core/lib/usage-pattern';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import DailyCumulativeChart from './DailyCumulativeChart';
import MonthlyAmountChart from './MonthlyAmountChart';
import CategoryPieChart from './CategoryPieChart';
import PageHeader from './PageHeader';
import TransactionListView from './TransactionListView';

/** 시간대 막대 스물넷 중 이름을 적는 것. 0·3·6…시만 적어야 폰 너비에서 겹치지 않는다. */
const everyThirdHour = (index: number) => index % 3 === 0;
/** 요일은 일곱뿐이라 다 적는다. */
const everyWeekday = () => true;

/** 전환 단추 한 칸의 폭(px). 알약이 이만큼씩 미끄러진다. */
const MODE_SLOT_WIDTH = 48;

/** 요일·시간대 막대의 평균/누적 전환. 제목 줄 오른쪽에 선다 (웹의 PatternModeToggle 과 같은 모양). */
function PatternModeToggle({
  mode,
  onChange,
}: {
  mode: PatternMode;
  onChange: (mode: PatternMode) => void;
}) {
  const { t } = useTranslation();
  /*
   * 흰 알약이 고른 쪽으로 미끄러진다. 누른 데서가 아니라 mode 를 보고 움직인다 -- 요일과 시간대
   * 카드에 하나씩 서서, 한쪽을 누르면 다른 쪽 알약도 함께 옮겨 가야 한다.
   */
  const offset = useRef(new Animated.Value(mode === 'total' ? MODE_SLOT_WIDTH : 0)).current;
  useEffect(() => {
    Animated.timing(offset, {
      toValue: mode === 'total' ? MODE_SLOT_WIDTH : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [mode, offset]);
  const choose = onChange;
  const options: Array<{ id: PatternMode; label: string }> = [
    { id: 'average', label: t('detail.patternAverage') },
    { id: 'total', label: t('detail.patternTotal') },
  ];
  return (
    <View className="flex-row rounded-md bg-gray-200 p-0.5">
      <Animated.View
        pointerEvents="none"
        className="absolute bottom-0.5 left-0.5 top-0.5 rounded bg-white"
        style={{ width: MODE_SLOT_WIDTH, transform: [{ translateX: offset }] }}
      />
      {options.map((option) => (
        <Pressable
          key={option.id}
          onPress={() => choose(option.id)}
          style={{ width: MODE_SLOT_WIDTH }}
          className="items-center py-1"
        >
          <Text
            className={`text-xs font-medium ${mode === option.id ? 'text-blue-600' : 'text-gray-600'}`}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** 그래프 한 장의 카드. 제목 밑에 무엇의 평균인지 적는 한 줄을 둘 수 있다. */
function ChartCard({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  /** 제목 줄 오른쪽에 세울 조작 (평균/누적 전환) */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
      <View className="gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="shrink text-base font-semibold text-gray-900">{title}</Text>
          {action}
        </View>
        {note ? <Text className="text-xs text-gray-500">{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export default function CategoryDetailView({
  categoryId,
  categoryName,
  categories,
  period,
  exactCategory = false,
  projectId,
  filter,
  reloadToken,
  onClose,
  onEntryClick,
  trendClip,
  trendPeriod,
  controls,
  title,
  onPickCategory,
  onPickMethod,
}: {
  /** 실제 분류 id, 'total-expense'/'total-income', 또는 태그(`tag:<id>`) */
  categoryId: string;
  /** 머리글에 적을 이름. 목록이 쓰던 이름을 그대로 받는다. */
  categoryName: string;
  categories: Category[];
  period: ReportPeriod;
  /** 목록의 "미분류"에서 들어왔는지 (소분류를 뺀 그 대분류만 본다) */
  exactCategory?: boolean;
  projectId?: string | null;
  filter?: EntryScopeQuery;
  reloadToken?: number;
  /**
   * 머리글 ← 가 부른다. 주지 않으면 머리글을 세우지 않는다 -- 분석 탭처럼 제 머리글을 가진
   * 화면 안에 끼워 그릴 때다.
   */
  onClose?: () => void;
  /** 거래를 누르면 부른다. 가계 화면의 고치기 팝업으로 잇는 통로다. */
  onEntryClick?: (entry: EntryListItem) => void;
  /** 12개월 추이를 자를 구간. 거래 분석이 검색 기간을 걸었을 때 준다 (useCategoryDetail). */
  trendClip?: { from?: string; to?: string };
  /** 추이 막대의 마지막 기간. 주·해면 그 단위로 선다 (useCategoryDetail). */
  trendPeriod?: string;
  /**
   * 머리글 아래에 세울 조작 (거래 분석의 달·지출수입 탭). 없으면 아무것도 서지 않는다.
   * 보기 안에 두어야 머리글 ← 와 한 화면으로 읽힌다.
   */
  controls?: ReactNode;
  /** 머리글 제목. 없으면 "{분류} 상세 분석"이다. 거래 분석처럼 분류 하나가 아닌 보기가 준다. */
  title?: string;
  /**
   * 분류 원형의 목록 줄을 누르면 부른다. 값은 검색의 분류 칸에 담을 것이다 (`CategorySlice.pickId`).
   * 분석 탭이 그 분류를 조건으로 더한다. 주지 않으면 줄은 원형 조각과 같이 파고든다.
   */
  onPickCategory?: (pickId: string) => void;
  /** 수단 원형의 목록 줄을 누르면 부른다. 분석 탭이 그 수단을 조건으로 더한다. */
  onPickMethod?: (method: MethodSlice) => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  /** 요일·시간대 막대를 평균으로 볼지 누적(합계)으로 볼지. 두 그래프가 함께 따른다. */
  const [patternMode, setPatternMode] = useState<PatternMode>('average');
  const isTotalPattern = patternMode === 'total';
  const modeToggle = <PatternModeToggle mode={patternMode} onChange={setPatternMode} />;

  const detail = useCategoryDetail({
    categoryId,
    categories,
    period,
    exactCategory,
    projectId,
    filter,
    reloadToken,
    trendClip,
    trendPeriod,
  });

  /** 거래 목록에서 세는 세 그래프가 비었을 때의 안내. 일별 누적과 같은 말을 쓴다. */
  const emptyPattern = t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noPeriod);

  return (
    <View className="gap-6">
      {onClose ? (
        <PageHeader
          title={title ?? t('category.detailTitle', { name: categoryName })}
          onBack={onClose}
        />
      ) : null}

      {controls}

      {detail.isLoading ? (
        <Text className="py-12 text-center text-gray-500">{t('detail.loading')}</Text>
      ) : (
        <>
          {/*
            구성비. 조각이 있는 것만 온다 -- 소분류나 "미분류"를 보고 있으면 쪼갤 것이 없다.
            태그는 지출과 수입이 하나씩이다. 제목은 훅이 정한다 (웹과 같은 값).
          */}
          {detail.pies.map((pie) => (
            <View key={pie.key} className="gap-3 rounded-lg bg-white p-4 shadow-sm">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-base font-semibold text-gray-900">{t(pie.title)}</Text>
                {pie.drilledId ? (
                  <Pressable
                    onPress={pie.resetDrill}
                    className="rounded bg-gray-200 px-3 py-1 active:bg-gray-300"
                  >
                    <Text className="text-sm text-gray-700">{t('detail.back')}</Text>
                  </Pressable>
                ) : null}
              </View>

              <CategoryPieChart
                slices={pie.slices}
                currency={displayCurrency}
                /* 한 단 더 내려간 뒤나 소분류를 펼친 원형은 쪼갤 것이 없다. 그때는 누를 수 없는 그림이다. */
                onDrill={pie.drilledId || pie.isFlat ? undefined : pie.drill}
                onPick={
                  onPickCategory
                    ? (slice) => {
                        const pickId = slice.pickId ?? slice.id;
                        if (pickId) onPickCategory(pickId);
                      }
                    : undefined
                }
              />
            </View>
          ))}

          {/*
            수단별. 분류별 구성비 바로 아래에 둔다 (웹과 같은 차례) -- 두 원형이 "어디에 썼나"와
            "무엇으로 냈나"를 나란히 말한다. 아래 거래 목록에서 센다.
          */}
          <ChartCard title={t(detail.labels.method)}>
            {detail.hasPatternAmount ? (
              /* 수단은 분류가 아니라 더 내려갈 곳이 없다. onDrill 을 주지 않는다. */
              <CategoryPieChart
                slices={detail.pattern.methods}
                currency={displayCurrency}
                onPick={onPickMethod}
              />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">{emptyPattern}</Text>
            )}
          </ChartCard>

          {/* 일별 누적. 구성비 둘 다음에 이 구간의 흐름을 본다. */}
          <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
            <Text className="text-base font-semibold text-gray-900">
              {t(detail.labels.daily)}
            </Text>
            {detail.hasDailyAmount ? (
              <DailyCumulativeChart
                current={detail.daily}
                comparisons={detail.comparisons}
                currentName={detail.currentMonthName}
                throughDay={detail.throughDay}
                tooltipName={t(detail.labels.cumulative)}
              />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">
                {t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noPeriod)}
              </Text>
            )}
          </View>

          <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
            <Text className="text-base font-semibold text-gray-900">
              {t(detail.labels.monthly)}
            </Text>
            {detail.hasMonthlyAmount ? (
              <MonthlyAmountChart points={detail.monthly} currency={displayCurrency} />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">
                {t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noYear)}
              </Text>
            )}
          </View>

          {/* 요일·시간대. 둘 다 아래 거래 목록에서 센다. */}
          <ChartCard
            title={t(isTotalPattern ? detail.labels.weekdayTotal : detail.labels.weekday)}
            note={t(isTotalPattern ? 'detail.weekdayTotalNote' : 'detail.weekdayNote')}
            action={modeToggle}
          >
            {detail.hasPatternAmount ? (
              <MonthlyAmountChart
                points={isTotalPattern ? detail.pattern.weekdayTotal : detail.pattern.weekday}
                currency={displayCurrency}
                showAxisLabel={everyWeekday}
              />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">{emptyPattern}</Text>
            )}
          </ChartCard>

          <ChartCard
            title={t(isTotalPattern ? detail.labels.hourTotal : detail.labels.hour)}
            action={modeToggle}
            note={[
              t(isTotalPattern ? 'detail.hourTotalNote' : 'detail.hourNote'),
              detail.pattern.untimedCount > 0
                ? t('detail.hourUntimed', { count: detail.pattern.untimedCount })
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {detail.pattern.hasTimedAmount ? (
              <MonthlyAmountChart
                points={isTotalPattern ? detail.pattern.hourTotal : detail.pattern.hour}
                currency={displayCurrency}
                showAxisLabel={everyThirdHour}
              />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">
                {detail.hasPatternAmount ? t('detail.noHourUsage') : emptyPattern}
              </Text>
            )}
          </ChartCard>

          <View className="gap-3">
            <Text className="text-base font-semibold text-gray-900">{t('detail.entries')}</Text>
            {detail.entries.length === 0 ? (
              <Text className="text-sm text-gray-500">{t(detail.isOffline ? 'online.viewOnlyOnline' : 'detail.noEntries')}</Text>
            ) : (
              <TransactionListView entries={detail.entries} onEntryClick={onEntryClick} />
            )}
          </View>
        </>
      )}
    </View>
  );
}
