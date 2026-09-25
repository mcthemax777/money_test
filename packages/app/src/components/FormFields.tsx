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
import { CalendarDays, ChevronDown, Clock } from 'lucide-react-native';
import type { CategoryDto } from '@money/types';

import { groupCategories } from '@money/core/lib/category-tree';
import { useTranslation } from '@money/core/lib/i18n';

export function Field({
  label,
  invalid,
  onAdd,
  addLabel,
  children,
}: {
  label: string;
  invalid?: boolean;
  /**
   * 이 칸에서 고를 것을 그 자리에서 만든다. 주면 이름표 오른쪽에 "+ 추가"가 선다.
   *
   * 적으려는 순간에야 "이 카드가 아직 없다"를 알게 되는 일이 잦다. 폼을 닫고 자산
   * 화면으로 건너가 만들고 돌아오면 적던 내용이 사라지므로, 고르는 칸마다 만드는
   * 길을 붙인다 (웹의 선택 상자 아래 "+ 추가"와 같은 자리다).
   */
  onAdd?: () => void;
  /**
   * 무엇을 만드는지. 단추에는 "+ 추가"만 서고 이 말은 읽어 주는 데만 쓴다 -- 이름표
   * 옆에 "구성원 추가"까지 적으면 같은 말이 한 줄에 두 번 선다.
   */
  addLabel?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <View>
      <View className="mb-2 flex-row items-center justify-between gap-2">
        <Text className={`text-sm font-medium ${invalid ? 'text-red-600' : 'text-gray-700'}`}>
          {label}
        </Text>
        {onAdd ? (
          <Pressable
            onPress={onAdd}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={addLabel ?? t('common.add')}
            className="rounded px-2 py-0.5 active:bg-blue-50"
          >
            <Text className="text-sm font-medium text-blue-600">+ {t('common.add')}</Text>
          </Pressable>
        ) : null}
      </View>
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
          {/*
            **`nestedScrollEnabled` 가 있어야 이 목록이 스스로 굴러간다.**

            팝업 본문이 이미 ScrollView 다(Modal). 안드로이드는 기본으로 안쪽
            ScrollView 에 손짓을 주지 않아서, 이것 없이 목록을 밀면 목록은 그대로
            있고 팝업 전체가 내려간다 -- 며칟날을 고르려다 결제수단 자리까지 밀려
            내려간다.

            켜 두면 안쪽이 먼저 먹고 남은 만큼만 바깥으로 넘어간다. 목록의 끝에
            닿으면 그 뒤로는 팝업이 이어 움직인다.
          */}
          <ScrollView nestedScrollEnabled>
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
  covered,
  onPress,
  color,
  subtle,
  sub,
}: {
  label: string;
  selected: boolean;
  /**
   * 고른 것은 아니지만 함께 걸리는 자리 (대분류를 켰을 때의 그 소분류).
   *
   * 파랗게 칠하지 않고 파란 글자만 남긴다. 켠 것과 같은 모양으로 두면 대분류 하나를
   * 눌렀을 때 아래가 전부 켜져 보여, 무엇을 골랐는지 화면에서 읽을 수 없다.
   */
  covered?: boolean;
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
  /**
   * 이름 뒤에 옅게 붙는 한 마디 (통장·카드의 주인).
   *
   * 접힌 알약에만 쓴다. 펼친 목록은 주인별 묶음의 머리글이 그 일을 하지만, 접히고 나면
   * 고른 것이 누구 것인지 화면에서 사라진다.
   */
  sub?: string;
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
          : covered
            ? 'border-blue-200 bg-white'
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
          selected
            ? 'text-blue-600'
            : covered
              ? 'text-blue-400'
              : subtle
                ? 'text-gray-500'
                : 'text-gray-700'
        }`}
      >
        {label}
        {sub ? <Text className="text-gray-500"> · {sub}</Text> : null}
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
  /**
   * 고를 것들. `group` 이 있으면 그 이름으로 묶어 그린다 (통장·카드의 주인).
   *
   * 묶음 이름은 목록이 이미 그 차례로 서 있다고 보고 **앞 항목과 달라지는 자리마다**
   * 머리글을 넣는다 (웹의 `CustomSelect` 와 같은 규칙). 섞여 오면 같은 이름이 여러 번
   * 선다 -- 세우는 일은 목록을 만드는 쪽이 한다 (core 의 `useEntryForm`).
   */
  options: Array<{ value: string; label: string; group?: string }>;
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

  /*
   * 접힌 한 알약. 묶음 이름을 옆에 옅게 달아 준다 -- 머리글이 함께 접혀 사라지므로
   * 그대로 두면 고른 것이 누구 것인지 알 수 없다 (분류 알약이 대분류를 붙이는 것과 같다).
   */
  if (picked) {
    return (
      <View className="flex-row flex-wrap items-center gap-2">
        <Chip
          label={picked.label}
          sub={picked.group}
          selected
          // 접힌 알약을 다시 누르면 고름이 풀리고 목록이 돌아온다.
          onPress={() => onSelect('')}
        />
      </View>
    );
  }

  const chipOf = (option: { value: string; label: string }) => (
    <Chip
      key={option.value || 'none'}
      label={option.label}
      selected={option.value === selected}
      onPress={() => onSelect(option.value)}
    />
  );

  if (!options.some((option) => option.group)) {
    return (
      <View className="flex-row flex-wrap items-center gap-2">{options.map(chipOf)}</View>
    );
  }

  return (
    <View className="gap-3">
      {groupChips(options).map((group) => (
        <View key={group.name ?? ''}>
          {/* 묶음 머리글. 고를 수 없는 정보라 알약이 아니다 (검색 창과 같은 모양이다). */}
          <Text className="mb-1.5 text-xs text-gray-500">{group.name ?? '-'}</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            {group.options.map(chipOf)}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * 앞 항목과 달라지는 자리마다 묶음을 연다. 차례는 받은 목록 그대로다.
 *
 * 묶음이 없는 항목은 이름 없는 묶음(`null`)으로 모인다 -- 조용히 버리면 주인을 알 수
 * 없는 통장이 목록에서 사라져 고를 수 없게 된다.
 */
function groupChips<T extends { group?: string }>(
  options: T[],
): Array<{ name: string | null; options: T[] }> {
  const groups: Array<{ name: string | null; options: T[] }> = [];

  for (const option of options) {
    const name = option.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.options.push(option);
    else groups.push({ name, options: [option] });
  }

  return groups;
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
          [group.parent, ...group.children].map((category) => ({
            category,
            group,
          })),
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

/**
 * 날짜·시각을 여는 칸. 값이 없으면 모양(YYYY-MM-DD)을 옅게 적는다.
 *
 * 검색 창의 기간 칸과 같은 모양이다 (`TransactionSearchModal` 의 DateButton). 열려 있는
 * 동안 테두리가 파래서, 아래 판이 어느 칸의 것인지 보인다.
 *
 * 거래 추가 팝업과 카드 대금 팝업이 함께 쓴다.
 */
export function PickerButton({
  icon,
  value,
  placeholder,
  isOpen,
  onPress,
}: {
  icon: 'date' | 'time';
  value: string;
  placeholder: string;
  isOpen: boolean;
  onPress: () => void;
}) {
  const Icon = icon === 'date' ? CalendarDays : Clock;

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-2 rounded-lg border bg-white px-3 py-3 ${
        isOpen ? 'border-blue-600' : 'border-gray-300'
      }`}
    >
      <Icon size={16} color={isOpen ? '#2563eb' : '#6b7280'} />
      <Text className={`text-base ${value ? 'text-gray-900' : 'text-gray-400'}`}>
        {value || placeholder}
      </Text>
    </Pressable>
  );
}
