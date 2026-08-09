'use client';

import { useState, useRef, useEffect } from 'react';

interface Option {
  id: string;
  name: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  onAddClick?: () => void;
  addButtonLabel?: string;
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = '선택하세요',
  label,
  onAddClick,
  addButtonLabel = '추가',
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
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-left flex justify-between items-center bg-white ${
          !value ? 'text-gray-500' : 'text-gray-900'
        }`}
      >
        <span>{selectedOption?.name || placeholder}</span>
        <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 border border-gray-300 rounded-lg bg-white shadow-lg z-10">
          <div className="max-h-48 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-left hover:bg-blue-50 cursor-pointer border-b border-gray-100 ${
                  value === option.id ? 'bg-blue-100 font-semibold' : ''
                }`}
              >
                {option.name}
              </button>
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
