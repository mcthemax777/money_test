'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { Person } from '@/lib/types';

interface PersonScopeTitleProps {
  /** 화면 이름. "가계", "자산" 처럼 사람 이름 뒤에 붙는다. */
  noun: string;
  people: Person[];
  /** 설정에서 지정한 "나". 이름 뒤에 표시만 한다. */
  myPersonId?: string | null;
  selectedPersonIds: string[];
  onTogglePerson: (personId: string) => void;
}

/** 이름을 다 적으면 제목이 길어지는 경계 */
const MAX_NAMES = 3;

/**
 * 제목에 적을 문구.
 *
 * 전원을 고른 상태는 이름을 늘어놓지 않고 "전체"라고 적는다. 그 상태가 기본값이라
 * 이름을 다 적으면 제목이 늘 길고, 정작 좁혀 놓았을 때와 구별되지 않는다.
 *
 * 아무도 고르지 않은 상태는 "전체"가 아니라 "결과 없음"이다. 화면 이름만 남기면
 * 그 사실이 사라지므로 뒤에 붙여서 알린다.
 */
function scopeLabel(
  t: ReturnType<typeof useTranslation>['t'],
  names: string[],
  total: number,
  noun: string,
): string {
  if (names.length === 0) return t('scopeTitle.none', { noun });
  if (names.length === total) return t('scopeTitle.all', { noun });
  if (names.length <= MAX_NAMES) return t('scopeTitle.some', { names: names.join(', '), noun });
  return t('scopeTitle.many', { first: names[0], count: names.length - 1, noun });
}

/**
 * 자산주인을 겸하는 화면 제목.
 *
 * 예전에는 제목 아래 별도 줄에 체크박스가 깔려 있었다. 제목은 "가계"라고만 하고
 * 누구의 가계인지는 그 아래를 봐야 알 수 있어서, 필터를 걸어 둔 사실 자체를
 * 잊기 쉬웠다. 지금 보고 있는 범위를 제목이 직접 말하고, 바꾸려면 그 제목을 누른다.
 *
 * 기준은 거래를 입력한 사람이 아니라 돈이 오간 계좌의 주인이다. 이체는 보내는 계좌를 본다.
 *
 * 체크박스만 두고 "전체" 버튼은 두지 않는다. 전부 체크하면 전체이고 하나도
 * 체크하지 않으면 결과가 없는 상태다. 버튼을 따로 두면 체크 상태와 버튼이
 * 서로 다른 이야기를 하게 된다.
 */
export default function PersonScopeTitle({
  noun,
  people,
  myPersonId,
  selectedPersonIds,
  onTogglePerson,
}: PersonScopeTitleProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectedNames = people
    .filter((person) => selectedPersonIds.includes(person.id))
    .map((person) => person.name);

  return (
    <div ref={ref} className="relative">
      {/* 화면 제목을 겸하므로 h1 자리를 지킨다. 누르는 것은 그 안의 버튼이다. */}
      <h1>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex items-center gap-1.5 -ml-2 px-2 py-1 rounded-lg text-2xl font-bold text-gray-900 hover:bg-gray-100 transition"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          title={t('scopeTitle.pick')}
        >
          {/*
            누를 수 있다는 표시는 글자 앞에 둔다. 뒤에 두면 홈의 첫 문장
            ("○○님의 자산은 …")이 이름과 조사 사이에서 끊긴다.
          */}
          <ChevronDown className="w-5 h-5 text-gray-400" />
          {/* 구성원을 아직 못 받았으면 이름 자리를 비워 두고 화면 이름만 적는다 */}
          {people.length === 0 ? noun : scopeLabel(t, selectedNames, people.length, noun)}
        </button>
      </h1>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
            {t('scopeTitle.owner')}
          </p>
          {people.length === 0 ? (
            <p className="text-sm text-gray-500">{t('scopeTitle.noPeople')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {people.map((person) => (
                <label
                  key={person.id}
                  className="flex items-center gap-2 cursor-pointer text-base font-normal"
                >
                  <input
                    type="checkbox"
                    checked={selectedPersonIds.includes(person.id)}
                    onChange={() => onTogglePerson(person.id)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">
                    {person.name}
                    {person.id === myPersonId && (
                      <span className="text-xs text-blue-600"> {t('scopeTitle.me')}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
