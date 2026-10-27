'use client';

import Link from 'next/link';
import { catBreedOf } from '@money/types';

import { useCatArrivals } from '@money/core/hooks/useCats';
import { CAT_RARITY_COLOR, CAT_RARITY_KEY, catMissionKey, catNameKey } from '@money/core/lib/cats';
import { useTranslation } from '@money/core/lib/i18n';
import { useProject } from '@money/core/store/project';

import Modal from '@/components/Modal';
import CatArt from './CatArt';

/**
 * "새 고양이가 찾아왔어요" 알림. 앱의 `components/cats/CatArrivalModal` 과 같은 짝이다.
 *
 * 한 마리면 크게 보여 주고 곧바로 데리고 다닐 수 있게 한다. 여러 마리(기능을 처음 열 때 지난 자료로 한꺼번에 받는
 * 때)면 작게 늘어놓고 도감으로 안내한다.
 */
export default function CatArrivalDialog() {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const { breedIds, canBring, bring, dismiss } = useCatArrivals(projectId);
  const isOpen = breedIds.length > 0;
  const single = breedIds.length === 1 ? catBreedOf(breedIds[0]) : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={dismiss}
      title={single ? t('cats.arrival.title') : t('cats.arrival.many', { count: breedIds.length })}
      footer={
        <div className="flex justify-end gap-2">
          {single && canBring(single.id) ? (
            <button
              type="button"
              onClick={() => {
                bring(single.id);
                dismiss();
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              {t('cats.arrival.bring')}
            </button>
          ) : null}
          {!single ? (
            <Link
              href="/settings/cats"
              onClick={dismiss}
              className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              {t('cats.arrival.openBook')}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          >
            {t('cats.arrival.ok')}
          </button>
        </div>
      }
    >
      {single ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CatArt breedId={single.id} width={150} className="cat-pop" />
          <p className="text-xl font-bold text-gray-900">{t(catNameKey(single.id))}</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAT_RARITY_COLOR[single.rarity].className}`}>
            {t(CAT_RARITY_KEY[single.rarity])}
          </span>
          <p className="text-sm text-gray-600">{t(catMissionKey(single.mission))}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-3 py-2 sm:grid-cols-4">
          {breedIds.map((id, index) => (
            <li key={id} className="flex flex-col items-center gap-1 text-center">
              {/* 하나씩 차례로 튀어 오른다. 한꺼번에 오면 무엇이 왔는지 눈이 따라가지 못한다. */}
              <span className="cat-pop" style={{ animationDelay: `${Math.min(index, 20) * 60}ms` }}>
                <CatArt breedId={id} width={64} />
              </span>
              <span className="text-xs text-gray-700">{t(catNameKey(id))}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
