import { Pressable, Text, View } from 'react-native';
import { SUPPORTED_LOCALES, type Locale } from '@money/types';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useLocaleStore } from '@money/core/store/locale';

import ExchangeRateSettings from '../components/ExchangeRateSettings';
import PageHeader from '../components/PageHeader';
import { useNavigation } from '../shell/navigation';

/** 언어 이름을 담은 열쇠. 사전이 세 언어 모두에서 같은 값(그 나라 말)을 갖는다. */
const NAME_KEY: Record<Locale, MessageKey> = {
  ko: 'language.ko',
  en: 'language.en',
  ja: 'language.ja',
};

/** 설정. 웹의 /settings 와 같은 배치다 (환율 칸은 아직 없다). */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const { go } = useNavigation();

  return (
    <View className="gap-6">
      <PageHeader title={t('settings.title')} />

      <View className="gap-6 md:flex-row">
        <SettingsCard
          title={t('settings.profile.title')}
          description={t('settings.profile.description')}
          onPress={() => go('/settings/profile')}
        />
        <SettingsCard
          title={t('settings.projects.title')}
          description={t('settings.projects.description')}
          onPress={() => go('/settings/projects')}
        />
      </View>

      <View className="gap-4">
        {/*
          환율을 손으로 정하는 유일한 자리.
          거래 입력에서는 실제 금액만 받고 환율은 계산해 보여 준다.
        */}
        <ExchangeRateSettings />

        {/* 언어는 이 계정의 값이고 환율은 프로젝트의 값이다. 자리는 같아도 뜻이 다르다. */}
        <LanguageSettings />
      </View>
    </View>
  );
}

function SettingsCard({
  title,
  description,
  onPress,
}: {
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-lg bg-white p-6 shadow-sm active:bg-gray-50"
    >
      <View className="flex-row items-center justify-between">
        <View className="shrink">
          <Text className="text-lg font-semibold text-gray-900">{title}</Text>
          <Text className="mt-1 text-sm text-gray-600">{description}</Text>
        </View>
        <Text className="text-2xl text-gray-400">→</Text>
      </View>
    </Pressable>
  );
}

/**
 * 화면 언어를 고르는 자리. 웹의 LanguageSettings 와 같다.
 *
 * 목록이 아니라 세 칸을 한 줄에 늘어놓는다. 셋뿐이라 접어 둘 까닭이 없고, 지금
 * 무엇으로 보고 있는지가 열지 않고도 보인다.
 */
function LanguageSettings() {
  const { t, locale } = useTranslation();
  const { setLocale, isSaving } = useLocaleStore();

  return (
    <View className="rounded-lg bg-white p-6 shadow-sm">
      <Text className="text-lg font-semibold text-gray-900">{t('settings.language.title')}</Text>
      <Text className="mt-1 text-sm text-gray-600">{t('settings.language.description')}</Text>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {SUPPORTED_LOCALES.map((code: Locale) => {
          const selected = code === locale;

          return (
            <Pressable
              key={code}
              disabled={isSaving}
              onPress={() => {
                // 저장이 실패하면 스토어가 이전 언어로 되돌린다. 화면은 그 결과를 따른다.
                setLocale(code).catch(() => {});
              }}
              /* 고른 칸 표시는 사이드바 메뉴·분류 목록과 같은 값을 쓴다. */
              className={`min-w-24 items-center rounded-lg border px-4 py-2 ${
                selected ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
              } ${isSaving ? 'opacity-50' : ''}`}
            >
              <Text className={`text-sm ${selected ? 'font-medium text-blue-600' : 'text-gray-700'}`}>
                {t(NAME_KEY[code])}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
