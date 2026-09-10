/*
 * 보관함. 아직 거래가 아닌 후보를 정리하는 자리다.
 *
 * 탭이 셋이다. **알림**은 이 기기로 온 결제·입금 알림에서 읽어 둔 것이고, **이미지**는
 * 사용자가 고른 화면 캡처에서 읽어 낸 것이고, **반복**은 사람이 미리 적어 둔 일정에서
 * 스스로 만들어진 것이다. 셋 다 가계부에는 아무 영향이 없다 --
 * 합계·잔액·예산은 이 목록을 보지 않는다.
 *
 * 반복은 **이 화면을 여는 순간 밀린 회차를 따라잡는다**(`useRecurringRules`). 회차를
 * 만드는 일은 서버가 아니라 기기에 있고, 같은 회차는 두 번 담기지 않으므로(중복 열쇠)
 * 여러 기기가 겹쳐 열어도 탈이 없다.
 *
 * 후보를 누르면 값이 채워진 거래 추가 팝업이 뜬다. 저장이 끝난 뒤에야 후보에 등록
 * 표시가 남는다. 순서를 뒤집지 않는다 -- 표시를 먼저 남기면 저장이 실패했을 때
 * 아무도 그 후보를 다시 보지 못한다.
 *
 * 읽는 일과 담는 일은 이 화면이 하지 않는다. 알림 버퍼를 비우고 사진에서 글자를 뽑는
 * 것은 `src/inbox.ts` 가, 문구를 값으로 바꾸는 것은 core 의 `draft-parse` 가 한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Archive, Camera, ChevronDown, Plus, X } from 'lucide-react-native';
import type { EntryDraftDto, EntryDraftSource, RecurringRuleDto } from '@money/types';

import { formatDateTime } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useEntryDrafts } from '@money/core/hooks/useEntryDrafts';
import { useRecurringRules } from '@money/core/hooks/useRecurringRules';
import { useCanEdit, useProject, useProjectTimeZone } from '@money/core/store/project';
import { homeDataPort } from '@money/core/data/home-port';
import { draftNeedsFix } from '@money/core/lib/draft-collect';
import type { Account, Card, Category, Person } from '@money/core/lib/types';

import EntryEditor from '../components/EntryEditor';
import PageHeader from '../components/PageHeader';
import RecurringRuleModal from '../components/RecurringRuleModal';
import SegmentedTabs from '../components/SegmentedTabs';
import {
  collectCapture,
  collectNotifications,
  isInboxNativeAvailable,
  isNotificationAccessGranted,
  openNotificationAccessSettings,
} from '../inbox';

/** 갈래 이름. 후보의 금액 옆에 글자로 적는다. */
const KIND_KEY: Record<string, MessageKey> = {
  expense: 'editor.kind.expense',
  income: 'editor.kind.income',
  transfer: 'editor.kind.transfer',
  card_payment: 'editor.kind.card_payment',
};

/** 탭마다 다른 안내와 빈 목록 문구. 탭이 늘 때 조건문을 잇지 않으려고 표로 둔다. */
const LEAD_KEY: Record<EntryDraftSource, MessageKey> = {
  notification: 'inbox.lead.notification',
  capture: 'inbox.lead.capture',
  recurring: 'inbox.lead.recurring',
};

const EMPTY_KEY: Record<EntryDraftSource, MessageKey> = {
  notification: 'inbox.empty.notification',
  capture: 'inbox.empty.capture',
  recurring: 'inbox.empty.recurring',
};

/**
 * 주기를 한 줄로. "매월 25일", "3일마다".
 *
 * 규칙이 들고 있는 숫자를 그대로 보이면(everyDays=3, dayOfMonth=25) 무슨 뜻인지
 * 읽는 사람이 다시 옮겨야 한다.
 */
function scheduleText(rule: RecurringRuleDto.Response, t: (key: MessageKey) => string): string {
  if (rule.frequency === 'none') return t('inbox.freq.none');
  if (rule.frequency === 'daily') {
    const days = rule.everyDays ?? 1;
    return days <= 1 ? t('inbox.freq.daily') : `${days}${t('inbox.everyDaysUnit')}`;
  }

  const day = `${rule.dayOfMonth ?? 1}${t('inbox.dayOfMonthUnit')}`;
  if (rule.frequency === 'yearly') {
    return `${t('inbox.freq.yearly')} ${rule.month ?? 1}${t('inbox.monthUnit')} ${day}`;
  }
  return `${t('inbox.freq.monthly')} ${day}`;
}

export default function InboxScreen() {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();
  const canEdit = useCanEdit();

  const [source, setSource] = useState<EntryDraftSource>('notification');
  const inbox = useEntryDrafts(projectId, source);
  /*
   * 반복은 탭을 보고 있지 않아도 읽는다.
   *
   * 읽는 김에 밀린 회차를 만들기 때문이다(훅의 머리말). 반복 탭에 들어가야 후보가
   * 생긴다면, 그 탭에 들어가지 않는 사람에게는 반복이 없는 것과 같다.
   */
  const recurring = useRecurringRules(projectId);
  /** 고칠 반복. null 이면서 팝업이 열려 있으면 새로 만드는 중이다. */
  const [editingRule, setEditingRule] = useState<RecurringRuleDto.Response | null>(null);
  const [isRuleOpen, setIsRuleOpen] = useState(false);

  /** 지금 등록하려는 후보. 저장이 끝나면 이 후보에 표시를 남긴다. */
  const [registering, setRegistering] = useState<EntryDraftDto.Response | null>(null);
  /** 알림·안내. 빈 글자면 아무것도 그리지 않는다. */
  const [notice, setNotice] = useState('');
  const [isWorking, setIsWorking] = useState(false);

  /**
   * 통장·카드·분류·구성원.
   *
   * 사본에서 읽는다(창구가 앱에서는 사본이다). 두 곳이 쓴다 -- 후보 줄에 결제수단
   * 이름을 적는 데 쓰고, 반복 등록 팝업이 고를 목록으로 쓴다.
   */
  const [lists, setLists] = useState<{
    accounts: Account[];
    cards: Card[];
    categories: Category[];
    people: Person[];
  }>({ accounts: [], cards: [], categories: [], people: [] });
  useEffect(() => {
    if (!projectId) return;

    let alive = true;
    void (async () => {
      const port = homeDataPort();
      try {
        const [accounts, cards, categories, people] = await Promise.all([
          port.getAccountsV2(projectId),
          port.getCards(projectId),
          port.getCategories(projectId),
          port.getPeople(projectId),
        ]);
        if (!alive) return;
        setLists({
          accounts: accounts ?? [],
          cards: cards ?? [],
          categories: categories ?? [],
          people: people ?? [],
        });
      } catch {
        // 목록을 읽지 못해도 후보는 보여야 한다. 이름 자리만 빈다.
      }
    })();

    return () => {
      alive = false;
    };
  }, [projectId]);

  /**
   * 알림 접근이 켜져 있는가.
   *
   * 설정 화면에 다녀오면 값이 바뀌므로 화면이 다시 뜰 때마다 본다. 이 권한은 런타임
   * 요청으로 받을 수 없어 "확인 + 설정 열기" 두 걸음이다.
   */
  const [hasAccess, setHasAccess] = useState(() => isNotificationAccessGranted());

  /**
   * 쌓인 알림을 후보로 담는다.
   *
   * 화면을 열 때 한 번 돌고, "지금 확인하기"로 다시 돌 수 있다. 앱이 꺼져 있는 동안
   * 온 알림이 버퍼에 있어서, 이 걸음이 없으면 보관함이 비어 보인다.
   */
  const collect = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      if (!projectId || !isInboxNativeAvailable) return;

      try {
        setIsWorking(true);
        const result = await collectNotifications(projectId);
        if (result.added > 0) {
          setNotice(t('inbox.scanned', { count: result.added }));
          await inbox.reload();
        } else if (!options.quiet) {
          setNotice(t('inbox.scanNone'));
        }
      } catch {
        setNotice(t('inbox.actionFailed'));
      } finally {
        setIsWorking(false);
      }
    },
    [projectId, inbox, t],
  );

  // 화면을 열 때 조용히 한 번 담는다. 담을 것이 없으면 아무 말도 하지 않는다.
  useEffect(() => {
    setHasAccess(isNotificationAccessGranted());
    void collect({ quiet: true });
    // 열 때 한 번이다. collect 는 매번 새로 만들어지므로 의존성에 두지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /** 캡처를 고르고 읽는다. 사진은 이 기기 안에서만 읽힌다. */
  const pickCapture = async () => {
    if (!projectId) return;

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // 자르기를 켜지 않는다. 목록 캡처는 위아래가 잘리면 그만큼 거래를 잃는다.
      allowsEditing: false,
      quality: 1,
    });
    if (picked.canceled || !picked.assets[0]) return;

    try {
      setIsWorking(true);
      setNotice(t('inbox.reading'));
      const result = await collectCapture(projectId, picked.assets[0].uri);

      if (result.found === 0) {
        setNotice(t('inbox.captureNone'));
        return;
      }
      setNotice(t('inbox.scanned', { count: result.added }));
      setSource('capture');
      await inbox.reload();
    } catch {
      setNotice(t('inbox.readFailed'));
    } finally {
      setIsWorking(false);
    }
  };

  /**
   * 주기 없는 반복의 "만들기". 오늘 날짜로 후보 하나를 담고 목록을 다시 읽는다.
   *
   * 알림 문구를 **여기서** 적는다. 밀린 회차를 세는 효과(아래 `handledMade`)에 맡기면
   * 두 번째 누름에서 말이 뜨지 않는다 -- 그 효과는 담긴 수가 **바뀔 때만** 도는데,
   * 한 건씩 만들면 그 수가 1 에 머무른다. 첫 누름에서는 둘이 같은 말을 적으므로
   * 겹쳐 보이지 않는다.
   */
  const makeNow = async (rule: RecurringRuleDto.Response) => {
    if (!(await recurring.makeNow(rule))) return;

    setNotice(t('inbox.ruleMade', { count: 1 }));
    await inbox.reload();
  };

  /**
   * 후보를 거래로.
   *
   * 후보는 전표가 아니라 폼이 받는 값의 묶음이다. 편집기에 `draft` 로 넘기면 core 의
   * `entryFormFromDraft` 가 빈 폼 위에 읽은 것만 덮는다.
   */
  const openDraft = (draft: EntryDraftDto.Response) => {
    setNotice('');
    setRegistering(draft);
  };

  /*
   * 방금 만들어진 반복 후보를 목록에 들인다.
   *
   * 두 훅이 따로 읽으므로 후보 목록은 반복이 돌기 **전**의 것일 수 있다. 그러면
   * "3건을 만들었습니다"라고 적어 놓고 목록은 비어 있는 화면이 된다.
   *
   * 목록을 다시 읽는 함수는 그릴 때마다 새로 만들어지므로 의존성에 넣으면 그 자리에서
   * 무한히 돈다 -- 그래서 최신 것을 상자에 담고, 처리한 수를 기억해 한 번만 돈다.
   */
  const reloadDrafts = useRef(inbox.reload);
  useEffect(() => {
    reloadDrafts.current = inbox.reload;
  });
  const handledMade = useRef(0);
  useEffect(() => {
    if (recurring.created === 0 || recurring.created === handledMade.current) return;
    handledMade.current = recurring.created;
    setNotice(t('inbox.ruleMade', { count: recurring.created }));
    void reloadDrafts.current();
  }, [recurring.created, t]);

  /** 반복을 만들거나 고친다. 저장되면 목록과 후보가 함께 새로 읽힌다. */
  const saveRule = async (body: RecurringRuleDto.Body): Promise<boolean> => {
    const ok = await recurring.save(editingRule ? { ...body, id: editingRule.id } : body);
    if (ok) {
      setNotice(t('inbox.ruleSaved'));
      await inbox.reload();
    }
    return ok;
  };

  /** 저장이 끝난 뒤. 만든 거래가 있을 때만 후보에 표시를 남긴다. */
  const handleSaved = async (result: { entryId: string | null }) => {
    const draft = registering;
    if (!draft || !result.entryId) return;

    if (await inbox.markRegistered(draft.id, result.entryId)) {
      setNotice(t('inbox.registered'));
    }
  };

  const lead = t(LEAD_KEY[source]);
  const empty = t(EMPTY_KEY[source]);

  return (
    <View className="gap-4 py-2">
      <PageHeader title={t('inbox.title')} showBack />

      <SegmentedTabs
        tabs={[
          {
            id: 'notification' as const,
            label:
              inbox.counts.notification > 0
                ? `${t('inbox.tab.notification')} ${inbox.counts.notification}`
                : t('inbox.tab.notification'),
          },
          {
            id: 'capture' as const,
            label:
              inbox.counts.capture > 0
                ? `${t('inbox.tab.capture')} ${inbox.counts.capture}`
                : t('inbox.tab.capture'),
          },
          {
            id: 'recurring' as const,
            label:
              inbox.counts.recurring > 0
                ? `${t('inbox.tab.recurring')} ${inbox.counts.recurring}`
                : t('inbox.tab.recurring'),
          },
        ]}
        selected={source}
        onSelect={setSource}
      />

      <Text className="text-sm text-gray-600">{lead}</Text>

      {/*
        알림 탭의 권한 안내.

        권한이 없으면 이 기능은 아무것도 하지 않으므로, 목록이 빈 까닭을 여기서 말해
        준다. 무엇을 읽고 무엇을 보내지 않는지도 함께 적는다 -- 알림을 읽는 권한은
        사용자가 그 값을 알고 켜야 하는 것이다.
      */}
      {source === 'recurring' ? (
        /*
          예약해 둔 것.

          후보 목록 **위**에 둔다. 이 탭에 온 사람의 볼일은 대개 "무엇이 예약돼
          있는가"이고, 아래 후보는 그 결과이기 때문이다.
        */
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-gray-700">{t('inbox.rules')}</Text>
            {canEdit ? (
              <Pressable
                onPress={() => {
                  setEditingRule(null);
                  setIsRuleOpen(true);
                }}
                className="flex-row items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 active:bg-blue-700"
              >
                <Plus size={16} color="#ffffff" />
                <Text className="text-sm font-semibold text-white">{t('inbox.ruleAdd')}</Text>
              </Pressable>
            ) : null}
          </View>

          {recurring.error ? (
            <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <Text className="text-sm text-red-800">{recurring.error}</Text>
            </View>
          ) : null}

          {recurring.isLoading ? (
            <Text className="text-sm text-gray-600">{t('common.loading')}</Text>
          ) : recurring.rules.length === 0 ? (
            <View className="rounded-lg border border-dashed border-gray-300 px-3 py-6">
              <Text className="text-center text-sm text-gray-500">{t('inbox.rulesEmpty')}</Text>
            </View>
          ) : (
            <View className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              {recurring.rules.map((rule, index) => (
                <View key={rule.id} className={index > 0 ? 'border-t border-gray-100' : undefined}>
                  <RuleRow
                    rule={rule}
                    canEdit={canEdit}
                    onEdit={() => {
                      setEditingRule(rule);
                      setIsRuleOpen(true);
                    }}
                    onToggle={() => void recurring.toggle(rule.id, !rule.isActive)}
                    onMakeNow={() => void makeNow(rule)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      ) : source === 'notification' ? (
        <View className="gap-2 rounded-lg border border-gray-200 bg-white p-4">
          {!isInboxNativeAvailable ? (
            <Text className="text-sm text-amber-800">{t('inbox.appOnly')}</Text>
          ) : hasAccess ? (
            <>
              <Text className="text-sm text-green-700">{t('inbox.permissionOn')}</Text>
              <Pressable
                onPress={() => void collect()}
                disabled={isWorking}
                className={`items-center rounded-lg border border-blue-300 px-4 py-3 ${
                  isWorking ? 'opacity-50' : 'active:bg-blue-50'
                }`}
              >
                <Text className="text-sm font-medium text-blue-700">{t('inbox.scan')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text className="text-base font-semibold text-gray-900">
                {t('inbox.permissionTitle')}
              </Text>
              <Text className="text-sm text-gray-600">{t('inbox.permissionBody')}</Text>
              <Pressable
                onPress={() => {
                  openNotificationAccessSettings();
                  /*
                   * 설정에서 돌아왔을 때를 대비해 잠시 뒤 다시 본다.
                   *
                   * 이 화면은 그동안 살아 있고 다시 그려질 까닭이 없어서, 켜고 돌아와도
                   * 안내가 그대로 남아 "켰는데 왜 그대로냐"가 된다.
                   */
                  setTimeout(() => setHasAccess(isNotificationAccessGranted()), 1500);
                }}
                className="items-center rounded-lg bg-blue-600 px-4 py-3 active:bg-blue-700"
              >
                <Text className="text-base font-semibold text-white">
                  {t('inbox.permissionOpen')}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <Pressable
          onPress={() => void pickCapture()}
          disabled={isWorking || !isInboxNativeAvailable}
          className={`flex-row items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 ${
            isWorking || !isInboxNativeAvailable ? 'opacity-50' : 'active:bg-blue-700'
          }`}
        >
          <Camera size={18} color="#ffffff" />
          <Text className="text-base font-semibold text-white">{t('inbox.pick')}</Text>
        </Pressable>
      )}

      {notice ? (
        <View className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <Text className="text-sm text-amber-800">{notice}</Text>
        </View>
      ) : null}

      {inbox.error ? (
        <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <Text className="text-sm text-red-800">{inbox.error}</Text>
        </View>
      ) : null}

      {isWorking ? <ActivityIndicator /> : null}

      {inbox.isLoading ? (
        <Text className="text-sm text-gray-600">{t('common.loading')}</Text>
      ) : inbox.drafts.length === 0 ? (
        <View className="items-center gap-2 rounded-lg border border-dashed border-gray-300 py-12">
          <Archive size={24} color="#9ca3af" />
          <Text className="text-sm text-gray-500">{empty}</Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {inbox.drafts.map((draft, index) => (
            <View
              key={draft.id}
              className={index > 0 ? 'border-t border-gray-100' : undefined}
            >
              <DraftRow
                draft={draft}
                timeZone={timeZone}
                methodName={
                  [...lists.cards, ...lists.accounts].find(
                    (row) => row.id === (draft.cardId ?? draft.accountId),
                  )?.name ?? null
                }
                canEdit={canEdit}
                onAdd={() => openDraft(draft)}
                onDismiss={() => void inbox.dismiss(draft.id)}
              />
            </View>
          ))}
        </View>
      )}

      {/*
        거래 추가 팝업. 후보를 누른 동안만 세운다.

        `editing` 이 아니라 `draft` 로 넘긴다. 저장하면 새 거래가 되고, 후보는 그
        거래의 id 를 받아 등록됨으로 표시된다.
      */}
      <RecurringRuleModal
        isOpen={isRuleOpen}
        rule={editingRule}
        lists={lists}
        onClose={() => setIsRuleOpen(false)}
        onSave={saveRule}
        onDelete={(id) => recurring.remove(id)}
      />

      {registering ? (
        <EntryEditor
          isOpen
          draft={registering}
          onClose={() => setRegistering(null)}
          onSaved={handleSaved}
          onNotEditable={() => setNotice(t('editor.notEditable'))}
        />
      ) : null}
    </View>
  );
}

/**
 * 예약해 둔 반복 한 줄.
 *
 * 다음에 만들어질 날을 아래에 둔다. 예약을 보는 까닭이 "언제 또 생기는가"이고,
 * 꺼 둔 것은 그 자리에 날 대신 "예정 없음"이 온다.
 */
function RuleRow({
  rule,
  canEdit,
  onEdit,
  onToggle,
  onMakeNow,
}: {
  rule: RecurringRuleDto.Response;
  canEdit: boolean;
  onEdit: () => void;
  onToggle: () => void;
  /** 주기 없는 반복의 "만들기". 오늘 날짜로 후보 하나를 담는다. */
  onMakeNow: () => void;
}) {
  const { t } = useTranslation();

  /*
    주기가 없으면 켜고 끄는 단추 자리에 "만들기" 가 선다.

    끄고 켜는 것은 "정해진 날에 저절로 만들어질지"를 정하는 값이다. 저절로 만들어지는
    일이 없는 반복에서 그 단추는 아무것도 바꾸지 않으면서 자리를 차지한다. 대신 그
    자리에서 지금 하나를 만든다.
  */
  const isManual = rule.frequency === 'none';

  /*
    상자 전체가 "고치기" 다.

    연필 아이콘을 따로 두면 줄에서 누를 자리가 아이콘 한 칸뿐이라, 예약을 고치려고
    매번 좁은 표적을 맞혀야 했다. 아래 후보 목록도 같은 규칙이다.

    켜고 끄는 단추는 그대로 둔다. "고치기" 와 다른 일이라 상자에 맡길 수 없다. RN 은
    자식 Pressable 이 누름을 가져가므로 부모까지 올라가지 않는다.
  */
  return (
    <Pressable
      onPress={canEdit ? onEdit : undefined}
      disabled={!canEdit}
      accessibilityRole="button"
      accessibilityLabel={canEdit ? t('inbox.ruleEdit') : undefined}
      className={`flex-row items-center gap-3 p-4 ${canEdit ? 'active:bg-gray-50' : ''}`}
    >
      <View className="flex-1">
        <Text
          className={`font-medium ${rule.isActive ? 'text-gray-900' : 'text-gray-400'}`}
          numberOfLines={1}
        >
          {rule.description}
        </Text>
        <Text className="mt-0.5 text-xs text-gray-500">
          {[
            scheduleText(rule, t),
            rule.amount ? formatCurrency(rule.amount, rule.currency ?? 'KRW') : null,
            // 주기가 없으면 예정일 자리를 비운다. 주기 칸이 이미 "수동생성"을 말한다.
            isManual
              ? null
              : rule.nextRunOn
                ? t('inbox.ruleNext', { date: rule.nextRunOn })
                : t('inbox.ruleNextNone'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      {canEdit ? (
        <Pressable
          onPress={isManual ? onMakeNow : onToggle}
          hitSlop={6}
          accessibilityRole="button"
          className={`rounded-lg border px-3 py-2 ${
            isManual
              ? 'border-blue-600 bg-blue-600 active:bg-blue-700'
              : rule.isActive
                ? 'border-blue-300 bg-blue-50'
                : 'border-gray-300'
          }`}
        >
          <Text
            className={`text-xs font-medium ${
              isManual ? 'text-white' : rule.isActive ? 'text-blue-700' : 'text-gray-500'
            }`}
          >
            {isManual
              ? t('inbox.ruleMakeNow')
              : t(rule.isActive ? 'inbox.ruleActive' : 'inbox.rulePaused')}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * 후보 한 줄.
 *
 * 금액이 맨 위다. 후보를 보는 까닭이 "얼마짜리를 적을 것인가"이고, 못 읽은 금액은
 * 그 자리에 그렇다고 적는다 -- 비워 두면 0원처럼 읽힌다.
 *
 * **상자 전체가 "거래로 적기" 다.** 아래에 파란 단추를 따로 두었더니 줄에서 누를 자리가
 * 셋(단추·무시·원문)이 되어, 제일 흔한 일이 제일 아래에 있었다. 안에 있는 무시와 원문
 * 펼치기는 RN 의 누름 임자 규칙에 따라 부모까지 올라가지 않는다.
 *
 * 지우기(휴지통)는 두지 않는다. 무시와 겉보기가 같아서 -- 둘 다 줄이 사라진다 --
 * 어느 쪽이 무엇인지 알 수 없었다. 남긴 것은 **무시** 다. 표시가 남아 같은 알림이
 * 다시 담기지 않는다. 지우기는 표시까지 없애 같은 알림이 다시 오면 후보가 다시 생긴다.
 */
function DraftRow({
  draft,
  timeZone,
  methodName,
  canEdit,
  onAdd,
  onDismiss,
}: {
  draft: EntryDraftDto.Response;
  timeZone: string;
  /** 찾아 둔 카드·통장 이름. 없으면 사람이 폼에서 고른다. */
  methodName: string | null;
  canEdit: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [isRawOpen, setIsRawOpen] = useState(false);

  /** 사람이 채워야 하는 칸이 남았는가. 금액·결제수단·대분류 셋을 본다. */
  const needsFix = draftNeedsFix(draft);

  return (
    <Pressable
      onPress={canEdit ? onAdd : undefined}
      disabled={!canEdit}
      accessibilityRole="button"
      accessibilityLabel={canEdit ? t('inbox.add') : undefined}
      className={`gap-2 p-4 ${canEdit ? 'active:bg-gray-50' : ''}`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {draft.amount
              ? formatCurrency(draft.amount, draft.currency ?? 'KRW')
              : t('inbox.amountUnknown')}
          </Text>
          <Text className="text-sm text-gray-700" numberOfLines={1}>
            {draft.description || draft.merchant || draft.appTitle || t('entry.noTitle')}
          </Text>
          <Text className="mt-1 text-xs text-gray-500">
            {[
              draft.kind ? t(KIND_KEY[draft.kind] ?? 'tx.detail.kind') : null,
              draft.occurredAt ? formatDateTime(draft.occurredAt, timeZone) : null,
              // 찾아 둔 결제수단. 이름이 있으면 그 칸은 사람이 고를 일이 없다.
              methodName,
              t('inbox.confidence', { value: draft.confidence }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        {canEdit ? (
          <Pressable
            onPress={onDismiss}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('inbox.dismiss')}
            className="h-9 w-9 items-center justify-center rounded-lg border border-gray-300 active:bg-gray-50"
          >
            <X size={16} color="#4b5563" />
          </Pressable>
        ) : null}
      </View>

      {needsFix ? (
        <Text className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {t('inbox.needsFix')}
        </Text>
      ) : null}

      {/*
        읽은 원문. 접어 둔다.

        파싱이 틀렸을 때 무엇을 보고 그렇게 됐는지 아는 유일한 근거라 버리지 않고,
        목록의 본론이 아니라 펼쳐야 보인다.
      */}
      <Pressable onPress={() => setIsRawOpen(!isRawOpen)} className="flex-row items-center gap-1">
        <ChevronDown size={12} color="#6b7280" />
        <Text className="text-xs text-gray-500">{t('inbox.raw')}</Text>
      </Pressable>
      {isRawOpen ? (
        <ScrollView horizontal className="rounded bg-gray-50 p-2">
          <Text className="text-xs text-gray-600">{draft.rawText}</Text>
        </ScrollView>
      ) : null}
    </Pressable>
  );
}
