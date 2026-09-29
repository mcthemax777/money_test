'use client';

/*
 * 알림 규칙. 같은 앱의 알림 원문을 맞대어 앱별 문구 규칙을 배우고, 칸 이름을 확인해 저장한다.
 *
 * 흐름은 셋이다.
 *
 *   1. 앱을 고르면 그 앱의 원문(최근 500건)을 서식끼리 묶는다(`groupSamples`).
 *   2. 묶음 하나를 "배우기" 하면 원문을 맞대어 틀을 뽑고 칸 이름을 짐작한다(`learnRule`).
 *   3. 칩을 눌러 칸 이름을 고치거나 글 토막을 칸으로 바꾸고, 그 앱의 원문 몇 건에 맞는지와
 *      읽은 값을 보며 저장한다. 저장한 규칙은 기기가 10분 안에 받아 먼저 대 본다.
 *
 * 배우기와 대 보기는 기기와 같은 코드(`@money/core` 의 `notification-rule`)가 이 브라우저에서
 * 한다. 서버는 저장할 때 토막이 규칙으로 쓸 만한지만 본다. 방법은 `guide` 문서에 적었다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  NOTIFICATION_RULE_FIELDS,
  notificationRuleProblem,
  type EntryKind,
  type NotificationRule,
  type NotificationRuleField,
  type NotificationRuleSegment,
  type NotificationSampleDto,
} from '@money/types';
import { notificationText, parseNotification } from '@money/core/lib/draft-parse';
import {
  collectValues,
  groupSamples,
  learnRule,
  literalToField,
  readWithRule,
  sampleParsedOf,
} from '@money/core/lib/notification-rule';

import {
  AdminAuthError,
  createNotificationRule,
  listNotificationRules,
  listNotificationSamplePackages,
  listNotificationSamples,
  removeNotificationRule,
  updateNotificationRule,
} from '@/lib/admin-api';
import {
  errorText,
  FIELD_NAME,
  inputOf,
  KIND_NAME,
  ParsedTable,
  SegmentChips,
  showLiteral,
} from '../notification-view';

/** 한 앱에서 불러올 원문 수. 맞대기와 대 보기가 브라우저에서 돌므로 이만큼이면 넉넉하다. */
const SAMPLE_LIMIT = 500;
/** 한 번에 맞댈 원문 수. 맞대기는 표본 수에 비례하고, 50건이면 서식이 충분히 드러난다. */
const LEARN_LIMIT = 50;

interface Editor {
  id: string | null;
  name: string;
  segments: NotificationRuleSegment[];
  kind: EntryKind | null;
  currency: string;
  note: string;
  enabled: boolean;
  learnedFrom: number;
}

export default function AdminNotificationRulesPage() {
  const router = useRouter();
  const [packages, setPackages] = useState<NotificationSampleDto.PackageSummary[]>([]);
  const [packageName, setPackageName] = useState('');
  const [samples, setSamples] = useState<NotificationSampleDto.Response[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const fail = useCallback(
    (reason: unknown) => {
      if (reason instanceof AdminAuthError) router.replace('/admin/login');
      else setMessage({ kind: 'error', text: errorText(reason) });
    },
    [router],
  );

  // 알림 원문 화면의 "이 앱의 규칙 만들기"가 ?package= 로 넘긴다.
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('package');
    if (fromQuery) setPackageName(fromQuery);
    listNotificationSamplePackages().then(setPackages).catch(fail);
  }, [fail]);

  useEffect(() => {
    if (!packageName) {
      setSamples([]);
      setRules([]);
      return;
    }
    let alive = true;
    setIsLoading(true);
    setEditor(null);
    Promise.all([
      listNotificationSamples({ packageName, limit: SAMPLE_LIMIT }),
      listNotificationRules(packageName),
    ])
      .then(([page, packageRules]) => {
        if (!alive) return;
        setSamples(page.samples);
        setRules(packageRules);
      })
      .catch(fail)
      .finally(() => alive && setIsLoading(false));
    return () => {
      alive = false;
    };
  }, [packageName, fail]);

  const texts = useMemo(() => samples.map((sample) => notificationText(inputOf(sample))), [samples]);
  const groups = useMemo(() => groupSamples(texts), [texts]);

  /** 규칙마다 이 앱의 원문 가운데 읽은 것(맞고 금액까지 읽힌 것)의 수. */
  const reads = useCallback(
    (rule: Pick<NotificationRule, 'id' | 'segments' | 'kind' | 'currency'>) =>
      samples.map((sample) => readWithRule(rule, inputOf(sample), null)),
    [samples],
  );
  const ruleCoverage = useMemo(
    () => new Map(rules.map((rule) => [rule.id, reads(rule).filter(Boolean).length])),
    [rules, reads],
  );
  /** 켜 둔 규칙 가운데 하나라도 읽는 원문. 묶음마다 "이미 규칙이 있는가"를 센다. */
  const covered = useMemo(() => {
    const set = new Set<number>();
    for (const rule of rules.filter((item) => item.enabled)) {
      reads(rule).forEach((read, index) => read && set.add(index));
    }
    return set;
  }, [rules, reads]);

  const problem = editor ? notificationRuleProblem(editor.segments) : null;
  /** 고치는 중의 규칙. 토막이 규칙으로 쓸 수 없으면 null -- 대 보지 않는다. */
  const editorRule = useMemo(
    () =>
      editor && !notificationRuleProblem(editor.segments)
        ? { id: editor.id ?? 'draft', segments: editor.segments, kind: editor.kind, currency: editor.currency || null }
        : null,
    [editor],
  );
  const editorValues = useMemo(
    () => (editorRule ? collectValues(editorRule.segments, texts) : null),
    [editorRule, texts],
  );
  const editorReads = useMemo(() => (editorRule ? reads(editorRule).filter(Boolean).length : 0), [editorRule, reads]);
  const preview = useMemo(() => {
    if (!editorRule) return [];
    return samples
      .map((sample) => ({ sample, read: readWithRule(editorRule, inputOf(sample), parseNotification(inputOf(sample))) }))
      .filter((row) => row.read)
      .slice(0, 5);
  }, [editorRule, samples]);

  const learn = (members: number[]) => {
    const picked = members.slice(0, LEARN_LIMIT);
    const learned = learnRule(picked.map((index) => texts[index]));
    if (!learned) return;
    const firstLiteral = learned.segments.find((segment) => 'literal' in segment && segment.literal.trim());
    setEditor({
      id: null,
      name: firstLiteral && 'literal' in firstLiteral ? showLiteral(firstLiteral.literal).slice(0, 30) : packageName,
      segments: learned.segments,
      kind: learned.kind,
      currency: learned.currency ?? '',
      note: '',
      enabled: true,
      learnedFrom: picked.length,
    });
    setSelected(null);
    setMessage(
      picked.length === 1
        ? { kind: 'error', text: '원문이 한 건이라 가맹점이 글로 남았을 수 있습니다. 가맹점 토막을 눌러 칸으로 바꾸세요.' }
        : null,
    );
  };

  const edit = (rule: NotificationRule) => {
    setEditor({
      id: rule.id,
      name: rule.name,
      segments: rule.segments,
      kind: rule.kind,
      currency: rule.currency ?? '',
      note: rule.note ?? '',
      enabled: rule.enabled,
      learnedFrom: rule.learnedFrom,
    });
    setSelected(null);
    setMessage(null);
  };

  const setField = (field: NotificationRuleField) => {
    if (!editor || selected === null) return;
    const segment = editor.segments[selected];
    const segments =
      'field' in segment
        ? editor.segments.map((item, index) => (index === selected ? { field } : item))
        : literalToField(editor.segments, selected, field);
    setEditor({ ...editor, segments });
    setSelected(null);
  };

  const save = async () => {
    if (!editor || problem) return;
    setIsSaving(true);
    setMessage(null);
    const body = {
      packageName,
      name: editor.name.trim(),
      segments: editor.segments,
      kind: editor.kind,
      currency: editor.currency.trim() || null,
      enabled: editor.enabled,
      note: editor.note.trim() || null,
      learnedFrom: editor.learnedFrom,
    };
    try {
      const saved = editor.id
        ? await updateNotificationRule(editor.id, body)
        : await createNotificationRule(body);
      setRules((previous) =>
        editor.id ? previous.map((rule) => (rule.id === saved.id ? saved : rule)) : [...previous, saved],
      );
      setEditor(null);
      setMessage({ kind: 'ok', text: `"${saved.name}" 규칙을 저장했습니다. 기기는 10분 안에 받습니다.` });
    } catch (reason) {
      fail(reason);
    } finally {
      setIsSaving(false);
    }
  };

  const toggle = async (rule: NotificationRule) => {
    try {
      const saved = await updateNotificationRule(rule.id, { enabled: !rule.enabled });
      setRules((previous) => previous.map((item) => (item.id === saved.id ? saved : item)));
    } catch (reason) {
      fail(reason);
    }
  };

  const remove = async (rule: NotificationRule) => {
    if (!window.confirm(`"${rule.name}" 규칙을 지울까요? 기기는 10분 안에 이 규칙 없이 읽습니다.`)) return;
    try {
      await removeNotificationRule(rule.id);
      setRules((previous) => previous.filter((item) => item.id !== rule.id));
      if (editor?.id === rule.id) setEditor(null);
    } catch (reason) {
      fail(reason);
    }
  };

  const selectedSegment = editor && selected !== null ? editor.segments[selected] : null;
  const selectedValues =
    selected !== null && editorValues ? [...new Set(editorValues.values[selected] ?? [])].slice(0, 8) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">알림 규칙</h1>
          <p className="mt-1 text-sm text-gray-600">
            같은 앱의 원문을 맞대어 늘 같은 글과 바뀌는 칸을 가르고, 칸마다 무슨 값인지 확인해 저장합니다.
            기기는 그 앱의 알림에 이 규칙을 먼저 대 보고, 맞지 않으면 기존 규칙으로 읽습니다.
          </p>
        </div>
        <Link
          href="/admin/notification-rules/guide"
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        >
          규칙 학습 방법
        </Link>
      </div>

      <label className="block rounded-xl border border-gray-200 bg-white p-3">
        <span className="mb-1 block text-xs font-medium text-gray-600">앱</span>
        <select
          value={packageName}
          onChange={(event) => setPackageName(event.target.value)}
          className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
        >
          <option value="">앱을 고르세요</option>
          {packages.map((row) => (
            <option key={row.packageName} value={row.packageName}>
              {row.packageName} — 원문 {row.count}건, 규칙 {row.ruleCount}개
            </option>
          ))}
          {packageName && !packages.some((row) => row.packageName === packageName) ? (
            <option value={packageName}>{packageName}</option>
          ) : null}
        </select>
      </label>

      {message ? (
        <div
          className={`unfold rounded-lg p-3 text-sm ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {isLoading ? <p className="text-sm text-gray-500">불러오는 중...</p> : null}

      {packageName && !isLoading ? (
        <>
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="font-semibold text-gray-900">이 앱의 규칙</h2>
            {rules.length === 0 ? (
              <p className="text-sm text-gray-500">아직 없습니다. 아래 서식 묶음에서 배우세요.</p>
            ) : (
              <p className="text-xs text-gray-500">기기는 위에서부터(만든 차례로) 대 보고 처음 맞은 규칙을 씁니다.</p>
            )}
            {rules.map((rule) => (
              <div key={rule.id} className="space-y-2 rounded-lg border border-gray-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">
                    {rule.name}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      원문 {samples.length}건 중 {ruleCoverage.get(rule.id) ?? 0}건을 읽음 · {rule.learnedFrom}건에서 배움
                      {rule.kind ? ` · ${KIND_NAME[rule.kind]}` : ''}
                      {rule.currency ? ` · ${rule.currency}` : ''}
                    </span>
                  </span>
                  <div className="flex gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => void toggle(rule)}
                      className={`rounded px-2 py-1 transition-colors ${
                        rule.enabled ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {rule.enabled ? '켜짐' : '꺼짐'}
                    </button>
                    <button
                      type="button"
                      onClick={() => edit(rule)}
                      className="rounded px-2 py-1 text-blue-700 transition-colors hover:bg-blue-50"
                    >
                      고치기
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(rule)}
                      className="rounded px-2 py-1 text-red-600 transition-colors hover:bg-red-50"
                    >
                      지우기
                    </button>
                  </div>
                </div>
                <SegmentChips segments={rule.segments} />
                {rule.note ? <p className="text-xs text-gray-600">{rule.note}</p> : null}
              </div>
            ))}
          </section>

          {editor ? (
            <section className="unfold space-y-4 rounded-xl border-2 border-blue-200 bg-white p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold text-gray-900">{editor.id ? '규칙 고치기' : '새 규칙'}</h2>
                <span className="text-xs text-gray-500">{editor.learnedFrom}건에서 배움</span>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-600">
                  칩을 누르고 아래에서 칸 이름을 고르세요. 회색 글 토막을 누르면 칸으로 바꿀 수 있습니다(표본이
                  적어 가맹점이 글로 남았을 때). ⏎ 는 줄바꿈입니다.
                </p>
                <SegmentChips segments={editor.segments} onPick={setSelected} selected={selected} />
              </div>

              {selectedSegment ? (
                <div className="unfold space-y-2 rounded-lg bg-gray-50 p-3">
                  <div className="flex flex-wrap gap-1">
                    {NOTIFICATION_RULE_FIELDS.map((field) => (
                      <button
                        key={field}
                        type="button"
                        onClick={() => setField(field)}
                        className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                          'field' in selectedSegment && selectedSegment.field === field
                            ? 'border-blue-500 bg-blue-600 text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {FIELD_NAME[field]}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">
                    {'field' in selectedSegment
                      ? selectedValues.length
                        ? `이 칸에 들어온 값: ${selectedValues.join(' / ')}`
                        : '이 칸에 들어온 값이 없습니다.'
                      : `글 토막 "${showLiteral(selectedSegment.literal)}" 를 칸으로 바꿉니다. 앞뒤가 칸이면 하나로 합칩니다.`}
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block sm:col-span-1">
                  <span className="mb-1 block text-xs font-medium text-gray-600">이름</span>
                  <input
                    value={editor.name}
                    onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">갈래</span>
                  <select
                    value={editor.kind ?? ''}
                    onChange={(event) => setEditor({ ...editor, kind: (event.target.value || null) as EntryKind | null })}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                  >
                    <option value="">문구의 낱말로</option>
                    <option value="expense">지출</option>
                    <option value="income">수입</option>
                    <option value="transfer">이체</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">통화 (비우면 문구에서, 없으면 원화)</span>
                  <input
                    value={editor.currency}
                    onChange={(event) => setEditor({ ...editor, currency: event.target.value.toUpperCase() })}
                    placeholder="KRW"
                    maxLength={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">메모 (어느 서식인지, 무엇을 고쳤는지)</span>
                <textarea
                  value={editor.note}
                  onChange={(event) => setEditor({ ...editor, note: event.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              {problem ? (
                <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{problem}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-700">
                    이 앱 원문 {samples.length}건 가운데 <strong>{editorReads}건</strong>을 읽습니다
                    {editorValues ? ` (틀에 맞은 것 ${editorValues.matched}건)` : ''}. 아래는 읽은 결과 앞의 다섯 건입니다.
                  </p>
                  <div className="space-y-2">
                    {preview.map(({ sample, read }) => (
                      <div key={sample.id} className="grid gap-2 rounded-lg border border-gray-100 p-2 sm:grid-cols-2">
                        <p className="whitespace-pre-wrap break-words text-xs text-gray-700">
                          {sample.title ? `${sample.title}\n` : ''}
                          {sample.text}
                        </p>
                        <ParsedTable
                          parsed={sampleParsedOf(parseNotification(inputOf(sample)))}
                          compare={sampleParsedOf(read)}
                          labels={['기존 규칙', '이 규칙']}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  그만두기
                </button>
                <button
                  type="button"
                  disabled={Boolean(problem) || !editor.name.trim() || isSaving}
                  onClick={() => void save()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </section>
          ) : null}

          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <h2 className="font-semibold text-gray-900">서식 묶음</h2>
              <p className="text-xs text-gray-500">
                원문 {samples.length}건을 글의 차례가 닮은 것끼리 묶었습니다. 묶음 하나가 서식 하나(승인·취소·입금
                등)입니다. 앞 {LEARN_LIMIT}건으로 배웁니다.
              </p>
            </div>
            {groups.length === 0 ? <p className="text-sm text-gray-500">이 앱의 원문이 없습니다.</p> : null}
            {groups.map((members) => {
              const done = members.filter((index) => covered.has(index)).length;
              const example = samples[members[0]];
              return (
                <div key={members[0]} className="space-y-2 rounded-lg border border-gray-100 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-gray-700">
                      {members.length}건
                      <span className={`ml-2 text-xs ${done === members.length ? 'text-green-700' : 'text-gray-500'}`}>
                        켜 둔 규칙이 {done}건을 읽음
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => learn(members)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      이 묶음으로 배우기
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs text-gray-700">
                    {example.title ? `${example.title}\n` : ''}
                    {example.text}
                  </p>
                </div>
              );
            })}
          </section>
        </>
      ) : null}
    </div>
  );
}
