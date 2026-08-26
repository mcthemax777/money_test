'use client';

interface CardPerformanceFieldProps {
  /** 세는 구간이 종류마다 달라서 안내 문구가 갈린다. */
  cardType: 'debit' | 'credit';
  value: string;
  onChange: (value: string) => void;
  /** 신용카드 마감일. 안내에 실제 구간을 적어 준다. 없으면 일반적인 설명만 한다. */
  statementClosingDay?: number;
}

/** 마감일이 N일이면 구간은 (N+1)일부터 다음 달 N일까지다. */
function statementHint(closingDay?: number): string {
  if (!closingDay) return '마감일 기준 청구 주기의 사용액으로 셉니다.';

  const nextDay = closingDay === 31 ? 1 : closingDay + 1;
  return `마감일(${closingDay}일) 기준 청구 주기로 셉니다. ${nextDay}일부터 다음 달 ${closingDay}일까지가 한 구간입니다.`;
}

/**
 * 카드 실적 기준액 입력.
 *
 * 카드 추가 폼이 세 곳(가계 화면, 자산 화면, 카드 수정)에 있고 셋 다 같은 값을
 * 받는다. 특히 안내 문구가 길고 카드 종류에 따라 갈려서, 따로 적어 두면 한 곳만
 * 고쳤을 때 화면마다 다른 설명이 남는다.
 *
 * 한도(creditLimit)와 달리 신용카드 전용이 아니다. 체크카드에도 실적 조건이 붙는
 * 카드가 있고, 그때는 달력 월로 센다.
 */
export default function CardPerformanceField({
  cardType,
  value,
  onChange,
  statementClosingDay,
}: CardPerformanceFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">실적 기준액</label>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="300000"
      />
      <p className="mt-1 text-xs text-gray-500">
        {cardType === 'credit' ? statementHint(statementClosingDay) : '달력 월(1일~말일)의 사용액으로 셉니다.'}{' '}
        비워 두면 실적을 보지 않습니다.
      </p>
    </div>
  );
}
