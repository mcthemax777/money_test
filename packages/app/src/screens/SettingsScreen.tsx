import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SUPPORTED_LOCALES, WEEK_START_DAYS, type Locale, type WeekStart } from '@money/types';

import { useApiError } from '@money/core/lib/api-error';
import { weekdayNames } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useLocaleStore } from '@money/core/store/locale';
import { useProject } from '@money/core/store/project';
import { useWeekStartStore } from '@money/core/store/week-start';
import { useInquiryUnread } from '@money/core/store/inquiry-unread';

import CountBadge from '../components/CountBadge';
import ExchangeRateSettings from '../components/ExchangeRateSettings';
import PageHeader from '../components/PageHeader';
import { OptionModal, SettingRow } from '../components/SettingPicker';
import { useNavigation } from '../shell/navigation';
import { useOutboxCount } from '../shell/nav-badges';
import { showAdPrivacyOptions, useAdConsent } from '../ads';

/** 언어 이름을 담은 열쇠. 사전이 세 언어 모두에서 같은 값(그 나라 말)을 갖는다. */
const NAME_KEY: Record<Locale, MessageKey> = {
  ko: 'language.ko',
  en: 'language.en',
  ja: 'language.ja',
};

/** 설정. 웹의 /settings 와 같은 차례다 (보내지 못한 거래는 앱에만 있다). */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const { go } = useNavigation();
  const outboxCount = useOutboxCount();
  const inquiryUnread = useInquiryUnread((state) => state.count);
  const refreshInquiryUnread = useInquiryUnread((state) => state.refresh);

  // 설정을 열 때마다 읽지 않은 답을 센다. 앱을 보는 중에 온 답은 푸시를 받을 때 센다(PushSetup).
  useEffect(() => {
    void refreshInquiryUnread();
  }, [refreshInquiryUnread]);

  return (
    <View className="gap-6">
      <PageHeader title={t('settings.title')} />

      {/*
        차례 (2026-10-09 사용자 요청): 내 정보, 프로젝트 관리, 분류·태그, 시작 요일, 언어, 환율, 엑셀,
        문의하기, 보내지 못한 거래. 설명은 적지 않는다 -- 들어간 화면·팝업이 말한다 (웹과 같다).
      */}
      <View className="gap-4">
        <SettingsCard
          title={t('settings.profile.title')}
          onPress={() => go('/settings/profile')}
        />
        <SettingsCard
          title={t('settings.projects.title')}
          onPress={() => go('/settings/projects')}
        />
        {/* 분류와 태그는 한 번 짜 두고 오래 쓰는 것이라 아래 탭에서 내려 여기에 둔다. */}
        <SettingsCard
          title={t('settings.categories.title')}
          onPress={() => go('/settings/categories')}
        />

        {/* 시작 요일은 이 계정의 값이다. 달력과 주 단위 보기가 함께 본다. */}
        <WeekStartSettings />

        {/* 언어는 이 계정의 값이고 환율은 프로젝트의 값이다. 자리는 같아도 뜻이 다르다. */}
        <LanguageSettings />

        {/*
          환율을 손으로 정하는 유일한 자리.
          거래 입력에서는 실제 금액만 받고 환율은 계산해 보여 준다.
        */}
        <ExchangeRateSettings />

        {/* 거래내역을 엑셀로 내보내고, 엑셀의 거래를 한꺼번에 넣는다. */}
        <SettingsCard
          title={t('settings.sheet.title')}
          onPress={() => go('/settings/sheet')}
        />
        {/* 관리자에게 문의. 답이 오면 읽지 않은 답의 수가 보내지 못한 거래와 같은 배지로 선다. */}
        <SettingsCard
          title={t('settings.inquiries.title')}
          badge={inquiryUnread}
          onPress={() => go('/settings/inquiries')}
        />
        {/*
          광고 동의를 바꾸는 자리. 동의 창이 뜬 지역(EEA·영국 등)에서만 선다 -- Google 정책상
          그 지역에서는 언제든 다시 열 수 있어야 한다.
        */}
        <AdPrivacySettings />
        {/*
          오프라인에서 적었지만 아직 서버로 가지 못한 거래.
          대개는 조용히 나가므로 평소에는 빈 화면이고, 충돌과 거절만 여기 남는다.
        */}
        <SettingsCard
          title={t('settings.outbox.title')}
          badge={outboxCount}
          onPress={() => go('/settings/outbox')}
        />
      </View>
    </View>
  );
}

function SettingsCard({
  title,
  badge = 0,
  onPress,
  disabled = false,
  error = '',
}: {
  title: string;
  /** 제목 옆의 빨간 건수. 0 이면 그리지 않는다. */
  badge?: number;
  onPress: () => void;
  /** 누른 일이 도는 동안 잠근다. */
  disabled?: boolean;
  /** 카드 아래에 적는 실패 이유. */
  error?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-lg bg-white p-6 shadow-sm active:bg-gray-50 ${disabled ? 'opacity-50' : ''}`}
    >
      <View className="flex-row items-center justify-between">
        <View className="shrink">
          <View className="flex-row items-center gap-2">
            <Text className="text-lg font-semibold text-gray-900">{title}</Text>
            <CountBadge count={badge} inline />
          </View>
        </View>
        <Text className="text-2xl text-gray-400">→</Text>
      </View>
      {error ? <Text className="mt-2 text-sm text-red-600">{error}</Text> : null}
    </Pressable>
  );
}

/**
 * 화면 언어를 고르는 자리. 웹의 LanguageSettings 와 같은 값을 바꾼다.
 *
 * 줄에는 지금 언어만 적고, 누르면 팝업에서 고른다.
 */
function LanguageSettings() {
  const { t, locale } = useTranslation();
  const { setLocale, isSaving } = useLocaleStore();
  const { messageOf } = useApiError();
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <SettingRow
        title={t('settings.language.title')}
        value={t(NAME_KEY[locale])}
        disabled={isSaving}
        onPress={() => setIsOpen(true)}
      >
        {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
      </SettingRow>

      <OptionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('settings.language.title')}
        description={t('settings.language.description')}
        options={SUPPORTED_LOCALES.map((code: Locale) => ({
          value: code,
          label: t(NAME_KEY[code]),
        }))}
        value={locale}
        onSelect={(code) => {
          // 저장이 실패하면 스토어가 이전 언어로 되돌린다. 말없이 되돌아가면 눌러도
          // 안 되는 것으로 보이므로 이유를 적는다 (웹의 LanguageSettings 와 같다).
          setError('');
          setLocale(code).catch((err) => setError(messageOf(err, 'settings.language.saveFailed')));
        }}
      />
    </>
  );
}

/**
 * 한 주를 어느 요일에서 시작할지 고르는 자리. 웹의 WeekStartSettings 와 같은 값을 바꾼다.
 *
 * 요일 이름은 사전이 아니라 Intl 이 만든다 (`weekdayNames`). 일요일 차례로 받아
 * 번호를 그대로 자리로 쓴다 -- 0 이 일요일이다.
 */
function WeekStartSettings() {
  const { t } = useTranslation();
  const { weekStart, setWeekStart, isSaving } = useWeekStartStore();
  const { messageOf } = useApiError();
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  // useTranslation 이 언어 스토어를 구독하므로, 언어를 바꾸면 이름도 다시 만들어진다.
  const names = weekdayNames(0, 'long');

  return (
    <>
      <SettingRow
        title={t('settings.weekStart.title')}
        value={names[weekStart]}
        disabled={isSaving}
        onPress={() => setIsOpen(true)}
      >
        {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
      </SettingRow>

      <OptionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('settings.weekStart.title')}
        description={t('settings.weekStart.description')}
        options={WEEK_START_DAYS.map((day: WeekStart) => ({
          value: day,
          label: names[day],
        }))}
        value={weekStart}
        onSelect={(day) => {
          // 저장이 실패하면 스토어가 이전 요일로 되돌린다. 이유는 줄 아래에 적는다.
          setError('');
          setWeekStart(day).catch((err) =>
            setError(messageOf(err, 'settings.weekStart.saveFailed')),
          );
        }}
      />
    </>
  );
}

/** 광고 개인정보 옵션. 누르면 UMP 의 동의 창이 다시 뜬다. */
function AdPrivacySettings() {
  const { t } = useTranslation();
  const required = useAdConsent((state) => state.privacyOptionsRequired);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState('');

  if (!required) return null;

  return (
    <SettingsCard
      title={t('settings.adPrivacy.title')}
      disabled={isOpening}
      error={error}
      onPress={() => {
        setError('');
        setIsOpening(true);
        showAdPrivacyOptions()
          .catch(() => setError(t('settings.adPrivacy.failed')))
          .finally(() => setIsOpening(false));
      }}
    />
  );
}
