/*
 * 상세 팝업의 읽기 전용 한 칸. 이름표 아래 회색 상자에 값을 적는다.
 *
 * 거래 상세와 자산(계좌·구성원·카드) 상세가 같은 모양을 쓴다.
 */
import type { ReactNode } from 'react';

export default function DetailField({
  label,
  valueClassName,
  children,
}: {
  label: string;
  /** 값 상자에 더할 글자 모양 (예: 잔액의 font-semibold). */
  valueClassName?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <p className={`px-3 py-2 bg-gray-50 rounded-lg text-gray-900${valueClassName ? ` ${valueClassName}` : ''}`}>
        {children}
      </p>
    </div>
  );
}
