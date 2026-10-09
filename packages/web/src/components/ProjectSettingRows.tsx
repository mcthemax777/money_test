'use client';

import { useState } from 'react';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@money/types';

import type { useSelectedProjectSettings } from '@money/core/hooks/useSelectedProjectSettings';
import type { ProjectResult } from '@money/core/hooks/useProjectAdmin';
import { useTranslation } from '@money/core/lib/i18n';
import { currencyLabel } from '@money/core/lib/money';
import { planStatusLabel } from '@money/core/lib/plans';
import { TIME_ZONE_OPTIONS } from '@money/core/lib/time-zones';

import PlanModal from '@/components/PlanModal';

/**
 * 설정 탭의 지금 보는 가계부 칸들 -- 프리미엄 이용권, 구성원 중 나, 기준 타임존, 표시 통화.
 *
 * 2026-10-10 사용자 요청으로 프로젝트 관리의 가계부 상자에서 설정 탭으로 꺼냈다. 값과 저장은
 * core 의 `useSelectedProjectSettings` 가 맡고, 설정 화면이 그 결과 하나를 칸마다 넘긴다.
 * 앱의 ProjectSettingRows 와 같은 칸이다. 모양은 시작 요일 칸(`WeekStartSettings`)과 같다 --
 * 제목과 선택 상자만 두고 설명은 적지 않는다.
 */
type ProjectSettings = ReturnType<typeof useSelectedProjectSettings>;

const SELECT_CLASS =
  'px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50';

/** 제목과 고르는 칸 하나, 그 아래 실패 이유. */
function SettingBox({
  title,
  error,
  children,
}: {
  title: string;
  error: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {children}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** 저장하고, 실패하면 이유를 남긴다. */
function useSaver() {
  const [error, setError] = useState('');
  const save = async (task: Promise<ProjectResult>) => {
    setError('');
    const result = await task;
    if (!result.ok) setError(result.message);
  };
  return { error, save };
}

/** 프리미엄 이용권. 가계부에 붙으므로 멤버 모두에게 보이고, 결제는 팝업이 앱으로 안내한다. */
export function PremiumPlanRow({ settings }: { settings: ProjectSettings }) {
  const { t, tag } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { project } = settings;
  if (!project) return null;

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className="block w-full text-left">
        <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">{t('settings.plan.title')}</h2>
            <span className="inline-flex items-center gap-2 text-sm text-gray-700">
              {planStatusLabel(project.plan, t, tag)}
              <span aria-hidden className="text-2xl text-gray-900">→</span>
            </span>
          </div>
        </div>
      </button>
      <PlanModal project={isOpen ? project : null} onClose={() => setIsOpen(false)} />
    </>
  );
}

/** 구성원 중 나. 가계부가 아니라 내 멤버십에 붙는 값이라 사람마다 다르다. */
export function MyPersonRow({ settings }: { settings: ProjectSettings }) {
  const { t } = useTranslation();
  const { error, save } = useSaver();
  const { project, people } = settings;
  if (!project) return null;

  return (
    <SettingBox title={t('projects.myPerson')} error={error}>
      <select
        value={project.myPersonId ?? ''}
        onChange={(e) => save(settings.setMyPerson(e.target.value))}
        disabled={settings.isSubmitting}
        aria-label={t('projects.myPerson')}
        className={SELECT_CLASS}
      >
        <option value="">{t('projects.myPersonNone')}</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </SettingBox>
  );
}

/** 기준 타임존. 집계의 기준이라 구성원 모두에게 함께 적용되고, 소유자만 바꾼다. */
export function TimezoneRow({ settings }: { settings: ProjectSettings }) {
  const { t } = useTranslation();
  const { error, save } = useSaver();
  if (!settings.project || !settings.isOwner) return null;

  return (
    <SettingBox title={t('projects.timezone')} error={error}>
      <select
        value={settings.timezone}
        onChange={(e) => save(settings.setTimezone(e.target.value))}
        disabled={settings.isSubmitting}
        aria-label={t('projects.timezone')}
        className={SELECT_CLASS}
      >
        {TIME_ZONE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {/* UTC처럼 옮길 이름이 없는 항목은 id를 그대로 적는다. */}
            {option.nameKey ? t(option.nameKey) : option.id}
          </option>
        ))}
      </select>
    </SettingBox>
  );
}

/**
 * 표시 통화. 저장된 값은 하나도 바뀌지 않는다 -- 서버가 읽을 때만 환율을 곱해 보여 주므로
 * 몇 번을 오가도 원본이 그대로다. 확인 창을 띄우지 않는 이유도 그래서다. 소유자만 바꾼다.
 */
export function DisplayCurrencyRow({ settings }: { settings: ProjectSettings }) {
  const { t } = useTranslation();
  const { error, save } = useSaver();
  if (!settings.project || !settings.isOwner) return null;

  const current = settings.displayCurrency ?? settings.ledgerCurrency;

  return (
    <SettingBox title={t('projects.displayCurrency')} error={error}>
      <select
        value={current}
        onChange={(e) => {
          if (e.target.value === current) return;
          void save(settings.setDisplayCurrency(e.target.value as CurrencyCode));
        }}
        disabled={settings.isSubmitting}
        aria-label={t('projects.displayCurrency')}
        className={SELECT_CLASS}
      >
        {SUPPORTED_CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {currencyLabel(code)}
          </option>
        ))}
      </select>
    </SettingBox>
  );
}
