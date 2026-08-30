import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { Person } from '@money/core/lib/types';

/** 제목에 이름을 몇 개까지 늘어놓을지. 그보다 많으면 "외 N명"으로 접는다. */
const MAX_NAMES = 2;

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
 * 자산주인을 겸하는 화면 제목. 웹의 PersonScopeTitle 과 같다.
 *
 * 지금 보고 있는 범위를 제목이 직접 말하고, 바꾸려면 그 제목을 누른다. 전부 켜면
 * 전체이고 하나도 켜지 않으면 결과가 없는 상태다.
 */
export default function PersonScopeTitle({
  noun,
  people,
  myPersonId,
  selectedPersonIds,
  onTogglePerson,
}: {
  noun: string;
  people: Person[];
  myPersonId: string | null;
  selectedPersonIds: string[];
  onTogglePerson: (personId: string) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const selectedNames = people
    .filter((person) => selectedPersonIds.includes(person.id))
    .map((person) => person.name);

  return (
    <View>
      <Pressable
        onPress={() => setIsOpen((open) => !open)}
        className="-ml-2 flex-row items-center gap-1.5 rounded-lg px-2 py-1 active:bg-gray-100"
      >
        {/* 누를 수 있다는 표시는 글자 앞에 둔다. 뒤에 두면 첫 문장이 이름과 조사 사이에서 끊긴다. */}
        <ChevronDown size={20} color="#9ca3af" />
        <Text className="text-2xl font-bold text-gray-900">
          {people.length === 0 ? noun : scopeLabel(t, selectedNames, people.length, noun)}
        </Text>
      </Pressable>

      {isOpen ? (
        <View className="mt-2 w-56 rounded-lg border border-gray-200 bg-white p-3">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('scopeTitle.owner')}
          </Text>

          {people.length === 0 ? (
            <Text className="text-sm text-gray-500">{t('scopeTitle.noPeople')}</Text>
          ) : (
            <View className="gap-2">
              {people.map((person) => (
                <Pressable
                  key={person.id}
                  onPress={() => onTogglePerson(person.id)}
                  className="flex-row items-center gap-2"
                >
                  <Switch
                    value={selectedPersonIds.includes(person.id)}
                    onValueChange={() => onTogglePerson(person.id)}
                  />
                  <Text className="text-sm text-gray-700">
                    {person.name}
                    {person.id === myPersonId ? (
                      <Text className="text-xs text-blue-600"> {t('scopeTitle.me')}</Text>
                    ) : null}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}
