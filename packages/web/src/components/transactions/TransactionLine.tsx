'use client';

/*
 * 거래 화면 목록의 한 줄(년월 줄·그 안의 줄)과, 고르는 중에 그 옆에 서는 체크박스.
 */
import { Check, Loader2 } from 'lucide-react';
import { isLongPeriodLabel, periodLabelLines } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProjectDisplayCurrency } from '@money/core/store/project';
import { useLongPress } from '@/hooks/useLongPress';

/**
 * 체크박스. 켜짐과 꺼짐 둘뿐이다.
 *
 * **반쯤 골라진 상태를 따로 그리지 않는다** -- 지우는 화면에서 애매한 표시는 "이걸
 * 누르면 무엇이 지워지는가"를 흐린다. 줄에 든 거래가 하나라도 빠지면 꺼진 것으로 본다.
 */
export function CheckBox({
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

/**
 * 한 줄. 오른쪽에 수입과 지출을 나란히 적는다.
 *
 * 한쪽만 적으면 이체가 섞인 달에서 줄의 금액과 아래를 펴서 나온 거래의 합이 어긋나
 * 보인다. 들어온 돈이 왼쪽, 나간 돈이 오른쪽이다 -- 나간 돈이 줄의 끝에 붙어 있어야
 * 여러 줄을 훑을 때 금액의 오른쪽 끝이 한 줄로 선다.
 *
 * 세로로 쌓지 않는다. 금액과 건수를 제목 옆에 같이 두어 **한 줄 높이**로 끝낸다.
 */
export function Line({
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
