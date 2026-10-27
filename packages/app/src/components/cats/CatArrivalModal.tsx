import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { catBreedOf } from '@money/types';

import { useCatArrivals } from '@money/core/hooks/useCats';
import { CAT_RARITY_COLOR, CAT_RARITY_KEY, catMissionKey, catNameKey } from '@money/core/lib/cats';
import { useTranslation } from '@money/core/lib/i18n';
import { useProject } from '@money/core/store/project';

import Modal from '../Modal';
import { useNavigation } from '../../shell/navigation';
import CatArt from './CatArt';
import { useReduceMotion } from './motion';

/**
 * "새 고양이가 찾아왔어요" 알림. 웹의 `components/cats/CatArrivalDialog` 와 같은 짝이다.
 *
 * 한 마리면 크게 보여 주고 곧바로 데리고 다닐 수 있게 한다. 여러 마리(기능을 처음 열 때 지난 자료로 한꺼번에 받는
 * 때)면 작게 늘어놓고 도감으로 안내한다.
 */
export default function CatArrivalModal() {
  const { t } = useTranslation();
  const { go } = useNavigation();
  const projectId = useProject((state) => state.selectedProjectId);
  const { breedIds, canBring, bring, dismiss } = useCatArrivals(projectId);
  const single = breedIds.length === 1 ? catBreedOf(breedIds[0]) : undefined;

  return (
    <Modal
      isOpen={breedIds.length > 0}
      onClose={dismiss}
      title={single ? t('cats.arrival.title') : t('cats.arrival.many', { count: breedIds.length })}
      footer={
        <View className="flex-row justify-end gap-2">
          {single && canBring(single.id) ? (
            <FooterButton
              label={t('cats.arrival.bring')}
              onPress={() => {
                bring(single.id);
                dismiss();
              }}
            />
          ) : null}
          {!single ? (
            <FooterButton
              label={t('cats.arrival.openBook')}
              onPress={() => {
                dismiss();
                go('/settings/cats');
              }}
            />
          ) : null}
          <FooterButton label={t('cats.arrival.ok')} onPress={dismiss} primary />
        </View>
      }
    >
      {single ? (
        <View className="items-center gap-3 py-2">
          <Pop>
            <CatArt breedId={single.id} width={150} />
          </Pop>
          <Text className="text-xl font-bold text-gray-900">{t(catNameKey(single.id))}</Text>
          <Text
            className="overflow-hidden rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ color: CAT_RARITY_COLOR[single.rarity].text, backgroundColor: CAT_RARITY_COLOR[single.rarity].background }}
          >
            {t(CAT_RARITY_KEY[single.rarity])}
          </Text>
          <Text className="text-center text-sm text-gray-600">{t(catMissionKey(single.mission))}</Text>
        </View>
      ) : (
        <View className="flex-row flex-wrap py-2">
          {breedIds.map((id, index) => (
            <View key={id} className="w-1/3 items-center gap-1 pb-3">
              {/* 하나씩 차례로 튀어 오른다. 한꺼번에 오면 무엇이 왔는지 눈이 따라가지 못한다. */}
              <Pop delay={Math.min(index, 20) * 60}>
                <CatArt breedId={id} width={64} />
              </Pop>
              <Text className="text-center text-xs text-gray-700">{t(catNameKey(id))}</Text>
            </View>
          ))}
        </View>
      )}
    </Modal>
  );
}

function FooterButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      className={`items-center rounded-lg px-4 py-3 ${
        primary ? 'bg-blue-600 active:bg-blue-700' : 'border border-gray-300 bg-white active:bg-gray-50'
      }`}
    >
      <Text className={primary ? 'font-semibold text-white' : 'text-gray-700'}>{label}</Text>
    </Pressable>
  );
}

/** 작은 데서 한 번 넘쳤다가 제자리에 서며 나타난다. reanimated 를 쓰지 않는 까닭은 `motion.ts`. */
function Pop({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (reduceMotion) {
      scale.setValue(1);
      return;
    }
    const pop = Animated.sequence([
      Animated.delay(delay),
      Animated.spring(scale, { toValue: 1, damping: 9, stiffness: 180, useNativeDriver: true }),
    ]);
    pop.start();
    return () => pop.stop();
  }, [delay, reduceMotion, scale]);
  return (
    <Animated.View
      style={{
        opacity: scale.interpolate({ inputRange: [0.4, 0.8, 2], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
        transform: [{ scale }],
      }}
    >
      {children}
    </Animated.View>
  );
}
