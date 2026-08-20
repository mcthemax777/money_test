'use client';

import type { Person } from '@/lib/types';

/** 고정/변동 항목. 둘 다 고르면 전체, 하나도 안 고르면 결과가 없다. */
export type FixedType = 'fixed' | 'variable';

const FIXED_OPTIONS: Array<{ value: FixedType; label: string }> = [
  { value: 'fixed', label: '고정' },
  { value: 'variable', label: '변동' },
];

interface EntryFilterBarProps {
  people: Person[];
  /** 설정에서 지정한 "나". 이름 뒤에 표시만 한다. */
  myPersonId?: string | null;
  selectedPersonIds: string[];
  onTogglePerson: (personId: string) => void;
  selectedFixedTypes: FixedType[];
  onToggleFixedType: (value: FixedType) => void;
}

/**
 * 가계 화면의 조회 필터.
 *
 * 자산주인 필터는 예전에 사이드바에 있었지만 자산·카테고리·설정 화면에서는 쓰지 않았다.
 * 필터를 쓰는 화면 안으로 옮겨 두면 어디에 걸리는 필터인지 분명해진다.
 *
 * 기준은 거래를 입력한 사람이 아니라 돈이 오간 계좌의 주인이다. 이체는 보내는 계좌를 본다.
 *
 * 두 필터 모두 체크박스 여러 개로만 표현한다. 전부 체크하면 전체이고, 하나도
 * 체크하지 않으면 거래가 없는 상태다. "전체" 버튼을 따로 두면 체크 상태와 버튼이
 * 서로 다른 이야기를 하게 된다.
 *
 * 두 필터 모두 서버 조회 조건으로 넘어간다. 목록만 걸러 놓으면 상단 합계·차트와
 * 어긋나기 때문이다.
 */
export default function EntryFilterBar({
  people,
  myPersonId,
  selectedPersonIds,
  onTogglePerson,
  selectedFixedTypes,
  onToggleFixedType,
}: EntryFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-4 p-3 bg-white border border-gray-200 rounded-lg">
      <div className="flex flex-wrap items-center gap-3">
        {/* 기준이 "거래를 입력한 사람"이 아니라 "돈이 오간 계좌의 주인"이라 자산주인으로 적는다 */}
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
          자산주인
        </span>
        {people.map((person) => (
          <label key={person.id} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedPersonIds.includes(person.id)}
              onChange={() => onTogglePerson(person.id)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              {person.name}
              {person.id === myPersonId && <span className="text-xs text-blue-600"> (나)</span>}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
          고정 수입지출
        </span>
        {FIXED_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedFixedTypes.includes(option.value)}
              onChange={() => onToggleFixedType(option.value)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
