/*
 * 설정 값 하나를 보여 주는 줄과, 눌렀을 때 뜨는 고르기 팝업.
 *
 * 설정 화면(언어·시작 요일·환율)과 프로젝트 관리(타임존·표시 통화·구성원 중 나)가 함께 쓴다.
 * 고를 것을 화면에 다 늘어놓으면 알약이 여러 줄을 먹어 정작 무엇으로 되어 있는지가
 * 묻힌다. 줄에는 지금 값만 적고, 바꾸는 일은 팝업에서 한다.
 */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';

import Modal from './Modal';

/**
 * 설정 한 줄. 왼쪽에 이름과 설명, 오른쪽에 지금 값과 `›` 를 둔다.
 *
 * `compact` 는 프로젝트 카드 안의 칸이다. 카드 안이라 글자가 한 단계 작고, 흰 상자 대신
 * 윗줄로 앞 칸과 가른다.
 */
export function SettingRow({
  title,
  description,
  value,
  onPress,
  disabled = false,
  compact = false,
  children,
}: {
  title: string;
  description?: string;
  /** 지금 값. 길면 한 줄에서 자른다. */
  value: string;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
  /** 줄 아래에 붙는 것 (저장 실패 문구 따위). */
  children?: ReactNode;
}) {
  return (
    <View
      className={compact ? 'mt-4 border-t border-gray-100 pt-4' : 'rounded-lg bg-white shadow-sm'}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        className={`flex-row items-center gap-3 ${
          compact ? 'rounded-lg active:bg-gray-50' : 'rounded-lg p-6 active:bg-gray-50'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        <View className="flex-1">
          <Text className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-gray-900`}>
            {title}
          </Text>
          {description ? (
            <Text className={`mt-1 ${compact ? 'text-xs text-gray-500' : 'text-sm text-gray-600'}`}>
              {description}
            </Text>
          ) : null}
        </View>
        <View className="max-w-[45%] flex-row items-center gap-1">
          <Text
            numberOfLines={1}
            className={`shrink ${compact ? 'text-sm' : 'text-base'} font-medium text-blue-600`}
          >
            {value}
          </Text>
          <ChevronRight size={18} color="#9ca3af" />
        </View>
      </Pressable>
      {children ? <View className={compact ? '' : 'px-6 pb-6'}>{children}</View> : null}
    </View>
  );
}

/**
 * 여럿 가운데 하나를 고르는 팝업. 고른 줄에는 파란 바탕과 체크가 선다.
 *
 * 누르면 곧바로 고르고 닫는다. 저장은 부르는 쪽이 맡고, 실패하면 그 문구는 줄 아래에
 * 남는다 -- 팝업은 이미 닫혔으므로 거기에 적으면 아무도 보지 못한다.
 */
export function OptionModal<T extends string | number>({
  isOpen,
  onClose,
  title,
  description,
  options,
  value,
  onSelect,
  footnote,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  options: Array<{ value: T; label: string }>;
  /** 지금 값. 목록에 없는 값이거나 null 이면 아무 줄도 고른 것으로 칠하지 않는다. */
  value: T | null;
  onSelect: (value: T) => void;
  /** 목록 아래의 덧붙임 (장부 통화 안내 따위). */
  footnote?: string;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {description ? <Text className="mb-4 text-sm text-gray-600">{description}</Text> : null}
      <View className="overflow-hidden rounded-lg border border-gray-200">
        {options.map((option, index) => {
          const selected = option.value === value;

          return (
            <Pressable
              key={String(option.value) || 'none'}
              onPress={() => {
                onClose();
                if (!selected) onSelect(option.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`flex-row items-center justify-between px-4 py-3 ${
                index > 0 ? 'border-t border-gray-100' : ''
              } ${selected ? 'bg-blue-50' : 'active:bg-gray-50'}`}
            >
              <Text
                className={`text-base ${selected ? 'font-medium text-blue-700' : 'text-gray-900'}`}
              >
                {option.label}
              </Text>
              {selected ? <Check size={18} color="#2563eb" /> : null}
            </Pressable>
          );
        })}
      </View>
      {footnote ? <Text className="mt-3 text-xs text-gray-400">{footnote}</Text> : null}
    </Modal>
  );
}
