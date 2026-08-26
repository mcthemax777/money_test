'use client';

import { useState, useRef, useEffect } from 'react';

interface Option {
  id: string;
  name: string;
  icon?: string; // 아이콘 경로 (선택)
  /**
   * 이 항목이 속한 묶음의 이름 (예: 계좌 주인). 값이 있으면 앞 항목과 달라지는
   * 자리마다 고를 수 없는 머리글 줄을 넣는다. 생략하면 묶음 없이 평평하게 그린다.
   */
  group?: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  onAddClick?: () => void;
  addButtonLabel?: string;
  /** 잠긴 값. 열리지 않고 회색으로 보인다 */
  disabled?: boolean;
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = '선택하세요',
  label,
  onAddClick,
  addButtonLabel = '추가',
  disabled = false,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.id === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-left flex justify-between items-center ${
          disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
        } ${!value ? 'text-gray-500' : 'text-gray-900'}`}
      >
        <span className="flex items-center gap-2 flex-1">
          {selectedOption?.icon && (
            <img src={selectedOption.icon} alt="" className="w-5 h-5" />
          )}
          <span>{selectedOption?.name || placeholder}</span>
        </span>
        {!disabled && (
          <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
        )}
      </button>

      {/* z-20: 팝업의 고정 헤더·하단 버튼(z-10)보다 위에 그린다. 같은 값이면 나중에
          나오는 하단 버튼이 목록을 덮었다. */}
      {isOpen && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 border border-gray-300 rounded-lg bg-white shadow-lg z-20">
          <div className="max-h-48 overflow-y-auto">
            {options.map((option, index) => (
              <div key={option.id}>
                {/* 묶음 머리글. 계좌 주인처럼 고를 수 없는 정보라 button이 아니다. */}
                {option.group && option.group !== options[index - 1]?.group && (
                  <div className="px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500 border-b border-gray-200">
                    {option.group}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left hover:bg-blue-50 cursor-pointer border-b border-gray-100 flex items-center gap-2 ${
                    value === option.id ? 'bg-blue-100 font-semibold' : ''
                  }`}
                >
                  {option.icon && (
                    <img src={option.icon} alt="" className="w-5 h-5" />
                  )}
                  <span>{option.name}</span>
                </button>
              </div>
            ))}
          </div>

          {onAddClick && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onAddClick();
              }}
              className="w-full px-3 py-2 text-left text-blue-600 hover:bg-blue-50 font-medium border-t border-gray-200"
            >
              + {addButtonLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
