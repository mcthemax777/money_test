/*
 * 거래 화면의 년월 줄과 그 안의 줄(날짜·분류·수단), 그리고 고르는 중에 서는 체크박스.
 *
 * 거래 화면(TransactionsScreen)에서 떼어 냈다 (2026-10-26). 줄은 `memo` 로 감싸 내보낸다 --
 * 부르는 쪽은 고정된 함수만 넘겨야 그 memo 가 걸린다.
 */
import { memo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { isLongPeriodLabel, periodLabelLines } from '@money/core/lib/datetime';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import NavIcon from './NavIcon';


/**
 * 체크박스. RN 에는 없어서 그린다.
 *
 * 켜짐과 꺼짐 둘뿐이다. **반쯤 골라진 상태를 따로 그리지 않는다** -- 지우는 화면에서
 * 애매한 표시는 "이걸 누르면 무엇이 지워지는가"를 흐린다. 줄에 든 거래가 하나라도
 * 빠지면 꺼진 것으로 본다.
 */
export function CheckBox({
  checked,
  pending,
  onPress,
}: {
  checked: boolean;
  /** 그 범위의 거래를 세는 중. 누른 것이 먹혔다는 표시가 된다. */
  pending?: boolean;
  onPress: () => void;
}) {
  return (
    /*
      누르는 자리를 줄 높이만큼 넓힌다.
      20×20 상자만 받으면 손가락이 조금 아래로 가도 바깥의 줄이 눌려 접힘·펼침이
      바뀐다. 체크하려던 사람에게는 "체크가 안 된다"로 보인다.
    */
    <Pressable onPress={onPress} hitSlop={8} className="py-3 pl-1 pr-2">
      {pending ? (
        <View className="h-5 w-5 items-center justify-center">
          <ActivityIndicator size="small" color="#2563eb" />
        </View>
      ) : (
        <View
          className={`h-5 w-5 items-center justify-center rounded border ${
            checked ? 'border-blue-600 bg-blue-600' : 'border-gray-400 bg-white'
          }`}
        >
          {checked ? <Check size={14} color="#ffffff" strokeWidth={3} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/**
 * 금액 글자 크기. 년월 줄은 제목과 같은 15px, 안쪽 줄은 그보다 한 단 작다.
 *
 * 제목보다 작은 금액은 줄에서 뒤로 물러나 보인다. 년월 줄에서 먼저 읽는 것은 달 이름이
 * 아니라 그 달에 얼마가 오갔는가라, 둘을 같은 크기로 둔다. 안쪽 줄은 제목도 14px 이라
 * 금액도 그에 맞춘다.
 */
const AMOUNT_SIZE: Record<0 | 1, string> = { 0: 'text-[15px]', 1: 'text-sm' };

/**
 * 숫자를 같은 폭으로 그린다. 웹의 `tabular-nums` 와 같은 구실이다.
 *
 * 폰트가 정하는 대로 두면 1 이 다른 숫자보다 좁아, 위아래로 선 금액의 자릿수가
 * 조금씩 어긋난다. 오른쪽 끝을 맞춰도 쉼표 자리가 들쭉날쭉해 길이로 읽기 어렵다.
 */
const TABULAR = { fontVariant: ['tabular-nums' as const] };

/**
 * 요일 색. 토요일은 파랑, 일요일은 빨강, 나머지는 제목과 같은 먹색이다.
 *
 * 달력이 주말을 그렇게 적어 왔으니 같은 규칙을 쓴다. 표로 두는 것은 줄마다 도는
 * 자리라 조건을 두 번 견주지 않기 위해서다.
 */
const WEEKDAY_COLOR: Record<number, string> = { 0: 'text-red-600', 6: 'text-blue-600' };

/**
 * 2단·3단의 한 줄.
 *
 * 오른쪽에 수입과 지출을 나란히 적는다. 한쪽만 적으면 이체가 섞인 달에서 줄의 금액과
 * 아래를 펴서 나온 거래의 합이 어긋나 보인다. 들어온 돈이 왼쪽, 나간 돈이 오른쪽이다
 * -- 나간 돈이 줄의 끝에 붙어 있어야 여러 줄을 훑을 때 금액의 오른쪽 끝이 한 줄로 선다.
 *
 * 세로로 쌓지 않는다. 금액과 건수를 제목 옆에 같이 두어 **한 줄 높이**로 끝낸다.
 */
/*
 * 누름과 체크는 **줄이 자기 자리를 되돌려 준다.**
 *
 * 부르는 쪽이 `() => cycleMonth(yearMonth)` 를 만들어 넘기면 그릴 때마다 새 함수라
 * 아래 `memo` 가 늘 헛돈다. 한 달을 펼치면 이 줄이 서른 개 서고, 거래를 이어 그릴
 * 때마다 그 서른 개가 통째로 다시 서면 이어 그리는 뜻이 없어진다 -- 실제로 줄만으로
 * 한 번에 150ms 였다.
 *
 * 년월 줄은 `rowKey` 가 빈 글자다. 받는 쪽(`cycleMonth`)이 그 자리를 보지 않는다.
 */
function LineView({
  label,
  weekday,
  meta,
  expense,
  income,
  open,
  depth,
  yearMonth,
  rowKey,
  showNet,
  checkable,
  checked,
  checkPending,
  onToggle,
  onPress,
  onLongPress,
  onAnalyze,
}: {
  label: string;
  /** 날짜별 줄에서 일자 옆에 붙는 요일. 다른 탭에는 없다. */
  weekday?: { label: string; day: number };
  /** 제목 오른쪽에 붙는 잔글씨. 건수나 통장 주인 이름이다. */
  meta?: string;
  expense: number;
  income: number;
  /** 펼쳐진 상태. 화살표를 그리지는 않고 읽는 도구에만 알린다. */
  open?: boolean;
  /**
   * 0 이면 년월 줄, 1 이면 그 안의 줄.
   *
   * 여백은 가르지 않는다. 세 겹(년월·안쪽 줄·거래)이 모두 같은 자리에서 글자를
   * 시작해야 목록을 위에서 아래로 훑을 때 눈이 좌우로 흔들리지 않는다. 계층은
   * 글자 크기와 굵기가 알린다.
   */
  depth: 0 | 1;
  yearMonth: string;
  /** 안쪽 줄의 열쇠. 년월 줄은 빈 글자다. */
  rowKey: string;
  /**
   * 수입에서 지출을 뺀 값을 둘째 줄에 적을지. 년월 줄만 켜고 쓴다.
   *
   * 한 줄에 세 번째 금액 칸을 둘 자리가 없어서 아래로 내렸다. 360dp 기기에서 줄
   * 안쪽은 304dp 인데(쉘 px-4 와 줄 px-3 을 뺀 값) 수입·지출 칸이 30% 씩을 이미
   * 쓰고 있고, `₩1,234,567` 하나가 15px 굵은 글씨로 83dp 라 칸을 더 좁힐 수도 없다.
   * 칸을 하나 더 넣으면 달 이름 자리가 6dp 만 남는다.
   */
  showNet?: boolean;
  /** 고르는 중이면 왼쪽에 체크박스를 둔다. */
  checkable?: boolean;
  checked?: boolean;
  checkPending?: boolean;
  onToggle?: (yearMonth: string, rowKey: string) => void;
  onPress: (yearMonth: string, rowKey: string) => void;
  /** 길게 누르면 삭제할 거래 고르기로 들어서며 이 줄을 골라 둔다. 고르는 중에는 주지 않는다. */
  onLongPress?: (yearMonth: string, rowKey: string) => void;
  /**
   * 이 기간의 분석을 연다. 년월 줄만 준다 -- 금액 뒤에 아이콘이 선다.
   *
   * 기간 열쇠를 되돌려 주는 고정된 함수여야 `memo` 가 걸린다 (`onPress` 와 같다).
   */
  onAnalyze?: (yearMonth: string) => void;
}) {
  const { t } = useTranslation();
  const currency = useProjectDisplayCurrency();

  /*
   * 순수입 줄은 오간 돈이 있을 때만 선다. 이체만 있던 달은 수입도 지출도 0 이라
   * "순수입 0" 을 적어 봐야 위 줄의 "-" 를 되풀이할 뿐이다.
   */
  const net = income - expense;
  // 지출은 음수일 수 있다 -- 페이백이 쓴 돈보다 많은 기간이다 (웹의 같은 줄과 같다).
  const showsNet = Boolean(showNet) && (income > 0 || expense !== 0);

  return (
    <Pressable
      onPress={() => onPress(yearMonth, rowKey)}
      onLongPress={onLongPress && (() => onLongPress(yearMonth, rowKey))}
      accessibilityRole="button"
      accessibilityState={{ expanded: Boolean(open) }}
      /*
        가로로 이름 · 금액 묶음 · 분석 아이콘이 서고, 셋 다 세로 가운데에 맞춘다. 금액 묶음은
        금액 줄과 순수입 줄을 쌓은 것이라, 이름이 한 줄이든 두 줄이든 위아래 여백이 고르다.

        분석 아이콘이 서는 년월 줄은 양 끝 여백을 아이콘과 화면 끝 사이만큼으로 줄인다
        (2026-10-07 사용자 요청). 고르는 중에는 아이콘이 없고, 체크가 안쪽 줄의 체크와 같은
        세로선에 서야 해서 그대로 둔다.
      */
      className={`flex-row items-center gap-2 py-2 ${onAnalyze ? 'pl-1 pr-1' : 'px-3'}`}
    >
      {checkable && onToggle ? (
        <CheckBox
          checked={Boolean(checked)}
          pending={checkPending}
          onPress={() => onToggle(yearMonth, rowKey)}
        />
      ) : null}
      {/*
        펼침 표시(▸▾)는 두지 않는다. 누르면 바로 아래가 열리고 닫히는 것이 보이므로
        화살표는 한 줄에서 자리만 차지한다.
      */}
      <View className="min-w-0 flex-1 flex-row items-baseline gap-1.5">
        {/*
          긴 기간 이름(주차, 직접 정한 기간, 시작일을 옮긴 달)은 한 단 작게, 두 줄까지 쓴다
          (웹과 같다). "…"로 잘리면 그 줄이 어느 기간인지 읽을 수 없다.
        */}
        {depth === 0 && isLongPeriodLabel(label) ? (
          <View className="shrink">
            {periodLabelLines(label).map((line, index) => (
              <Text
                key={index}
                numberOfLines={1}
                className="text-[13px] font-semibold leading-[18px] text-gray-900"
              >
                {line}
              </Text>
            ))}
          </View>
        ) : (
          <Text
            numberOfLines={1}
            className={`shrink text-gray-900 ${
              depth === 0 ? 'text-[15px] font-semibold' : 'text-sm font-medium'
            }`}
          >
            {label}
          </Text>
        )}
        {/*
          요일. 일자 바로 옆에 붙여 "9 (토)" 로 읽히게 한다. 잔글씨(건수)보다 앞에
          두는 것은 요일이 날짜의 일부이기 때문이다.
        */}
        {weekday ? (
          <Text className={`text-sm ${WEEKDAY_COLOR[weekday.day] ?? 'text-gray-900'}`}>
            ({weekday.label})
          </Text>
        ) : null}
        {meta ? <Text className="text-xs text-gray-500">{meta}</Text> : null}
      </View>
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
      <View className="w-[60%] shrink-0">
        <View className="flex-row items-center gap-2">
          <View className="flex-1 flex-row justify-end">
            {income > 0 ? (
              <Text
                numberOfLines={1}
                style={TABULAR}
                className={`font-semibold text-green-600 ${AMOUNT_SIZE[depth]}`}
              >
                +{formatCurrency(income, currency)}
              </Text>
            ) : null}
          </View>
          <View className="flex-1 flex-row justify-end">
            {expense > 0 ? (
              <Text
                numberOfLines={1}
                style={TABULAR}
                className={`font-semibold text-red-600 ${AMOUNT_SIZE[depth]}`}
              >
                -{formatCurrency(expense, currency)}
              </Text>
            ) : expense < 0 ? (
              // 페이백이 쓴 돈보다 많았다. 지출 칸에 돌아온 돈으로 적는다.
              <Text
                numberOfLines={1}
                style={TABULAR}
                className={`font-semibold text-green-600 ${AMOUNT_SIZE[depth]}`}
              >
                +{formatCurrency(-expense, currency)}
              </Text>
            ) : income === 0 ? (
              <Text className={`text-gray-400 ${AMOUNT_SIZE[depth]}`}>-</Text>
            ) : null}
          </View>
        </View>

        {/*
          순수입. 수입·지출 칸 바로 아래, 같은 오른쪽 끝에 세운다.

          위 두 숫자를 세로로 더한 결과라 같은 세로선에 서야 눈이 옆으로 새지 않는다.
          낱말을 앞에 붙이는 것은 색만으로는 "적게 쓴 달"과 "수입이 컸던 달"이 갈리지
          않아서다 -- 초록 숫자가 둘이 되면 위의 것이 수입인지 남은 돈인지 모른다.

          글자는 한 단 작게 둔다. 이 줄은 위의 두 숫자에서 나온 값이라, 같은 크기로
          두면 달마다 굵은 금액이 셋이 되어 무엇을 먼저 읽을지 알 수 없다.
        */}
        {showsNet ? (
          <View className="flex-row justify-end pt-0.5">
            <Text
              numberOfLines={1}
              style={TABULAR}
              className={`text-xs font-semibold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}
            >
              {t('ledgerSummary.net')} {net >= 0 ? '+' : '-'}
              {formatCurrency(Math.abs(net), currency)}
            </Text>
          </View>
        ) : null}
      </View>
      {/*
        이 기간의 분석. 줄의 오른쪽 끝, 금액 줄과 순수입 줄의 세로 가운데다. 줄을 누르는 것
        (펼치기)과 갈리도록 누를 자리를 아이콘 둘레로 넓혀 둔다.
      */}
      {onAnalyze ? (
        <Pressable
          onPress={() => onAnalyze(yearMonth)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('tx.analysisOfPeriod', { period: label })}
          className="ml-3 shrink-0"
        >
          <NavIcon name="analysis" size={16} color="#9ca3af" />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * 값이 그대로면 다시 그리지 않는다.
 *
 * 거래를 프레임마다 이어 그리는 동안 이 줄들은 하나도 바뀌지 않는다. 그때 서른 개를
 * 통째로 다시 세우면 이어 그리기가 아낀 값을 그대로 도로 쓴다.
 */
const Line = memo(LineView);

export default Line;
