/*
 * 거래. 오간 돈을 훑어보는 자리다.
 *
 * 세 겹으로 파고든다. **년월 -> (날짜·분류·수단) -> 거래.** 겹마다 그 줄을 누르면
 * 바로 아래가 펼쳐지고, 다시 누르면 접힌다. 화면을 갈아 끼우지 않는 것이 요점이다 --
 * 어느 달의 어느 분류를 보고 있는지가 줄의 위치로 남아, 되돌아가려고 뒤로가기를
 * 누를 일이 없다.
 *
 * 이 화면은 고치지 않는다. 줄을 누르면 편집 폼이 아니라 상세가 뜬다. 거래를 적고
 * 고치는 자리는 가계 화면이다.
 *
 * 값은 `useTransactions` 가 창구에서 받는다. 그래서 서버에서 왔는지 기기 사본에서
 * 왔는지 이 화면은 모르고, 오프라인에서도 같은 코드로 그려진다.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Archive, ArrowLeft, Check, MoreVertical, Search, Tag, Trash2, X } from 'lucide-react-native';
import type { EntryListItem } from '@money/types';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { formatYearMonth } from '@money/core/lib/datetime';
import {
  useTransactions,
  type TransactionRow,
  type TransactionTab,
} from '@money/core/hooks/useTransactions';
import {
  useCanEdit,
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
} from '@money/core/store/project';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useEntryDrafts } from '@money/core/hooks/useEntryDrafts';
import { useUserFilter } from '@money/core/store/user-filter';
import { useEntryFocus, type EntryFocusOrigin } from '@money/core/store/entry-focus';

import { useCloseOnBack, useNavigation } from '../shell/navigation';
import EntryDetailModal from '../components/EntryDetailModal';
import EntryEditor from '../components/EntryEditor';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import PersonScopeTitle from '../components/PersonScopeTitle';
import TransactionItem from '../components/TransactionItem';
import TagPickModal from '../components/TagPickModal';
import TransactionSearchModal from '../components/TransactionSearchModal';

/**
 * 건너온 자리가 어느 화면에 있는가. ←가 그 화면으로 돌려보낸다.
 *
 * 분류와 태그는 한 화면의 두 탭이라 같은 주소다.
 */
const ORIGIN_SCREEN: Record<EntryFocusOrigin['kind'], string> = {
  category: '/categories',
  tag: '/categories',
  person: '/assets',
  account: '/assets',
  card: '/assets',
};

const TABS: Array<{ id: TransactionTab; labelKey: MessageKey }> = [
  { id: 'date', labelKey: 'tx.tab.date' },
  { id: 'category', labelKey: 'tx.tab.category' },
  { id: 'method', labelKey: 'tx.tab.method' },
];

/**
 * 펼칠 때 한 번에 그릴 거래 수와, 다음 프레임마다 이어 그릴 만큼.
 *
 * **한 달을 통째로 펼치면 거래가 백 건을 넘는다.** 그것을 한 번에 그리면 그리는 일이
 * 0.5초 가까이 걸리고, 그동안 화면은 누른 것에 아무 반응을 못 한다 -- 누른 사람에게는
 * 앱이 멈춘 것으로 보인다. 값이 비싼 것은 글자를 만드는 일이 아니라 줄 하나하나를
 * 화면 요소로 세우는 일이라, 덜 만드는 것 말고는 줄일 방법이 없다.
 *
 * 그래서 첫 화면에 들어갈 만큼만 먼저 세우고 나머지는 프레임마다 잇는다. 누름은 곧바로
 * 반응하고, 이어지는 줄은 눈에 차오르는 것으로 보인다.
 */
const FIRST_CHUNK = 12;
const NEXT_CHUNK = 24;

/** 펼치고 접을 때의 움직임. 새로 선 줄은 옅은 데서 떠오르고 아래는 밀려 내려간다. */
const UNFOLD = LayoutAnimation.create(180, 'easeInEaseOut', 'opacity');

/**
 * 체크박스. RN 에는 없어서 그린다.
 *
 * 세 상태를 보인다. 빈 칸 / 체크 / 줄(일부만 고름). 년월 줄은 그 달의 거래 일부만
 * 골랐을 수 있어 셋이 필요하다.
 */
/**
 * 체크박스. RN 에는 없어서 그린다.
 *
 * 켜짐과 꺼짐 둘뿐이다. **반쯤 골라진 상태를 따로 그리지 않는다** -- 지우는 화면에서
 * 애매한 표시는 "이걸 누르면 무엇이 지워지는가"를 흐린다. 줄에 든 거래가 하나라도
 * 빠지면 꺼진 것으로 본다.
 */
function CheckBox({
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
}) {
  const { t } = useTranslation();
  const currency = useProjectDisplayCurrency();

  /*
   * 순수입 줄은 오간 돈이 있을 때만 선다. 이체만 있던 달은 수입도 지출도 0 이라
   * "순수입 0" 을 적어 봐야 위 줄의 "-" 를 되풀이할 뿐이다.
   */
  const net = income - expense;
  const showsNet = Boolean(showNet) && (income > 0 || expense > 0);

  return (
    <Pressable
      onPress={() => onPress(yearMonth, rowKey)}
      accessibilityRole="button"
      accessibilityState={{ expanded: Boolean(open) }}
      className="px-3 py-2"
    >
      <View className="flex-row items-center gap-2">
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
          <Text
            numberOfLines={1}
            className={`shrink text-gray-900 ${
              depth === 0 ? 'text-[15px] font-semibold' : 'text-sm font-medium'
            }`}
          >
            {label}
          </Text>
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
        <View className="w-[30%] shrink-0 flex-row justify-end">
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
        <View className="w-[30%] shrink-0 flex-row justify-end">
          {expense > 0 ? (
            <Text
              numberOfLines={1}
              style={TABULAR}
              className={`font-semibold text-red-600 ${AMOUNT_SIZE[depth]}`}
            >
              -{formatCurrency(expense, currency)}
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
    </Pressable>
  );
}

/**
 * 요일 색. 토요일은 파랑, 일요일은 빨강, 나머지는 제목과 같은 먹색이다.
 *
 * 달력이 주말을 그렇게 적어 왔으니 같은 규칙을 쓴다. 표로 두는 것은 줄마다 도는
 * 자리라 조건을 두 번 견주지 않기 위해서다.
 */
/**
 * 숫자를 같은 폭으로 그린다. 웹의 `tabular-nums` 와 같은 구실이다.
 *
 * 폰트가 정하는 대로 두면 1 이 다른 숫자보다 좁아, 위아래로 선 금액의 자릿수가
 * 조금씩 어긋난다. 오른쪽 끝을 맞춰도 쉼표 자리가 들쭉날쭉해 길이로 읽기 어렵다.
 */
const TABULAR = { fontVariant: ['tabular-nums' as const] };

const WEEKDAY_COLOR: Record<number, string> = { 0: 'text-red-600', 6: 'text-blue-600' };

/**
 * 값이 그대로면 다시 그리지 않는다.
 *
 * 거래를 프레임마다 이어 그리는 동안 이 줄들은 하나도 바뀌지 않는다. 그때 서른 개를
 * 통째로 다시 세우면 이어 그리기가 아낀 값을 그대로 도로 쓴다.
 */
const Line = memo(LineView);

export default function TransactionsScreen() {
  const { t } = useTranslation();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const canEdit = useCanEdit();
  const togglePersonId = useUserFilter((state) => state.togglePersonId);
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  const myPersonId = useMyPersonId();

  const tx = useTransactions(selectedProjectId);
  const { go } = useNavigation();
  /*
   * 보관함에 몇 건이 기다리는가.
   *
   * 목록은 보관함 화면이 그리지만 숫자는 여기 있어야 한다 -- 아이콘만 있으면 눌러
   * 보지 않고는 볼 것이 있는지 알 수 없다.
   */
  const inbox = useEntryDrafts(selectedProjectId, 'notification');
  const inboxCount = inbox.counts.notification + inbox.counts.capture;
  /*
   * 사람 목록과 선택을 이 프로젝트에 맞춘다.
   *
   * 가계 화면도 같은 일을 하지만 그쪽을 한 번도 열지 않고 여기로 바로 올 수 있다.
   * 맞추지 않으면 제목이 이름을 잃고, 저장해 둔 선택이 남의 프로젝트 것으로 남는다.
   */
  usePersonFilterSync(selectedProjectId, tx.people);
  /*
   * 분류·태그 상세에서 건너왔는지.
   *
   * 쪽지를 집어 들면서 곧바로 비우고(takeFocus), 돌아갈 자리는 이 화면이 제 것으로
   * 들고 있는다. 스토어에 남겨 두면 탭으로 떠났다 들어올 때 사용자가 그 사이에 고친
   * 검색이 처음 것으로 되돌아간다.
   */
  const focus = useEntryFocus((state) => state.focus);
  const takeFocus = useEntryFocus((state) => state.takeFocus);
  const requestReopen = useEntryFocus((state) => state.requestReopen);
  const restorePersonScope = useEntryFocus((state) => state.restorePersonScope);
  const [origin, setOrigin] = useState<EntryFocusOrigin | null>(null);

  /** 건너오면서 들고 온 검색을 건다. 한 번만 걸고 쪽지는 비운다. */
  useEffect(() => {
    if (!focus) return;
    setOrigin(focus.origin);
    tx.setSearch(focus.search);
    takeFocus();
  }, [focus, takeFocus, tx.setSearch]);

  /**
   * 떠나온 상세로 되돌아간다.
   *
   * 돌아갈 자리를 남기고 그 화면으로 보낸다. 그 화면이 쪽지를 보고 상세를 다시 편다.
   */
  const goBackToOrigin = () => {
    if (!origin) return;
    requestReopen(origin);
    go(ORIGIN_SCREEN[origin.kind]);
  };

  /*
   * 기기의 뒤로가기는 머리글의 ← 와 같은 일을 한다.
   *
   * 고르는 중이면 고르기를 그만두고(그때 머리글 왼쪽에 서는 것이 ← 다), 다른 화면에서
   * 건너왔으면 떠나온 상세로 돌아간다. 둘 다면 고르기를 먼저 그만둔다 -- 나중에 시작한
   * 것이 먼저 닫힌다.
   */
  useCloseOnBack(origin !== null, goBackToOrigin);
  useCloseOnBack(tx.isSelecting, tx.stopSelecting);

  /*
   * 이 화면을 벗어나면 좁혀 둔 자산주인 선택을 되돌린다.
   *
   * 자산의 구성원 상세에서 건너오면 그 사람만 고른 상태가 된다. ←로 돌아가든 탭으로
   * 떠나든 원래대로 두지 않으면, 다음에 자산·가계 화면을 열었을 때 한 사람만 남아
   * 있는 것을 사용자가 고른 적 없이 마주한다. 좁힌 것이 없으면 아무 일도 하지 않는다.
   */
  useEffect(() => restorePersonScope, [restorePersonScope]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /** 더보기 선택창. 태그와 삭제 둘이다. */
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  /** 고른 거래에 붙일 태그를 정하는 창. */
  const [isTagPickOpen, setIsTagPickOpen] = useState(false);
  /** 상세를 띄운 거래. null 이면 닫힌 상태다. */
  const [detail, setDetail] = useState<EntryListItem | null>(null);
  /**
   * 내용을 베껴 새로 적는 중인 거래. null 이면 베끼기로 연 팝업이 없다는 뜻이다.
   *
   * 이 화면은 거래를 만드는 자리가 아니라, 상세에서 베끼기나 고치기를 누른 동안만
   * 입력 팝업을 세운다 (그래서 둘 다 `null` 이면 편집기를 아예 그리지 않는다 --
   * 편집기는 고를 목록 다섯 벌을 따로 읽으므로, 늘 붙여 두면 이 화면이 이미 읽은
   * 것을 한 번 더 읽는다).
   */
  const [copying, setCopying] = useState<EntryListItem | null>(null);
  /** 고치는 중인 거래. 베끼기와 따로 든다 -- 편집기에 둘이 함께 가면 안 된다. */
  const [editing, setEditing] = useState<EntryListItem | null>(null);
  /** 지우다 남은 것 같은 알림. 빈 글자면 아무것도 그리지 않는다. */
  const [notice, setNotice] = useState('');

  /*
   * 탭 막대의 폭. 흰 알약이 어디로 미끄러질지 이 값으로 센다.
   *
   * 글자 길이가 언어마다 달라 미리 적어 둘 수 없다(날짜/Date/日付). 그려진 뒤 재고,
   * 화면을 돌리면 다시 잰다.
   */
  /*
   * 지금까지 그리기로 한 거래 수. 프레임마다 늘어난다.
   *
   * `wantedEntries` 는 이번에 그리려던 전부다. 그것이 예산을 넘으면 아래 효과가 다음
   * 프레임에 예산을 늘려, 남은 줄이 이어 선다.
   */
  const [budget, setBudget] = useState(FIRST_CHUNK);
  const wantedEntries = useRef(0);
  wantedEntries.current = 0;

  useEffect(() => {
    if (wantedEntries.current <= budget) return;

    const frame = requestAnimationFrame(() => setBudget((room) => room + NEXT_CHUNK));
    return () => cancelAnimationFrame(frame);
  });

  /*
   * 예산을 **지금 그려 둔 만큼**으로 되돌린다. 펼치고 접을 때마다 부른다.
   *
   * 되돌리지 않으면 한 달을 펼쳤다 접고 다른 달을 펼칠 때 예산이 이미 커져 있어, 그
   * 달도 한 번에 다 그린다 -- 곧 처음의 멈춤이 그대로 돌아온다.
   *
   * 그렇다고 `FIRST_CHUNK` 로 깎으면 안 된다. 앱은 화면 전체가 껍데기의 스크롤 하나라
   * (`shell/AppShell`) 이미 그려 둔 줄이 열두 개로 줄어드는 순간 내용이 화면보다
   * 짧아지고, ScrollView 는 갈 곳 없는 스크롤을 맨 위로 자른다 -- 아래쪽에서 년월 줄을
   * 눌렀을 뿐인데 화면이 첫 달로 튀어 오른다. 그려 둔 것은 그대로 두고 새로 필 것만
   * 차례로 세우면, 내용은 늘기만 하므로 보던 자리가 그대로 남는다.
   */
  const restartBudget = useCallback(
    () => setBudget((room) => Math.min(wantedEntries.current, room) + FIRST_CHUNK),
    [],
  );

  /** 펼치고 접는 누름. 움직임을 걸고 예산을 다시 잡는다. */
  const unfoldMonth = useCallback(
    (yearMonth: string) => {
      LayoutAnimation.configureNext(UNFOLD);
      restartBudget();
      tx.cycleMonth(yearMonth);
    },
    [restartBudget, tx.cycleMonth],
  );
  const unfoldRow = useCallback(
    (yearMonth: string, key: string) => {
      LayoutAnimation.configureNext(UNFOLD);
      restartBudget();
      tx.toggleRow(yearMonth, key);
    },
    [restartBudget, tx.toggleRow],
  );

  /*
   * 범위 체크. 줄이 자기 자리를 되돌려 주므로 여기서 그 줄을 다시 찾는다.
   *
   * `toggleRange` 는 줄 전체(`TransactionRow`)를 받는다. 조회 조건을 그 줄로 좁히는 데
   * 분류·수단 열쇠가 필요해서다.
   */
  const toggleRowRange = useCallback(
    (yearMonth: string, key: string) => {
      const row = tx.rowsOf(yearMonth).find((candidate) => candidate.key === key);
      if (row) void tx.toggleRange(yearMonth, row);
    },
    [tx.rowsOf, tx.toggleRange],
  );
  const toggleMonthRange = useCallback(
    (yearMonth: string) => void tx.toggleRange(yearMonth),
    [tx.toggleRange],
  );

  /*
   * 거래 한 줄의 누름. 그릴 때마다 새로 만들지 않는다.
   *
   * `TransactionItem` 은 값이 그대로면 다시 그리지 않는데(memo), 여기서 화살표 함수를
   * 만들어 넘기면 그 값이 매번 새것이라 memo 가 헛돈다. 한 달을 통째로 펼치면 줄이
   * 200개까지 서므로 그 차이가 곧 버벅임이다.
   */
  const openDetail = useCallback((entry: EntryListItem) => setDetail(entry), []);
  const toggleEntry = useCallback(
    (entry: EntryListItem) => tx.toggleEntrySelected(entry.id),
    [tx.toggleEntrySelected],
  );

  /**
   * 지우기 전에 묻는다. 몇 건인지 함께 적는다.
   *
   * 년월 줄을 체크하면 수십 건이 한꺼번에 골라질 수 있다. 그 숫자를 보여 주지 않으면
   * 무엇을 지우는지 모르고 확인을 누른다.
   */
  const askDelete = () => {
    if (tx.selectedCount === 0) {
      setNotice(t('tx.deleteNone'));
      return;
    }

    Alert.alert(
      t('tx.deleteConfirm', { count: tx.selectedCount }),
      t('tx.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('entryForm.delete'),
          style: 'destructive',
          onPress: () => {
            void tx.deleteSelected().then(({ failed }) => {
              setNotice(failed > 0 ? t('tx.deleteFailed', { count: failed }) : '');
            });
          },
        },
      ],
    );
  };

  /**
   * 상세에서 이 거래 하나만 지운다.
   *
   * 고르기를 거치지 않는 길이라 건수를 적지 않고 한 번만 묻는다. 묻기 전에 상세를
   * 닫지 않는다 -- 취소했을 때 읽고 있던 거래가 사라지면 안 된다.
   */
  const askDeleteDetail = (entry: EntryListItem) => {
    Alert.alert(t('tx.detail.deleteConfirm'), t('tx.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('entryForm.delete'),
        style: 'destructive',
        onPress: () => {
          setDetail(null);
          void tx.deleteEntry(entry.id).then((deleted) => {
            setNotice(deleted ? '' : t('tx.deleteFailed', { count: 1 }));
          });
        },
      },
    ]);
  };

  const entryList = (yearMonth: string, key: string) => {
    // 한 번만 묻는다. 두 번 물으면 그 달을 날짜로 묶는 일이 줄마다 두 번씩 돈다.
    const entries = tx.entriesOf(yearMonth, key);

    // 예산에서 이 줄의 몫을 떼어 온다. 모자라면 앞에서부터 그만큼만 세운다.
    const taken = wantedEntries.current;
    wantedEntries.current = taken + entries.length;
    const shown =
      taken + entries.length <= budget ? entries : entries.slice(0, Math.max(0, budget - taken));

    return (
      <View className="bg-white">
        {tx.isLoadingRow(yearMonth, key) ? (
          <Text className="px-3 py-3 text-sm text-gray-500">{t('common.loading')}</Text>
        ) : entries.length === 0 ? (
          <Text className="px-3 py-3 text-sm text-gray-500">{t('feed.empty')}</Text>
        ) : (
          shown.map((entry) =>
            /*
             * 고르는 중에는 누름의 뜻이 바뀐다. 상세를 띄우는 대신 체크한다.
             *
             * TransactionItem 은 가계 화면도 쓰는 컴포넌트라 손대지 않고, 체크박스를
             * 옆에 세우고 누름만 갈아 끼운다.
             */
            tx.isSelecting ? (
              /*
               * 체크박스는 년월 줄·안쪽 줄과 같은 자리에 선다. 그 줄들은 px-3 안에서
               * 체크박스를 세우므로 여기도 pl-3 이다. 세 겹의 체크박스가 한 세로줄에
               * 서지 않으면 훑을 때 눈이 좌우로 흔들린다.
               *
               * TransactionItem 은 제 px-3 을 가지고 있어 그대로 두면 글자가 줄보다
               * 한 칸 더 들어간다. 그만큼 왼쪽으로 당겨 글자도 같은 자리에서 시작하게
               * 한다 -- 줄과 거래가 같은 세로줄에 서는 것은 이 화면의 규칙이다.
               */
              <View key={entry.id} className="flex-row items-center gap-2 pl-3">
                <CheckBox
                  checked={tx.isEntrySelected(entry.id)}
                  onPress={() => tx.toggleEntrySelected(entry.id)}
                />
                <View className="-ml-3 flex-1">
                  <TransactionItem entry={entry} onPress={toggleEntry} />
                </View>
              </View>
            ) : (
              <TransactionItem key={entry.id} entry={entry} onPress={openDetail} />
            ),
          )
        )}
      </View>
    );
  };

  /** 그 달의 안쪽 줄. 세 탭이 같은 모양으로 내려오므로 한 번만 적는다. */
  const level2 = (yearMonth: string) => {
    if (tx.isLoadingMonth(yearMonth)) {
      return <Text className="px-3 py-3 text-sm text-gray-500">{t('common.loading')}</Text>;
    }

    const rows = tx.rowsOf(yearMonth);
    if (rows.length === 0) {
      const emptyKey: MessageKey =
        tx.tab === 'date' ? 'tx.noDays' : tx.tab === 'category' ? 'tx.noCategories' : 'tx.noMethods';
      return <Text className="px-3 py-3 text-sm text-gray-500">{t(emptyKey)}</Text>;
    }

    return rows.map((row: TransactionRow, index: number) => {
      const open = tx.isRowOpen(yearMonth, row.key);

      /*
       * 줄도 예산에서 한 자리를 떼어 간다.
       *
       * 거래만 나눠 그리면 줄 서른 개는 여전히 한 번에 선다. 그것만으로 100ms 가 넘어,
       * 누른 뒤 첫 화면이 그만큼 늦는다. 줄까지 차례로 세우면 위에서 아래로 펼쳐지는
       * 것이 그대로 보인다.
       *
       * 차례가 아닌 줄도 **세기는 한다.** 세지 않으면 남은 것이 없다고 보고 예산이 더
       * 늘지 않아, 그 아래가 영영 서지 않는다.
       */
      const taken = wantedEntries.current;
      wantedEntries.current = taken + 1;
      if (taken >= budget) {
        if (open) wantedEntries.current += tx.entriesOf(yearMonth, row.key).length;
        return null;
      }

      /*
       * 펴 둔 줄과 다음 줄 사이에 파란 선을 긋는다.
       *
       * 거래내역이 끝나는 자리와 다음 줄이 시작하는 자리가 맞붙어 있어, 선이 없으면
       * 마지막 거래가 다음 줄에 딸린 것처럼 읽힌다. 바깥 테두리와 **같은 색**으로 두어
       * 그 상자 안의 칸막이임을 보인다 -- 테두리 색을 바꾸면 이 선도 함께 간다.
       * 혼자 다른 색으로 남으면 상자와 무관한 줄로 읽힌다.
       *
       * 접힌 줄 사이에는 긋지 않는다. 그 줄들은 한 줄 높이로 나란히 서 있어 선을
       * 넣으면 목록이 표가 된다 -- 나눌 것이 생기는 것은 사이에 거래내역이 끼어들
       * 때뿐이다. 마지막 줄 뒤에도 긋지 않는다. 그 자리는 상자의 아래 변이다.
       */
      const divided = open && index < rows.length - 1;

      return (
        <View
          key={`${tx.tab}-${row.key}`}
          className={divided ? 'border-b border-gray-200' : undefined}
        >
          <Line
            depth={1}
            label={row.label}
            weekday={row.weekday}
            meta={row.sub ?? (row.count === undefined ? undefined : t('tx.entryCount', { count: row.count }))}
            expense={row.expense}
            income={row.income}
            open={open}
            yearMonth={yearMonth}
            rowKey={row.key}
            checkable={tx.isSelecting}
            checked={tx.isSelecting ? tx.rowChecked(yearMonth, row.key) : false}
            checkPending={tx.isSelecting ? tx.isRangePending(yearMonth, row.key) : false}
            onToggle={toggleRowRange}
            onPress={unfoldRow}
          />
          {open ? entryList(yearMonth, row.key) : null}
        </View>
      );
    });
  };

  return (
    <View className="gap-4">
      {/*
        고르는 중에는 머리글이 통째로 바뀐다.
        뒤로가기 · 몇 개를 골랐는지 · 삭제. 제목과 검색은 그때 쓸 것이 아니다.
      */}
      {tx.isSelecting ? (
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={tx.stopSelecting}
            accessibilityLabel={t('common.back')}
            className="h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white active:bg-gray-50"
          >
            <ArrowLeft size={18} color="#4b5563" />
          </Pressable>

          {/*
            태그를 붙이러 왔으면 그 버튼이 왼쪽, 뒤로가기 옆에 선다.
            지우기는 오른쪽 끝이다 -- 되돌릴 수 없는 일이라 뒤로가기에서 멀어야 한다.
          */}
          {tx.selectPurpose === 'tag' ? (
            <Pressable
              onPress={() => setIsTagPickOpen(true)}
              disabled={tx.isTagging}
              accessibilityLabel={t('tx.tagSelected')}
              className={`h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white active:bg-blue-50 ${
                tx.isTagging ? 'opacity-50' : ''
              }`}
            >
              <Tag size={18} color="#2563eb" />
            </Pressable>
          ) : null}

          <Text className="flex-1 text-base font-semibold text-gray-900">
            {t('tx.selected', { count: tx.selectedCount })}
          </Text>

          {tx.selectPurpose === 'delete' ? (
            <Pressable
              onPress={askDelete}
              disabled={tx.isDeleting}
              accessibilityLabel={t('tx.deleteSelected')}
              className={`h-9 w-9 items-center justify-center rounded-lg border border-red-300 bg-white active:bg-red-50 ${
                tx.isDeleting ? 'opacity-50' : ''
              }`}
            >
              <Trash2 size={18} color="#dc2626" />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <PageHeader
          /*
            분류·태그 상세에서 건너왔으면 ← 가 선다. 누르면 떠나온 상세가 다시 펴진다.
            평소의 거래 화면은 아래 탭에 있는 자리라 돌아갈 곳이 없다.
          */
          onBack={origin ? goBackToOrigin : undefined}
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
            <View className="flex-row gap-2">
              {/*
                보관함. 검색 왼쪽에 둔다.

                아직 거래가 아닌 후보가 쌓이는 자리라 거래 화면에서 들어가는 것이
                맞다 -- 그 후보가 되려는 것이 이 화면의 줄이다. 대기 건수는 옆에
                숫자로 붙인다(검색 개수와 같은 모양이다).
              */}
              <Pressable
                onPress={() => go('/transactions/inbox')}
                accessibilityLabel={t('inbox.open')}
                className="flex-row items-center gap-1.5 px-2 py-2"
              >
                <Archive size={18} color={inboxCount > 0 ? '#2563eb' : '#4b5563'} />
                {inboxCount > 0 ? (
                  <Text className="text-sm font-semibold text-blue-600">{inboxCount}</Text>
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => setIsSearchOpen(true)}
                accessibilityLabel={t('tx.search')}
                /*
                  아이콘만 둔다. 테두리·바탕도, 누를 때의 바탕도 없다. 머리글에서
                  이름 옆에 붙는 자리라 상자를 그리면 아이콘보다 상자가 먼저 보인다.
                  걸어 둔 검색이 있다는 신호는 파란 돋보기와 그 옆 숫자가 맡는다.
                */
                className="flex-row items-center gap-1.5 px-2 py-2"
              >
                {/* 돋보기만 둔다. 몇 개를 걸어 두었는지는 옆에 숫자로 붙인다. */}
                <Search size={18} color={tx.searchCount > 0 ? '#2563eb' : '#4b5563'} />
                {tx.searchCount > 0 ? (
                  <Text className="text-sm font-semibold text-blue-600">{tx.searchCount}</Text>
                ) : null}
              </Pressable>
              {/*
                더보기에는 쓰는 일만 들어 있다(태그 붙이기·지우기). 읽기 전용
                구성원에게는 열 것이 없으므로 버튼째 감춘다.
              */}
              {canEdit ? (
                <Pressable
                  onPress={() => setIsMoreOpen(true)}
                  accessibilityLabel={t('tx.more')}
                  className="items-center justify-center p-2"
                >
                  <MoreVertical size={18} color="#4b5563" />
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}

      {tx.hasError ? (
        <View className="rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-800">{t('tx.loadFailed')}</Text>
        </View>
      ) : null}

      {notice ? (
        <View className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <Text className="text-sm text-amber-800">{notice}</Text>
        </View>
      ) : null}

      {/* 보기 방식. 년월 목록 위에 두어 어떤 기준으로 파고드는지 먼저 정한다. */}
      <SegmentedTabs
        tabs={TABS.map((item) => ({ id: item.id, label: t(item.labelKey) }))}
        selected={tx.tab}
        onSelect={tx.changeTab}
      />

      {/*
        걸려 있는 조건. 탭 바로 아래에 둔다.

        검색 창을 열어야 무엇을 골랐는지 알 수 있으면, 결과가 비었을 때 이유를 찾으려
        창을 다시 열게 된다. 여기 늘어놓으면 그 걸음이 사라지고, 하나만 빼는 일도
        창을 열지 않고 끝난다.

        많아지면 가로로 굴린다. 줄바꿈으로 두면 조건이 열 개 넘을 때 목록이 화면 밖으로
        밀린다.
      */}
      {tx.searchChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          /*
           * 늘어나지 않게 못 박는다. ScrollView 는 기본 스타일에 flexGrow:1 이 있어
           * 세로로 늘어선 칸 안에서 남는 높이를 먹는다. 알약 줄은 알약 높이면 된다.
           */
          className="grow-0"
          contentContainerClassName="flex-row items-center gap-2 pr-4"
        >
          {tx.searchChips.map((chip) => (
            <Pressable
              key={chip.id}
              onPress={() => tx.removeSearchChip(chip.id)}
              // 손가락이 닿는 자리라 알약 자체를 누르게 한다. x 만 누르게 하면 빗나간다.
              accessibilityLabel={`${chip.label} ${t('tx.search.chipRemove')}`}
              className="flex-row items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-1.5 pl-3 pr-2 active:bg-blue-100"
            >
              <Text className="text-sm font-medium text-blue-700">{chip.label}</Text>
              <X size={14} color="#1d4ed8" />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View className="overflow-hidden rounded-lg">
        {tx.isLoadingMonths && tx.months.length === 0 ? (
          <Text className="p-3 text-sm text-gray-500">{t('common.loading')}</Text>
        ) : tx.months.length === 0 ? (
          <Text className="p-3 text-sm text-gray-500">{t('tx.noMonths')}</Text>
        ) : (
          tx.months.map((month, index) => {
            const level = tx.levelOf(month.yearMonth);
            /*
             * 년월 줄끼리 맞붙는 자리에 선을 긋는다. (웹의 같은 자리와 같은 규칙이다.)
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
              <View
                key={month.yearMonth}
                className={touchesPrevious ? 'border-t border-gray-200' : undefined}
              >
                <Line
                  depth={0}
                  label={monthLabel(month.yearMonth)}
                  expense={toNumber(month.expense)}
                  income={toNumber(month.income)}
                  open={level >= 1}
                  yearMonth={month.yearMonth}
                  rowKey=""
                  /*
                    순수입은 검색을 걸지 않았을 때만 적는다.

                    검색을 켜면 이 줄의 수입·지출은 걸린 거래만 센 값이라, 그 차액은
                    그 달에 남은 돈이 아니라 "골라 낸 것들의 차액"이다. 같은 자리에
                    같은 낱말로 적히면 달의 순수입으로 읽힌다.
                  */
                  showNet={tx.searchCount === 0}
                  checkable={tx.isSelecting}
                  checked={tx.isSelecting ? tx.monthChecked(month.yearMonth) : false}
                  checkPending={tx.isSelecting ? tx.isRangePending(month.yearMonth) : false}
                  onToggle={toggleMonthRange}
                  onPress={unfoldMonth}
                />
                {/*
                    펼친 것을 테두리로 두른다. "여기서 여기까지가 그 달의 것" 을
                    네 변이 말한다.

                    한때 파랑이었다. 회색 테두리가 이 화면에서 걷어낸 상자와 같은
                    색이라, 그 색으로 두르면 지운 상자가 되돌아온 것처럼 보이고 안에
                    든 거래내역의 흰 상자와도 겹으로 읽힐 것을 걱정해서였다. 웹에서
                    회색으로 바꿔 눈으로 견준 결과 그렇게 보이지 않아, 년월 줄 사이의
                    구분선과 같은 회색으로 두었다 -- 이 화면에서 선을 긋는 자리는
                    모두 한 색이고, 파랑은 "지금 고른 것"(알약·단추)에만 남는다.

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
                  <View className="mb-2 overflow-hidden rounded-lg border border-gray-200">
                    {level2(month.yearMonth)}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <TagPickModal
        isOpen={isTagPickOpen}
        onClose={() => setIsTagPickOpen(false)}
        tags={tx.pickerTags}
        count={tx.selectedCount}
        isSubmitting={tx.isTagging}
        commonTagIds={tx.commonTagIds}
        partialTagIds={tx.partialTagIds}
        onApply={(addTagIds, removeTagIds) => {
          void tx.tagSelected(addTagIds, removeTagIds).then(({ tagged, failed }) => {
            setIsTagPickOpen(false);
            /*
             * 결과를 글자로 알린다. 목록이 다시 그려지는 데 잠깐 걸려, 아무 말이 없으면
             * 눌린 것인지 알 수 없다. 0건은 "이미 다 붙어 있었다"는 뜻이라 따로 적는다.
             */
            if (failed) setNotice(t('tx.tagFailed'));
            else if (tagged === 0) setNotice(t('tx.tagNothingNew'));
            else setNotice(t('tx.tagDone', { count: tagged }));
          });
        }}
      />

      <TransactionSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onApply={tx.setSearch}
        current={tx.search}
        categories={tx.pickerCategories}
        accounts={tx.pickerAccounts}
        cards={tx.pickerCards}
        tags={tx.pickerTags}
        people={tx.people}
      />

      {/*
        더보기 선택창. 지금은 삭제 하나뿐이라 목록 하나로 둔다.
        메뉴가 늘면 이 자리에 줄을 더한다.
      */}
      <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} title={t('tx.more')}>
        {/*
          태그가 위, 지우기가 아래다. 되돌릴 수 있는 일을 먼저 둔다 -- 손가락이
          닿는 목록에서 지우기가 위에 있으면 잘못 누를 때의 값이 크다.
        */}
        <Pressable
          onPress={() => {
            setIsMoreOpen(false);
            setNotice('');
            tx.startSelecting('tag');
          }}
          className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-gray-50"
        >
          <Tag size={18} color="#2563eb" />
          <Text className="text-base text-gray-900">{t('tx.tagSelect')}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setIsMoreOpen(false);
            setNotice('');
            tx.startSelecting('delete');
          }}
          className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-gray-50"
        >
          <Trash2 size={18} color="#dc2626" />
          <Text className="text-base text-gray-900">{t('tx.select')}</Text>
        </Pressable>
      </Modal>

      <EntryDetailModal
        entry={detail}
        onClose={() => setDetail(null)}
        /*
          읽기 전용 구성원에게는 베끼기·고치기 단추가 없다. 상세는 그대로 읽을 수 있다.
          상세를 닫고 입력 팝업을 세운다 -- 팝업 둘이 겹쳐 뜨면 뒤로가기가 어느 것을
          닫는지 알 수 없다.
        */
        onCopy={
          canEdit
            ? (entry) => {
                setDetail(null);
                setNotice('');
                setCopying(entry);
              }
            : undefined
        }
        onEdit={
          canEdit
            ? (entry) => {
                setDetail(null);
                setNotice('');
                setEditing(entry);
              }
            : undefined
        }
        onDelete={canEdit ? askDeleteDetail : undefined}
      />

      {/*
        입력 팝업. 베끼면 새 거래가 되고, 고치면 그 거래가 고쳐진다.

        둘을 한 자리에서 세우되 상태는 나눠 든다 -- `editing` 과 `copying` 을 함께
        넘기면 편집기가 고치기를 택하므로, 베끼려던 것이 조용히 원본 수정이 된다.
      */}
      {copying || editing ? (
        <EntryEditor
          isOpen
          copying={copying}
          editing={editing}
          onClose={() => {
            setCopying(null);
            setEditing(null);
          }}
          /* 거래가 생기거나 바뀌었으므로 달·줄·목록을 다시 읽는다. 오프라인이면 사본에서 온다. */
          onSaved={tx.reload}
          onNotEditable={() => setNotice(t('editor.notEditable'))}
        />
      ) : null}
    </View>
  );
}

/** "2026-08" 을 화면의 달 이름으로. core 의 형식기는 숫자 둘을 받는다. */
function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return formatYearMonth(year, month);
}
