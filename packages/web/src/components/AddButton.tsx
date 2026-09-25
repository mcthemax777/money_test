'use client';

import { Plus } from 'lucide-react';

import { useCanEdit } from '@money/core/store/project';

/**
 * 목록 위에 놓는 "추가하기" 버튼.
 *
 * 점선 테두리와 흐린 글자다. 목록의 항목처럼 보이되 그 항목들과 다투지 않아야 해서
 * 채우지 않는다. 자리는 언제나 **그 목록 바로 위**다 -- 무엇에 더하는지가 버튼 아래에
 * 곧바로 이어져 보이고, 목록이 길어져도 버튼을 찾아 내려갈 일이 없다.
 *
 * 자산·분류·태그 화면이 함께 쓴다. 세 곳에 따로 두면 모양이 조금씩 갈린다.
 *
 * 읽기 전용 구성원에게는 그리지 않는다. 여기서 한 번 막으면 구성원·통장·카드·분류·태그의
 * 추가 버튼이 모두 함께 사라진다 -- 화면마다 같은 검사를 두지 않는 자리다.
 */
export default function AddButton({
  label,
  onClick,
  dense = false,
}: {
  label: string;
  onClick: () => void;
  /**
   * 한 단 더 안쪽의 목록에 쓰는 작은 모양 (계좌 칸 안의 "카드 추가").
   *
   * 이 버튼은 목록마다 하나씩 서므로, 통장이 예닐곱이면 같은 버튼이 그만큼 쌓여 정작
   * 통장·카드가 밀려난다. 줄 폭을 다 쓰지 않고 글자만큼만 차지하는 작은 표라, 자리도
   * 줄고 한 단 안쪽의 것이라는 차례도 보인다.
   */
  dense?: boolean;
}) {
  const canEdit = useCanEdit();
  if (!canEdit) return null;

  return (
    <button
      type="button"
      onClick={(event) => {
        // 목록의 항목 안에 있을 수 있다. 부모의 "고르기"까지 함께 눌리면 안 된다.
        event.stopPropagation();
        onClick();
      }}
      className={`flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 text-gray-500 transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 ${
        dense ? 'mb-1.5 px-2 py-0.5 text-xs' : 'mb-3 w-full px-3 py-2 text-sm'
      }`}
    >
      <Plus className={dense ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {label}
    </button>
  );
}
