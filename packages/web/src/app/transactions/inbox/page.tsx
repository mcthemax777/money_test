'use client';

/*
 * 보관함. 아직 거래가 아닌 후보를 정리하는 자리다.
 *
 * 탭이 셋이다. **알림**은 기기로 온 결제·입금 알림에서 읽어 둔 것이고, **이미지**는
 * 사용자가 올린 화면 캡처에서 읽어 낸 것이고, **반복**은 사람이 미리 적어 둔 일정에서
 * 스스로 만들어진 것이다. 셋 다 가계부에는 아무 영향이 없다 --
 * 합계·잔액·예산은 이 목록을 보지 않는다.
 *
 * 반복은 **이 화면을 여는 순간 밀린 회차를 따라잡는다**(`useRecurringRules`). 회차를
 * 만드는 일은 서버가 아니라 기기에 있고, 같은 회차는 두 번 담기지 않으므로(중복 열쇠)
 * 여러 기기가 겹쳐 열어도 탈이 없다.
 *
 * 후보를 누르면 값이 채워진 거래 추가 팝업이 뜬다. 저장하면 그때 거래가 만들어지고,
 * 그 뒤에야 후보에 등록 표시가 남는다. 순서를 뒤집지 않는다 -- 표시를 먼저 남기면
 * 저장이 실패했을 때 아무도 그 후보를 다시 보지 못한다.
 *
 * **캡처는 이 화면에서도 읽는다.** 사진을 끌어다 놓거나 붙여넣으면 브라우저 안에서
 * (tesseract.js) 글자를 읽고, 그 글자를 앱과 **같은 규칙**(core 의 `draft-parse`)에
 * 통과시켜 후보를 만든다. 사진은 서버로 가지 않는다 -- 앱에서 기기 OCR 로 하는 일과
 * 성질이 같다.
 *
 * 알림 등록은 안드로이드만 할 수 있어 앱이 맡는다. 그쪽 탭은 담긴 것을 정리하는
 * 자리이고, 화면에 그 사실을 적어 둔다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  Camera,
  Bell,
  ChevronDown,
  Plus,
  Repeat,
  X,
} from 'lucide-react';
import type { EntryDraftDto, EntryDraftSource, RecurringRuleDto } from '@money/types';

import { formatDateTime } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useEntryDrafts } from '@money/core/hooks/useEntryDrafts';
import { useRecurringRules } from '@money/core/hooks/useRecurringRules';
import { useCanEdit, useProjectTimeZone } from '@money/core/store/project';
import { homeDataPort } from '@money/core/data/home-port';
import { draftPort } from '@money/core/data/draft-port';
import {
  captureItems,
  draftNeedsFix,
  historyFromEntries,
  NO_HINTS,
  type CollectHints,
} from '@money/core/lib/draft-collect';
import type { Account, Card, Category, Person, Tag } from '@money/core/lib/types';

import CaptureDropzone from '@/components/CaptureDropzone';
import RecurringRuleModal from '@/components/RecurringRuleModal';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import { recognizeCapture, releaseCaptureWorker, type OcrProgress } from '@/lib/capture-ocr';
import PageHeader from '@/components/PageHeader';
import PageLoading from '@/components/PageLoading';
import { useProjectGuard } from '@/hooks/useProjectGuard';

/**
 * 거래 추가 팝업이 고를 목록 (통장·카드·분류·구성원).
 *
 * 이 화면 자신은 이 목록을 쓰지 않는다. 팝업이 필요해서 여는 것이라 여기 작게 둔다 --
 * 홈·자산 화면의 훅(`useHomeData`)은 합계와 그래프까지 함께 읽어 이 화면에는 과하다.
 */
function useReferenceLists(projectId: string | null) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    if (!projectId) return;

    let alive = true;
    void (async () => {
      const port = homeDataPort();
      try {
        const [accountRows, cardRows, categoryRows, personRows, tagRows] = await Promise.all([
          port.getAccountsV2(projectId),
          port.getCards(projectId),
          port.getCategories(projectId),
          port.getPeople(projectId),
          port.getTags(projectId),
        ]);
        if (!alive) return;
        setAccounts(accountRows ?? []);
        setCards(cardRows ?? []);
        setCategories(categoryRows ?? []);
        setPeople(personRows ?? []);
        setTags(tagRows ?? []);
      } catch {
        // 목록을 읽지 못해도 보관함은 보여야 한다. 팝업에서 고를 것이 없을 뿐이다.
      }
    })();

    return () => {
      alive = false;
    };
  }, [projectId]);

  /** 팝업 안에서 계좌·카드·분류·구성원을 새로 만들었을 때. 바뀐 목록만 온다. */
  const apply = useCallback((patch: ReferenceDataPatch) => {
    if (patch.accounts) setAccounts(patch.accounts);
    if (patch.cards) setCards(patch.cards);
    if (patch.categories) setCategories(patch.categories);
    if (patch.people) setPeople(patch.people);
  }, []);

  return { accounts, cards, categories, people, tags, apply };
}

/**
 * 맞춤에 쓸 재료를 모은다.
 *
 * 계좌·카드는 이 화면이 이미 읽어 둔 것을 쓰고(팝업이 고를 목록과 같다), 지난 거래는
 * 여기서 한 번 읽는다. 사진 한 장에서 대여섯 건이 나오므로 건마다 물으면 같은 조회가
 * 되풀이된다.
 *
 * 읽지 못해도 담기는 멈추지 않는다 -- 결제수단과 분류가 빈 후보가 되고 사람이 고른다.
 */
async function loadHints(
  projectId: string,
  reference: { accounts: Account[]; cards: Card[] },
): Promise<CollectHints> {
  try {
    const recent = await homeDataPort().getEntries({ limit: 200 }, projectId);
    return {
      accounts: reference.accounts,
      cards: reference.cards,
      history: historyFromEntries(recent.data),
    };
  } catch {
    return { ...NO_HINTS, accounts: reference.accounts, cards: reference.cards };
  }
}

/** 후보에 붙은 카드·통장의 이름. 못 찾았으면 null 이고 화면이 "빈 칸"이라고 적는다. */
function methodNameOf(
  draft: EntryDraftDto.Response,
  lists: { accounts: Account[]; cards: Card[] },
): string | null {
  if (draft.cardId) return lists.cards.find((card) => card.id === draft.cardId)?.name ?? null;
  if (draft.accountId) {
    return lists.accounts.find((account) => account.id === draft.accountId)?.name ?? null;
  }
  return null;
}

const TABS: Array<{ id: EntryDraftSource; labelKey: MessageKey; icon: typeof Bell }> = [
  { id: 'notification', labelKey: 'inbox.tab.notification', icon: Bell },
  { id: 'capture', labelKey: 'inbox.tab.capture', icon: Camera },
  { id: 'recurring', labelKey: 'inbox.tab.recurring', icon: Repeat },
];

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

/** 갈래 이름. 후보의 금액 색과 같은 뜻을 글자로 적는다. */
const KIND_KEY: Record<string, MessageKey> = {
  expense: 'editor.kind.expense',
  income: 'editor.kind.income',
  transfer: 'editor.kind.transfer',
  card_payment: 'editor.kind.card_payment',
};

export default function InboxPage() {
  const { t } = useTranslation();
  const selectedProjectId = useProjectGuard();
  const timeZone = useProjectTimeZone();
  const canEdit = useCanEdit();

  const [source, setSource] = useState<EntryDraftSource>('notification');
  const inbox = useEntryDrafts(selectedProjectId, source);
  /*
   * 반복은 탭을 보고 있지 않아도 읽는다.
   *
   * 읽는 김에 밀린 회차를 만들기 때문이다(훅의 머리말). 반복 탭에 들어가야 후보가
   * 생긴다면, 그 탭에 들어가지 않는 사람에게는 반복이 없는 것과 같다.
   */
  const recurring = useRecurringRules(selectedProjectId);
  /** 고칠 반복. null 이면서 팝업이 열려 있으면 새로 만드는 중이다. */
  const [editingRule, setEditingRule] = useState<RecurringRuleDto.Response | null>(null);
  const [isRuleOpen, setIsRuleOpen] = useState(false);

  /** 거래 추가 팝업. 후보를 누르면 값이 채워진 채로 열린다. */
  const editorRef = useRef<EntryEditorHandle>(null);
  /**
   * 지금 등록하려는 후보.
   *
   * 팝업에서 저장이 끝났을 때 어느 후보에 표시를 남길지 알아야 한다. 팝업은 후보를
   * 모르고 폼 값만 들고 있으므로 그 연결을 이 화면이 기억한다.
   */
  const [registering, setRegistering] = useState<EntryDraftDto.Response | null>(null);
  const [notice, setNotice] = useState('');
  /** 사진을 읽는 중인가. 읽는 동안 두 번째 사진을 받지 않는다. */
  const [reading, setReading] = useState<{ name: string; progress: OcrProgress } | null>(null);

  const reference = useReferenceLists(selectedProjectId);

  /*
   * 화면을 떠날 때 인식 일꾼을 놓아 준다.
   *
   * 탭이 살아 있는 동안 하나를 두어 두 번째 사진을 빠르게 읽지만, 이 화면을 나가면
   * 쓸 일이 없다. 남겨 두면 WASM 메모리(수십 MB)가 그대로 잡혀 있다.
   */
  useEffect(() => {
    return () => {
      void releaseCaptureWorker();
    };
  }, []);

  /**
   * 올린 사진을 후보로.
   *
   * 브라우저에서 글자를 읽고(`recognizeCapture`), core 의 규칙으로 후보를 만들고
   * (`captureItems`), 서버에 담는다. 사진은 이 자리를 벗어나지 않는다.
   *
   * 여러 장을 놓으면 한 장씩 읽는다. 동시에 읽으면 WASM 일꾼 하나를 서로 기다리게
   * 되고, 진행 표시도 어느 사진의 것인지 알 수 없게 된다.
   */
  const readCaptures = async (files: File[]) => {
    if (!selectedProjectId) return;

    setNotice('');
    let added = 0;
    let found = 0;

    try {
      const hints = await loadHints(selectedProjectId, reference);

      for (const file of files) {
        setReading({ name: file.name, progress: { percent: 0, status: '' } });

        const text = await recognizeCapture(file, (progress) =>
          setReading((current) => (current ? { ...current, progress } : current)),
        );
        const items = captureItems(text, hints);
        found += items.length;
        if (items.length === 0) continue;

        const result = await draftPort().add(selectedProjectId, items);
        added += result.created;
      }
    } catch {
      setNotice(t('inbox.readFailed'));
      return;
    } finally {
      setReading(null);
    }

    if (found === 0) {
      setNotice(t('inbox.captureNone'));
      return;
    }

    setNotice(t('inbox.scanned', { count: added }));
    await inbox.reload();
  };

  const activeTabIndex = Math.max(0, TABS.findIndex((tab) => tab.id === source));

  const lead = t(LEAD_KEY[source]);
  const empty = t(EMPTY_KEY[source]);

  /*
   * 방금 만들어진 반복 후보를 목록에 들인다.
   *
   * 두 훅이 따로 읽으므로 후보 목록은 반복이 돌기 **전**의 것일 수 있다. 그러면
   * "3건을 만들었습니다"라고 적어 놓고 목록은 비어 있는 화면이 된다.
   *
   * 같은 수를 두 번 처리하지 않으려고 마지막으로 처리한 값을 들고 있는다. 목록을
   * 다시 읽는 함수는 그릴 때마다 새로 만들어지므로 의존성에 넣으면 그 자리에서
   * 무한히 돈다 -- 그래서 최신 것을 상자에 담아 둔다.
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

  /** 후보를 거래로. 팝업이 뜨고, 저장이 끝나면 `onEntryChange` 가 표시를 남긴다. */
  const openDraft = (draft: EntryDraftDto.Response) => {
    setNotice('');
    setRegistering(draft);
    editorRef.current?.openDraft(draft);
  };

  /**
   * 저장·삭제가 끝난 뒤.
   *
   * 만든 거래가 있고 그것을 등록하려던 후보가 있으면 표시를 남긴다. 팝업을 열었다가
   * 그냥 닫은 경우에는 `entryId` 가 오지 않으므로 후보는 대기로 남는다.
   */
  const handleEntryChange = async (result?: { entryId: string | null }) => {
    const draft = registering;
    setRegistering(null);
    if (!draft || !result?.entryId) return;

    if (await inbox.markRegistered(draft.id, result.entryId)) {
      setNotice(t('inbox.registered'));
    }
  };

  if (!selectedProjectId) return <PageLoading />;

  return (
    <div className="space-y-4">
      <PageHeader title={t('inbox.title')} backHref="/transactions" />

      {/* 탭. 거래 화면의 탭과 같은 모양이다(흰 알약이 미끄러진다). */}
      <div className="relative flex gap-2 rounded-lg bg-gray-200 p-1">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-1 rounded-md bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{
            width: `calc((100% - ${TABS.length * 0.5}rem) / ${TABS.length})`,
            transform: `translateX(calc(${activeTabIndex} * (100% + 0.5rem)))`,
          }}
        />
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const count = inbox.counts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSource(tab.id)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-4 py-2 font-medium ${
                source === tab.id ? 'text-blue-600' : 'text-gray-600'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(tab.labelKey)}
              {count > 0 ? <span className="font-semibold">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-gray-600">{lead}</p>

      {source === 'recurring' ? (
        /*
          예약해 둔 것.

          후보 목록 **위**에 둔다. 이 탭에 온 사람의 볼일은 대개 "무엇이 예약돼
          있는가"이고, 아래 후보는 그 결과이기 때문이다.
        */
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">{t('inbox.rules')}</h2>
            {canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setEditingRule(null);
                  setIsRuleOpen(true);
                }}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t('inbox.ruleAdd')}
              </button>
            ) : null}
          </div>

          {recurring.error ? (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{recurring.error}</div>
          ) : null}

          {recurring.isLoading ? (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          ) : recurring.rules.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500">
              {t('inbox.rulesEmpty')}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {recurring.rules.map((rule) => (
                <li key={rule.id}>
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
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : source === 'notification' ? (
        /*
          알림 등록은 앱에서 켠다는 안내.

          감추지 않고 적어 둔다. 이 화면만 본 사람은 "왜 아무것도 담기지 않는가"를
          알 수 없고, 그 답이 화면 밖에 있으면 찾을 방법이 없다.
        */
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {t('inbox.notificationAppOnly')}
        </p>
      ) : (
        <div className="space-y-2">
          <CaptureDropzone onPick={(files) => void readCaptures(files)} disabled={reading !== null} />

          {reading ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              <p>{t('inbox.readingFile', { name: reading.name })}</p>
              <p className="text-xs">
                {t('inbox.readingProgress', { percent: reading.progress.percent })}
              </p>
              {/*
                처음 한 번은 모델을 받아 오느라 느리다. 그 사실을 말해 주지 않으면
                멈춘 것으로 읽고 화면을 떠난다.
              */}
              <p className="mt-1 text-xs text-blue-700">{t('inbox.readingFirstRun')}</p>
            </div>
          ) : null}
        </div>
      )}

      {inbox.error ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{inbox.error}</div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </div>
      ) : null}

      {inbox.isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : inbox.drafts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 py-12">
          <Archive className="h-6 w-6 text-gray-400" aria-hidden />
          <p className="text-sm text-gray-500">{empty}</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {inbox.drafts.map((draft) => (
            <li key={draft.id}>
              <DraftRow
                draft={draft}
                timeZone={timeZone}
                methodName={methodNameOf(draft, reference)}
                canEdit={canEdit}
                onAdd={() => openDraft(draft)}
                onDismiss={() => void inbox.dismiss(draft.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <EntryEditor
        ref={editorRef}
        projectId={selectedProjectId}
        accounts={reference.accounts}
        cards={reference.cards}
        categories={reference.categories}
        people={reference.people}
        onReferenceDataChange={reference.apply}
        onEntryChange={handleEntryChange}
      />

      <RecurringRuleModal
        isOpen={isRuleOpen}
        rule={editingRule}
        lists={reference}
        onClose={() => setIsRuleOpen(false)}
        onSave={saveRule}
        onDelete={(id) => recurring.remove(id)}
      />
    </div>
  );
}

/**
 * 예약해 둔 반복 한 줄.
 *
 * 다음에 만들어질 날을 오른쪽에 둔다. 예약을 보는 까닭이 "언제 또 생기는가"이고,
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

    연필 아이콘을 따로 두면 줄에서 누를 수 있는 자리가 아이콘 한 칸뿐이라, 예약을
    고치려고 매번 9px 짜리 표적을 맞혀야 했다. 줄을 눌러 고치는 것은 아래 후보 목록도
    같은 규칙이다.

    켜고 끄는 단추는 그대로 둔다. 그것은 "고치기"와 다른 일이라 상자에 맡길 수 없다 --
    그래서 누름이 상자까지 올라가지 않게 막는다(stopPropagation).
  */
  return (
    <div
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={canEdit ? onEdit : undefined}
      onKeyDown={
        canEdit
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onEdit();
            }
          : undefined
      }
      aria-label={canEdit ? t('inbox.ruleEdit') : undefined}
      className={`flex items-center gap-3 p-4 text-left ${
        canEdit ? 'cursor-pointer hover:bg-gray-50' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`truncate font-medium ${rule.isActive ? 'text-gray-900' : 'text-gray-400'}`}>
          {rule.description}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>{scheduleText(rule, t)}</span>
          {rule.amount ? <span>{formatCurrency(rule.amount, rule.currency ?? 'KRW')}</span> : null}
          {/* 주기가 없으면 예정일 자리를 비운다. 주기 칸이 이미 "수동생성"을 말한다. */}
          {isManual ? null : (
            <span>
              {rule.nextRunOn
                ? t('inbox.ruleNext', { date: rule.nextRunOn })
                : t('inbox.ruleNextNone')}
            </span>
          )}
        </p>
      </div>

      {canEdit ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (isManual) onMakeNow();
            else onToggle();
          }}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            isManual
              ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
              : rule.isActive
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-300 text-gray-500'
          }`}
        >
          {isManual
            ? t('inbox.ruleMakeNow')
            : t(rule.isActive ? 'inbox.ruleActive' : 'inbox.rulePaused')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * 후보 한 줄.
 *
 * 금액을 맨 앞에 크게 둔다. 후보를 보는 까닭이 "얼마짜리를 적을 것인가"이고, 못 읽은
 * 금액은 그 자리에 그렇다고 적어 둔다 -- 빈 칸으로 두면 0원처럼 읽힌다.
 *
 * **상자 전체가 "거래로 적기" 다.** 파란 단추를 따로 두었더니 줄에 누를 자리가 셋
 * (단추·무시·원문)이 되어, 제일 흔한 일이 제일 좁은 자리에 있었다. 안에 있는 무시와
 * 원문 펼치기는 누름이 상자까지 올라가지 않게 막는다.
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
    <div
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={canEdit ? onAdd : undefined}
      onKeyDown={
        canEdit
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onAdd();
            }
          : undefined
      }
      aria-label={canEdit ? t('inbox.add') : undefined}
      className={`p-4 text-left ${canEdit ? 'cursor-pointer hover:bg-gray-50' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-gray-900">
            {draft.amount ? (
              formatCurrency(draft.amount, draft.currency ?? 'KRW')
            ) : (
              <span className="text-base font-medium text-amber-700">
                {t('inbox.amountUnknown')}
              </span>
            )}
          </p>
          <p className="truncate text-sm text-gray-700">
            {draft.description || draft.merchant || draft.appTitle || t('entry.noTitle')}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {draft.kind ? <span>{t(KIND_KEY[draft.kind] ?? 'tx.detail.kind')}</span> : null}
            {draft.occurredAt ? <span>{formatDateTime(draft.occurredAt, timeZone)}</span> : null}
            {/*
              찾아 둔 결제수단. 이름이 있으면 사람이 그 칸을 고를 일이 없다는 뜻이라,
              아래 "빈 칸이 있습니다" 대신 이것이 보인다.
            */}
            {methodName ? <span className="font-medium text-gray-700">{methodName}</span> : null}
            <span>{t('inbox.confidence', { value: draft.confidence })}</span>
          </p>
        </div>

        {canEdit ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDismiss();
              }}
              aria-label={t('inbox.dismiss')}
              title={t('inbox.dismiss')}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      {needsFix ? (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {t('inbox.needsFix')}
        </p>
      ) : null}

      {/*
        읽은 원문. 접어 둔다.

        파싱이 틀렸을 때 사람이 무엇을 보고 그렇게 됐는지 알 수 있는 유일한 근거라
        버리지 않고, 목록의 본론이 아니라 펼쳐야 보인다.
      */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsRawOpen((open) => !open);
        }}
        className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform ${isRawOpen ? 'rotate-180' : ''}`}
          aria-hidden
        />
        {t('inbox.raw')}
      </button>
      {isRawOpen ? (
        <pre
          onClick={(event) => event.stopPropagation()}
          className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-600"
        >
          {draft.rawText}
        </pre>
      ) : null}
    </div>
  );
}
