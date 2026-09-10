/*
 * 폼의 조각들: 이름표가 붙은 칸, 하나를 고르는 알약 줄, 분류 알약.
 *
 * 거래 추가 팝업과 반복 등록 팝업이 함께 쓴다. 두 벌로 두면 한쪽만 고쳐져 같은 폼이
 * 화면마다 다르게 보인다 -- 고른 칸의 파란 테두리 같은 것이 특히 그렇다.
 *
 * **알약(`Chip`)은 검색 창과 같은 것을 쓴다.** 같은 것을 고르는 자리가 화면마다 다르게
 * 보이면 사용자는 그 둘이 다른 것이라고 읽는다.
 */
import { Fragment, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import type { CategoryDto } from '@money/types';

import { groupCategories } from '@money/core/lib/category-tree';

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
 * 하나를 고르는 **선택박스**. 접힌 칸을 누르면 목록이 아래로 펼쳐진다.
 *
 * 고를 것이 많은 자리에 쓴다. 알약 줄(`Chips`)은 서른한 개를 늘어놓으면 다섯 줄을
 * 먹어 그 아래 칸들이 화면 밖으로 밀린다. 접어 두면 답한 칸은 한 줄이고, 펼친 목록은
 * 정해진 높이(최대 240) 안에서 굴러간다.
 *
 * 목록을 안에서 굴린다(ScrollView). 다 펼쳐 두면 서른한 줄이 1300 픽셀이라 팝업을
 * 통째로 밀어 내린다 -- 무엇을 고르려다 왔는지 잊게 되는 높이다.
 *
 * 웹의 `<select>` 자리다. RN 에는 그것이 없어 같은 일을 하는 칸을 손으로 만든다.
 */
export function Select({
  value,
  options,
  onSelect,
  placeholder,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
  /** 고른 것이 없을 때 접힌 칸에 적을 글자 */
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const picked = options.find((option) => option.value === value);

  return (
    <View>
      <Pressable
        onPress={() => setIsOpen((open) => !open)}
        accessibilityRole="button"
        className="flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-3 active:bg-gray-50"
      >
        <Text className={`text-base ${picked ? 'text-gray-900' : 'text-gray-400'}`}>
          {picked?.label ?? placeholder ?? ''}
        </Text>
        {/* 펼침 표시. 열려 있으면 뒤집어 지금 상태를 보인다. */}
        <ChevronDown size={18} color="#6b7280" style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }} />
      </Pressable>

      {isOpen ? (
        <View className="mt-1 max-h-60 overflow-hidden rounded-lg border border-gray-300">
          <ScrollView>
            {options.map((option) => (
              <Pressable
                key={option.value || 'none'}
                onPress={() => {
                  onSelect(option.value);
                  setIsOpen(false);
                }}
                className={`px-3 py-3 ${option.value === value ? 'bg-blue-50' : 'active:bg-gray-50'}`}
              >
                <Text
                  className={`text-base ${
                    option.value === value ? 'font-medium text-blue-700' : 'text-gray-900'
                  }`}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** 고를 수 있는 알약 하나. 고른 것은 파란 알약이다 (검색 창과 같은 값을 쓴다). */
export function Chip({
  label,
  selected,
  onPress,
  color,
  subtle,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 태그의 색. 그 밖의 알약은 색이 없다. */
  color?: string | null;
  /**
   * 소분류처럼 한 단 아래인 알약.
   *
   * 테두리를 감추고 글자를 얇게 한다. 크기는 그대로다 -- 대분류가 먼저 눈에 들어오되
   * 줄이 밀리지 않아야 한다. 상태가 아니라 **자리**에 따른 차이라 눌러도 달라지지 않는다.
   * 고른 소분류는 파란 테두리가 다시 보인다. 골랐다는 것은 보여야 한다.
   */
  subtle?: boolean;
}) {
  /*
   * **누른다고 크기가 달라지지 않는다.** 테두리 굵기도 글자 굵기도 상태와 무관하게 같고,
   * 고른 것은 색으로만 말한다. 굵어지면 그만큼 넓어져, 한 알약을 켰을 뿐인데 옆의
   * 알약이 다음 줄로 밀린다.
   */
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
        selected
          ? 'border-blue-600 bg-blue-50'
          : subtle
            ? // 테두리를 없애지 않고 **투명하게** 둔다. 굵기가 그대로라 줄바꿈 자리가 움직이지 않는다.
              'border-transparent bg-white'
            : 'border-gray-300 bg-white'
      }`}
    >
      {color ? (
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      ) : null}
      <Text
        className={`text-sm ${subtle ? 'font-light' : ''} ${
          selected ? 'text-blue-600' : subtle ? 'text-gray-500' : 'text-gray-700'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 알약 사이의 가름표. 대분류 뒤의 `›` 와 묶음 끝의 `/`.
 *
 * 누를 수 없는 글자다. 상자 대신 이것으로 묶음의 경계를 말한다. 대분류 뒤는 꺾쇠다 --
 * 뒤따르는 것이 그 아래 소분류임이 한눈에 읽힌다.
 */
export function Divider({ mark }: { mark: '›' | '/' }) {
  return <Text className="text-sm text-gray-300">{mark}</Text>;
}

/**
 * 하나를 고르는 알약 줄.
 *
 * **접히는 줄이다. 옆으로 넘기지 않는다.** 예전에는 한 줄에 담고 옆으로 밀게 두었는데,
 * 그러면 화면 밖에 무엇이 더 있는지 보이지 않아 고르기 전에 밀어 봐야 알고, 골라 둔
 * 것을 다시 찾으려면 또 밀어야 한다. 검색 창처럼 다 펼쳐 두면 한눈에 다 보인다.
 */
export function Chips({
  options,
  selected,
  onSelect,
  collapse = false,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  /**
   * 고르면 **고른 것만 남기고 나머지를 접는다.** 다시 누르면 풀리고 목록이 돌아온다.
   *
   * 목록이 긴 칸(사람·결제수단·분류)에서 켠다. 다 펼쳐 두면 무엇을 고를 수 있는지는
   * 보이지만, 고른 뒤에는 그 열 몇 줄이 그대로 남아 아래 칸들을 화면 밖으로 밀어낸다.
   * 접으면 답한 칸은 한 줄로 줄고 남은 자리는 아직 답하지 않은 칸이 쓴다.
   *
   * 짧은 칸(유형·통화·할부)에는 켜지 않는다. 줄일 것이 없고, 옆에 무엇이 있었는지
   * 보이는 편이 바꾸기 쉽다.
   */
  collapse?: boolean;
}) {
  /*
   * 접었을 때 남는 알약. 빈 값은 접지 않는다 -- "고르지 않음"을 고른 것은 고른 것이
   * 아니고, 그때 목록을 감추면 고를 방법이 없어진다.
   */
  const picked = collapse && selected ? options.find((option) => option.value === selected) : null;

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {(picked ? [picked] : options).map((option) => (
        <Chip
          key={option.value || 'none'}
          label={option.label}
          selected={option.value === selected}
          // 접힌 알약을 다시 누르면 고름이 풀리고 목록이 돌아온다.
          onPress={() => onSelect(picked ? '' : option.value)}
        />
      ))}
    </View>
  );
}

/**
 * 분류를 고르는 알약. **대분류와 소분류를 갈라 그린다** (검색 창과 같은 짜임새다).
 *
 * 평평하게 늘어놓고 이름에 "식비 › 외식" 처럼 대분류를 붙이던 자리다. 이름이 길어져 한
 * 알약이 두 줄을 먹고, 같은 대분류의 소분류가 여기저기 흩어져 보였다. 묶어 그리면 대분류
 * 한 알약 뒤에 그 소분류가 붙어 구조가 눈으로 읽힌다.
 *
 * 검색 창과 다른 것은 **하나만 고른다**는 점이다. 거래 하나에는 분류 하나가 붙고, 대분류도
 * 그대로 고를 수 있다(소분류 없이 대분류에만 적는 거래가 있다). 그래서 대분류를 눌러도
 * 소분류가 함께 걸리지 않는다.
 */
export function CategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryDto.Response[];
  selected: string;
  onSelect: (categoryId: string) => void;
}) {
  const groups = groupCategories(categories);

  /*
   * 고른 분류. **고르면 그것만 남기고 나머지를 접는다** (`Chips` 의 collapse 와 같은 뜻).
   *
   * 소분류를 골랐으면 대분류를 이름에 붙여 적는다 -- 알약 하나만 남으므로 "생일"만으로는
   * 어느 대분류의 것인지 알 수 없다. 접기 전에는 대분류 알약이 앞에 서서 그 일을 했다.
   */
  const picked = selected
    ? groups
        .flatMap((group) =>
          [group.parent, ...group.children].map((category) => ({ category, group })),
        )
        .find((row) => row.category?.id === selected)
    : null;

  if (picked?.category) {
    const parent = picked.category.parentId ? picked.group.parent : null;

    return (
      <View className="flex-row flex-wrap items-center gap-2">
        <Chip
          label={parent ? `${parent.name} › ${picked.category.name}` : picked.category.name}
          selected
          // 다시 누르면 고름이 풀리고 목록이 돌아온다.
          onPress={() => onSelect('')}
        />
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {groups.map((group, index) => (
        /*
          묶음을 상자로 싸지 않는다 (Fragment 다).

          싸면 그 묶음이 한 덩어리가 되어 통째로 다음 줄로 내려간다. 알약이 줄을 이어
          흐르고 가름표로만 경계를 말하는 것이 검색 창과 같은 모양이다.
        */
        <Fragment key={group.parent?.id ?? 'orphans'}>
          {group.parent ? (
            <Chip
              label={group.parent.name}
              selected={group.parent.id === selected}
              onPress={() => onSelect(group.parent!.id)}
            />
          ) : null}

          {group.parent && group.children.length > 0 ? <Divider mark="›" /> : null}

          {group.children.map((child) => (
            <Chip
              key={child.id}
              label={child.name}
              selected={child.id === selected}
              onPress={() => onSelect(child.id)}
              // 한 단 아래다. 옅게 그려 대분류가 먼저 읽히게 한다.
              subtle
            />
          ))}

          {/* 묶음의 끝. 마지막 묶음 뒤에는 가를 것이 없다. */}
          {index < groups.length - 1 ? <Divider mark="/" /> : null}
        </Fragment>
      ))}
    </View>
  );
}
