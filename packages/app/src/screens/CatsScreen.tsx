/*
 * 고양이 도감. 웹의 settings/cats 와 같은 짝이다.
 *
 * 45종을 흔한 것에서 드문 것 차례로 세운다. 얻지 않은 고양이는 실루엣이고, 숨긴 미션은 "???" 다. 얻은 고양이를 누르면
 * 화면 아래에 데리고 다닌다(최대 5마리). 목록과 고르기는 core 의 `useCatBook` 이 한다.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CAT_BREEDS, CAT_PARADE_MAX } from '@money/types';

import { useCatBook } from '@money/core/hooks/useCats';
import { useShowAds } from '@money/core/lib/ads';
import { CAT_RARITY_COLOR, CAT_RARITY_KEY, catMissionKey, catNameKey, catShareLabel } from '@money/core/lib/cats';
import { formatDate } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { useCats } from '@money/core/store/cats';
import { useProject, useProjectTimeZone } from '@money/core/store/project';

import CatArt from '../components/cats/CatArt';
import LoadingBlock from '../components/LoadingBlock';
import PageHeader from '../components/PageHeader';
import { OptionModal, SettingRow } from '../components/SettingPicker';

export default function CatsScreen() {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();
  const book = useCatBook(projectId);

  return (
    <View className="gap-6">
      <PageHeader
        title={t('cats.title')}
        showBack
        action={
          <Text className="text-sm font-medium text-gray-500">
            {t('cats.count', { owned: book.ownedCount, total: CAT_BREEDS.length })}
          </Text>
        }
      />
      <Text className="text-sm text-gray-600">{t('cats.description')}</Text>

      <ShowParadeRow />

      <View className="gap-2 rounded-lg bg-white p-6 shadow-sm">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-gray-900">{t('cats.parade.title')}</Text>
          <Text className="text-sm text-gray-500">
            {t('cats.parade.count', { count: book.paradeCount, max: CAT_PARADE_MAX })}
          </Text>
        </View>
        <Text className="text-sm text-gray-500">{t('cats.parade.description', { max: CAT_PARADE_MAX })}</Text>
        {book.error ? <Text className="text-sm text-red-600">{book.error}</Text> : null}
      </View>

      {book.isLoading ? <LoadingBlock /> : null}
      {book.loadFailed ? (
        <Text className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{t('cats.loadFailed')}</Text>
      ) : null}

      {!book.isLoading && !book.loadFailed ? (
        <View className="-mx-1.5 flex-row flex-wrap">
          {book.entries.map(({ breed, grantedAt, inParade }) => {
            const owned = grantedAt !== null;
            const rarity = CAT_RARITY_COLOR[breed.rarity];
            return (
              <View key={breed.id} className="w-1/2 p-1.5 md:w-1/3 lg:w-1/5">
                <Pressable
                  disabled={!owned}
                  onPress={() => book.toggle(breed.id)}
                  accessibilityRole="button"
                  accessibilityState={owned ? { selected: inParade } : { disabled: true }}
                  className={`flex-1 items-center gap-1.5 rounded-lg bg-white p-3 shadow-sm ${
                    owned ? 'active:bg-gray-50' : ''
                  }`}
                  // 테두리는 style 로 정한다 -- className 에서 빼기만 하면 안드로이드에 남는다.
                  style={{ borderWidth: 2, borderColor: inParade ? '#3b82f6' : 'transparent' }}
                >
                  <CatArt breedId={breed.id} silhouette={!owned} width={84} />
                  <Text className={`text-center text-sm font-semibold ${owned ? 'text-gray-900' : 'text-gray-400'}`}>
                    {t(catNameKey(breed.id))}
                  </Text>
                  <Text
                    className="overflow-hidden rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ color: rarity.text, backgroundColor: rarity.background }}
                  >
                    {t(CAT_RARITY_KEY[breed.rarity])} · {catShareLabel(breed)}
                  </Text>
                  <Text className="text-center text-xs text-gray-500">
                    {breed.hidden && !owned ? t('cats.hiddenMission') : t(catMissionKey(breed.mission))}
                  </Text>
                  {owned ? (
                    <Text className="text-center text-[11px] text-gray-400">
                      {inParade
                        ? t('cats.parade.selected')
                        : t('cats.grantedAt', { date: formatDate(grantedAt, timeZone) })}
                    </Text>
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** 화면 아래 고양이를 이 기기에서 보일지. 광고가 있는 가계부에서는 배너 뒤에 숨는다고 알린다. */
function ShowParadeRow() {
  const { t } = useTranslation();
  const showParade = useCats((state) => state.showParade);
  const setShowParade = useCats((state) => state.setShowParade);
  const showAds = useShowAds();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <SettingRow
        title={t('cats.show.title')}
        value={t(showParade ? 'cats.show.on' : 'cats.show.off')}
        onPress={() => setIsOpen(true)}
      >
        {showAds ? <Text className="text-sm text-amber-700">{t('cats.show.adsNote')}</Text> : null}
      </SettingRow>

      <OptionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('cats.show.title')}
        description={t('cats.show.description')}
        options={[
          { value: 'on', label: t('cats.show.on') },
          { value: 'off', label: t('cats.show.off') },
        ]}
        value={showParade ? 'on' : 'off'}
        onSelect={(choice) => setShowParade(choice === 'on')}
      />
    </>
  );
}
