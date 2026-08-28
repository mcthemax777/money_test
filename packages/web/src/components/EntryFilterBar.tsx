'use client';

/**
 * 일반/과소비 항목. 둘 다 고르면 전체, 하나도 안 고르면 결과가 없다.
 *
 * 과소비는 금액이라 한 거래가 일부만 과소비일 수 있다. 그런 거래는 "과소비"에
 * 든다. 이 필터는 금액을 쪼개지 않고 거래를 고르는 것이다.
 */
export type ExtraType = 'normal' | 'extra';

const EXTRA_OPTIONS: Array<{ value: ExtraType; label: string }> = [
  { value: 'normal', label: '일반' },
  { value: 'extra', label: '과소비·추가수입' },
];

interface EntryFilterBarProps {
  selectedExtraTypes: ExtraType[];
  onToggleExtraType: (value: ExtraType) => void;
}

/**
 * 가계 화면의 조회 필터.
 *
 * 자산주인 필터는 화면 제목(PersonScopeTitle)이 겸한다. 여기 체크박스로 두었을
 * 때는 제목이 "가계"라고만 해서 누구의 가계를 보고 있는지 아래 줄을 봐야 알았다.
 *
 * 체크박스 여러 개로만 표현한다. 둘 다 체크하면 전체이고, 하나도 체크하지 않으면
 * 거래가 없는 상태다. "전체" 버튼을 따로 두면 체크 상태와 버튼이 서로 다른
 * 이야기를 하게 된다.
 *
 * 이 필터는 서버 조회 조건으로 넘어간다. 목록만 걸러 놓으면 상단 합계·차트와
 * 어긋나기 때문이다.
 */
export default function EntryFilterBar({
  selectedExtraTypes,
  onToggleExtraType,
}: EntryFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-4 p-3 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
          과소비 여부
        </span>
        {EXTRA_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedExtraTypes.includes(option.value)}
              onChange={() => onToggleExtraType(option.value)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
