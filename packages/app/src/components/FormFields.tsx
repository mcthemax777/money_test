/*
 * 폼의 두 조각: 이름표가 붙은 칸과, 하나를 고르는 알약 줄.
 *
 * 거래 추가 팝업과 반복 등록 팝업이 함께 쓴다. 두 벌로 두면 한쪽만 고쳐져 같은 폼이
 * 화면마다 다르게 보인다 -- 고른 칸의 파란 테두리 같은 것이 특히 그렇다.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

export function Field({
  label,
  invalid,
  children,
}: {
  label: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text className={`mb-2 text-sm font-medium ${invalid ? 'text-red-600' : 'text-gray-700'}`}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/**
 * 고르는 알약 줄.
 *
 * 목록이 길면 옆으로 넘긴다. 접어 두면 무엇을 고를 수 있는지 열어 봐야 알고, 세로로
 * 쌓으면 폼이 화면 몇 개 길이가 된다.
 */
export function Chips({
  options,
  selected,
  onSelect,
  revealSelected = false,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  /**
   * 고른 칸이 줄 밖에 있으면 보이는 자리까지 민다.
   *
   * 서른한 개짜리 날짜 줄처럼 목록이 길 때 켠다. 켜지 않으면 줄은 늘 맨 앞부터
   * 보여서, 25일을 골라 둔 폼이 "아무것도 고르지 않은" 것처럼 보인다.
   */
  revealSelected?: boolean;
}) {
  const scroller = useRef<ScrollView>(null);
  /** 알약이 그려진 자리. 그려 봐야 알 수 있어서(글자 길이가 언어마다 다르다) 담아 둔다. */
  const positions = useRef(new Map<string, number>());

  const reveal = useCallback((value: string) => {
    const x = positions.current.get(value);
    if (x === undefined) return;
    // 앞에 한 뼘 남긴다. 딱 맞춰 대면 앞에 더 있는지가 보이지 않는다.
    scroller.current?.scrollTo({ x: Math.max(0, x - 16), animated: false });
  }, []);

  /*
   * 고름이 바뀔 때 민다.
   *
   * 처음 그릴 때는 자리를 아직 몰라 아무 일도 하지 않는다. 그때는 아래 onLayout 이
   * 자리를 알게 된 그 자리에서 민다.
   */
  useEffect(() => {
    if (revealSelected) reveal(selected);
  }, [revealSelected, selected, reveal]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2"
    >
      {options.map((option) => {
        const isSelected = option.value === selected;

        return (
          <Pressable
            key={option.value || 'none'}
            onPress={() => onSelect(option.value)}
            onLayout={(event) => {
              positions.current.set(option.value, event.nativeEvent.layout.x);
              if (revealSelected && isSelected) reveal(option.value);
            }}
            /* 고른 칸 표시는 언어 설정·분류 목록과 같은 값을 쓴다. */
            className={`rounded-lg border px-3 py-2 ${
              isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
            }`}
          >
            <Text
              className={`text-sm ${isSelected ? 'font-medium text-blue-600' : 'text-gray-700'}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
