/**
 * 설정 탭의 지금 보는 가계부 칸들 -- 프리미엄 이용권, 구성원 중 나, 기준 타임존, 표시 통화.
 *
 * 2026-10-10 사용자 요청으로 프로젝트 관리의 가계부 상자에서 설정 탭으로 꺼냈다. 값과 저장은
 * core 의 `useSelectedProjectSettings` 가 맡고, 설정 화면이 그 결과 하나를 칸마다 넘긴다
 * (칸마다 훅을 부르면 구성원 목록을 여러 번 받는다). 웹의 ProjectSettingRows 와 같은 칸이다.
 *
 * 줄에는 지금 값만 적고, 무엇을 고르는지는 팝업이 말한다 (언어·시작 요일과 같은 모양).
 */
import { useState } from 'react';
import { Text } from 'react-native';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@money/types';

import type { useSelectedProjectSettings } from '@money/core/hooks/useSelectedProjectSettings';
import { useTranslation } from '@money/core/lib/i18n';
import { currencyLabel } from '@money/core/lib/money';
import { planStatusLabel } from '@money/core/lib/plans';
import { TIME_ZONE_OPTIONS } from '@money/core/lib/time-zones';

import PlanModal from './PlanModal';
import { OptionModal, SettingRow } from './SettingPicker';

type ProjectSettings = ReturnType<typeof useSelectedProjectSettings>;

const currencyOptionLabel = (code: CurrencyCode) => `${code} · ${currencyLabel(code)}`;

/**
 * 저장이 실패한 이유. 줄 아래에 적는다.
 *
 * 빈 값이면 null 을 넘겨야 한다 -- SettingRow 는 children 이 있기만 하면 아래 여백을 붙여,
 * 아무것도 그리지 않는 요소를 넘겨도 줄이 높아진다.
 */
const errorLine = (message: string) =>
  message ? <Text className="text-sm text-red-600">{message}</Text> : null;

/** 프리미엄 이용권. 가계부에 붙으므로 멤버 모두에게 보이고, 결제는 팝업에서 소유자만 한다. */
export function PremiumPlanRow({ settings }: { settings: ProjectSettings }) {
  const { t, tag } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { project } = settings;
  if (!project) return null;

  return (
    <>
      <SettingRow
        title={t('settings.plan.title')}
        value={planStatusLabel(project.plan, t, tag)}
        onPress={() => setIsOpen(true)}
      />
      <PlanModal
        project={isOpen ? project : null}
        onClose={() => setIsOpen(false)}
        onReload={settings.reloadProjects}
      />
    </>
  );
}

/** 구성원 중 나. 가계부가 아니라 내 멤버십에 붙는 값이라 사람마다 다르다. */
export function MyPersonRow({ settings }: { settings: ProjectSettings }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState('');
  const { project, people } = settings;
  if (!project) return null;

  // 빈 id 가 "지정 안 함"이다. 서버에는 null 로 간다.
  const options = [
    { value: '', label: t('projects.myPersonNone') },
    ...people.map((person) => ({ value: person.id, label: person.name })),
  ];
  const current = project.myPersonId ?? '';

  return (
    <>
      <SettingRow
        title={t('projects.myPerson')}
        value={options.find((option) => option.value === current)?.label ?? ''}
        disabled={settings.isSubmitting}
        onPress={() => setIsOpen(true)}
      >
        {errorLine(error)}
      </SettingRow>
      <OptionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('projects.myPerson')}
        description={t('projects.myPersonHint')}
        options={options}
        value={current}
        onSelect={(personId) => {
          setError('');
          void settings.setMyPerson(personId).then((result) => {
            if (!result.ok) setError(result.message);
          });
        }}
      />
    </>
  );
}

/** 기준 타임존. 집계의 기준이라 구성원 모두에게 함께 적용되고, 소유자만 바꾼다. */
export function TimezoneRow({ settings }: { settings: ProjectSettings }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState('');
  if (!settings.project || !settings.isOwner) return null;

  // 목록에 없는 값(웹에서 예전에 고른 것 따위)도 비워 두지 않고 id 를 그대로 적는다.
  const labelOf = (id: string) => {
    const option = TIME_ZONE_OPTIONS.find((candidate) => candidate.id === id);
    return option?.nameKey ? t(option.nameKey) : id;
  };

  return (
    <>
      <SettingRow
        title={t('projects.timezone')}
        value={labelOf(settings.timezone)}
        disabled={settings.isSubmitting}
        onPress={() => setIsOpen(true)}
      >
        {errorLine(error)}
      </SettingRow>
      <OptionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('projects.timezone')}
        description={t('projects.timezoneHint')}
        options={TIME_ZONE_OPTIONS.map((option) => ({ value: option.id, label: labelOf(option.id) }))}
        value={settings.timezone}
        onSelect={(timezone) => {
          setError('');
          void settings.setTimezone(timezone).then((result) => {
            if (!result.ok) setError(result.message);
          });
        }}
      />
    </>
  );
}

/** 표시 통화. 저장된 값은 그대로 두고 읽을 때만 환산한다. 소유자만 바꾼다. */
export function DisplayCurrencyRow({ settings }: { settings: ProjectSettings }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState('');
  if (!settings.project || !settings.isOwner) return null;

  const { displayCurrency } = settings;

  return (
    <>
      <SettingRow
        title={t('projects.displayCurrency')}
        value={displayCurrency ? currencyOptionLabel(displayCurrency) : ''}
        disabled={settings.isSubmitting}
        onPress={() => setIsOpen(true)}
      >
        {errorLine(error)}
      </SettingRow>
      <OptionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('projects.displayCurrency')}
        description={t('projects.displayCurrencyHint')}
        options={SUPPORTED_CURRENCIES.map((code: CurrencyCode) => ({
          value: code,
          label: currencyOptionLabel(code),
        }))}
        value={displayCurrency}
        onSelect={(code) => {
          setError('');
          void settings.setDisplayCurrency(code).then((result) => {
            if (!result.ok) setError(result.message);
          });
        }}
        footnote={t('projects.ledgerCurrencyNote', { currency: settings.ledgerCurrency })}
      />
    </>
  );
}
