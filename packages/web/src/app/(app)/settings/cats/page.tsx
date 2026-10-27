'use client';

/*
 * 고양이 도감. 앱의 CatsScreen 과 같은 짝이다.
 *
 * 45종을 흔한 것에서 드문 것 차례로 세운다. 얻지 않은 고양이는 실루엣이고, 숨긴 미션은 "???" 다. 얻은 고양이를 누르면
 * 화면 아래에 데리고 다닌다(최대 5마리). 목록과 고르기는 core 의 `useCatBook` 이 한다.
 */
import { CAT_BREEDS, CAT_PARADE_MAX } from '@money/types';
import { useCatBook } from '@money/core/hooks/useCats';
import { useShowAds } from '@money/core/lib/ads';
import { CAT_RARITY_COLOR, CAT_RARITY_KEY, catMissionKey, catNameKey, catShareLabel } from '@money/core/lib/cats';
import { formatDate } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { useCats } from '@money/core/store/cats';
import { useProject, useProjectTimeZone } from '@money/core/store/project';

import CatArt from '@/components/cats/CatArt';
import LoadingBlock from '@/components/LoadingBlock';
import PageHeader from '@/components/PageHeader';

export default function CatsPage() {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();
  const book = useCatBook(projectId);
  const showAds = useShowAds();
  const showParade = useCats((state) => state.showParade);
  const setShowParade = useCats((state) => state.setShowParade);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('cats.title')}
        backHref="/settings"
        action={
          <span className="text-sm font-medium text-gray-500">
            {t('cats.count', { owned: book.ownedCount, total: CAT_BREEDS.length })}
          </span>
        }
      />
      <p className="text-sm text-gray-600">{t('cats.description')}</p>

      <section className="space-y-3 rounded-lg bg-white p-6 shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">{t('cats.show.title')}</h2>
          <select
            value={showParade ? 'on' : 'off'}
            onChange={(event) => setShowParade(event.target.value === 'on')}
            aria-label={t('cats.show.title')}
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="on">{t('cats.show.on')}</option>
            <option value="off">{t('cats.show.off')}</option>
          </select>
        </div>
        <p className="text-sm text-gray-500">{t('cats.show.description')}</p>
        {showAds ? <p className="text-sm text-amber-700">{t('cats.show.adsNote')}</p> : null}
        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <h3 className="font-medium text-gray-900">{t('cats.parade.title')}</h3>
          <span className="text-sm text-gray-500">
            {t('cats.parade.count', { count: book.paradeCount, max: CAT_PARADE_MAX })}
          </span>
        </div>
        <p className="text-sm text-gray-500">{t('cats.parade.description', { max: CAT_PARADE_MAX })}</p>
        {book.error ? <p className="unfold text-sm text-red-600">{book.error}</p> : null}
      </section>

      {book.isLoading ? <LoadingBlock /> : null}
      {book.loadFailed ? (
        <p className="unfold rounded-lg bg-red-50 p-3 text-sm text-red-700">{t('cats.loadFailed')}</p>
      ) : null}

      {!book.isLoading && !book.loadFailed ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {book.entries.map(({ breed, grantedAt, inParade }) => {
            const owned = grantedAt !== null;
            const rarity = CAT_RARITY_COLOR[breed.rarity];
            return (
              <li key={breed.id}>
                <button
                  type="button"
                  disabled={!owned}
                  onClick={() => book.toggle(breed.id)}
                  aria-pressed={owned ? inParade : undefined}
                  className={`flex h-full w-full flex-col items-center gap-1.5 rounded-lg bg-white p-3 text-center shadow transition ${
                    owned ? 'hover:shadow-md' : 'cursor-default'
                  } ${inParade ? 'ring-2 ring-blue-500' : ''}`}
                >
                  <CatArt breedId={breed.id} silhouette={!owned} width={84} />
                  <span className={`text-sm font-semibold ${owned ? 'text-gray-900' : 'text-gray-400'}`}>
                    {t(catNameKey(breed.id))}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${rarity.className}`}>
                    {t(CAT_RARITY_KEY[breed.rarity])} · {catShareLabel(breed)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {breed.hidden && !owned ? t('cats.hiddenMission') : t(catMissionKey(breed.mission))}
                  </span>
                  {owned ? (
                    <span className="text-[11px] text-gray-400">
                      {inParade
                        ? t('cats.parade.selected')
                        : t('cats.grantedAt', { date: formatDate(grantedAt, timeZone) })}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
