'use client';

import { CARD_COLOR_OPTIONS } from '@/lib/card-color';
import { useTranslation } from '@/lib/i18n';

interface CardColorPickerProps {
  /** 고른 색. 빈 문자열이면 카드 종류의 기본색을 쓴다. */
  value: string;
  onChange: (color: string) => void;
}

/**
 * 카드 앞면 색 고르기.
 *
 * 색 이름을 적은 셀렉트 대신 실제 앞면 색을 그대로 칠한 조각을 늘어놓는다.
 * 홈에서 이 색으로 카드가 보이므로, 고를 때도 그 모습이어야 한다.
 */
export default function CardColorPicker({ value, onChange }: CardColorPickerProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2">
      {CARD_COLOR_OPTIONS.map((option) => (
        <button
          key={option.color}
          type="button"
          onClick={() => onChange(option.color)}
          title={t(option.labelKey)}
          aria-label={t(option.labelKey)}
          aria-pressed={value === option.color}
          /* 하양·회색 조각은 폼 바탕에 녹으므로 조각마다 옅은 테두리를 함께 둔다. */
          className={`h-8 w-12 rounded-md border border-black/10 ${option.face} ${
            value === option.color
              ? 'ring-2 ring-offset-2 ring-gray-900'
              : 'opacity-80 hover:opacity-100'
          }`}
        />
      ))}
    </div>
  );
}
