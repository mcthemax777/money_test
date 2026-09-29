/**
 * 앱별 알림 문구 규칙. 배우기(관리 도구)와 읽기(기기)가 이 파일 하나를 쓴다.
 *
 * **배우기.** 같은 앱에서 온 표본 여럿을 낱말 단위로 맞대어, 모든 표본에 같은 순서로
 * 나오는 글은 "늘 같은 글", 사이에 끼어 표본마다 다른 자리는 "칸"으로 남긴다(가장 긴
 * 공통 부분열, LCS). 숫자는 늘 칸이다 -- 카드 끝자리처럼 한 사람에게 늘 같은 숫자도
 * 다른 사람에게는 다르다. 칸마다 어떤 값인지는 그 칸에 들어온 값과 앞뒤 글로
 * 짐작하고(`guessFields`), 사람이 관리 도구에서 확인한 뒤 저장한다.
 *
 * **읽기.** 기기는 알림의 앱과 같은 규칙을 차례로 대 보고, 처음 맞은 규칙의 칸 값으로
 * 후보를 채운다. 규칙이 비운 칸(가맹점이 없는 서식 등)은 기존 규칙(`parseNotification`)의
 * 값을 쓴다. 맞는 규칙이 없으면 기존 규칙 그대로다.
 *
 * 정규식을 쓰지 않고 글 토막을 차례로 찾는다(`matchSegments`). 칸 사이의 글이 칸 값 안에도
 * 나오면 되짚어 다음 자리를 보되, 되짚는 횟수에 상한을 둔다 -- 기기의 백그라운드 작업이
 * 이상한 알림 하나에 붙잡히지 않게.
 *
 * 관리 도구의 "규칙 학습 방법" 문서(`/admin/notification-rules/guide`)가 이 파일을 풀어 쓴다.
 * 여기를 바꾸면 그 문서도 함께 고친다.
 */
import type {
  EntryKind,
  NotificationRule,
  NotificationRuleField,
  NotificationRuleSegment,
  NotificationSampleParsed,
} from '@money/types';

import {
  cardTailOf,
  confidenceOf,
  dateOf,
  installmentOf,
  issuerOf,
  kindOf,
  normalizeAmount,
  notificationText,
  NOT_AMOUNT,
  parseNotification,
  type NotificationInput,
  type ParsedDraft,
} from './draft-parse';

// ---------------------------------------------------------------------------
// 낱말 나누기
// ---------------------------------------------------------------------------

export interface RuleToken {
  text: string;
  /** 숫자 덩어리("12,000", "09/08", "14:23")는 늘 칸이 된다. */
  isNumber: boolean;
  /** 앞에 빈칸이 있었는가. 글 토막을 사람이 읽게 이어 붙일 때만 쓴다. */
  spaceBefore: boolean;
}

/**
 * 줄바꿈 · 숫자 덩어리 · 글자 덩어리 · 기호 하나. 빈칸은 낱말이 아니다.
 *
 * **줄바꿈은 낱말이다.** 카드 알림은 시각 줄 바로 아래에 가맹점 줄을 둔다
 * ("09/08 14:23⏎스타벅스"). 줄바꿈을 버리면 두 칸 사이에 늘 같은 글이 없어 한 칸으로
 * 뭉친다(2026-09-29, 검사에서 확인).
 *
 * 숫자 덩어리는 자릿점·날짜·시각 기호를 품는다 -- "09/08 14:23" 이 "09" "/" "08" 로
 * 쪼개지면 "/" 가 늘 같은 글로 남아 칸이 잘게 흩어진다.
 */
const TOKEN = /[^\S\n]*\n\s*|\d(?:[\d,.:/-]*\d)?|[\p{L}]+|[^\s\p{L}\d]/gu;

/** 한 표본에서 볼 낱말 수의 상한. 맞대기 표가 제곱으로 커진다. */
const MAX_TOKENS = 200;

/**
 * 한글 낱말 끝에 붙는 토씨. 긴 것을 먼저 본다.
 *
 * "스타벅스에서 4,500원 쓰셨어요" 와 "GS25에서 …" 를 맞대면 "스타벅스에서" 가 한 낱말이라
 * "에서" 가 늘 같은 글로 남지 못하고 가맹점과 금액이 한 칸으로 뭉친다. 토씨를 떼어 두면
 * "에서" 가 두 칸을 가른다. 늘 같은 낱말("카카오페이" → "카카오페" + "이")은 떼어도 둘 다
 * 글로 남아 도로 붙으므로 해가 없다.
 */
const PARTICLES = ['에서', '으로', '에게', '께서', '님', '에', '로', '을', '를', '이', '가', '은', '는', '의', '와', '과'];

function splitParticle(word: string): string[] {
  if (!/^[가-힣]+$/.test(word)) return [word];
  const particle = PARTICLES.find((item) => word.length > item.length && word.endsWith(item));
  return particle ? [word.slice(0, -particle.length), particle] : [word];
}

export function tokenizeNotification(text: string): RuleToken[] {
  const tokens: RuleToken[] = [];
  let last = 0;
  for (const match of text.trim().matchAll(TOKEN)) {
    const index = match.index ?? 0;
    const isBreak = match[0].includes('\n');
    const spaceBefore = !isBreak && index > last && tokens[tokens.length - 1]?.text !== '\n';
    if (isBreak) {
      tokens.push({ text: '\n', isNumber: false, spaceBefore: false });
    } else {
      splitParticle(match[0]).forEach((part, at) =>
        tokens.push({ text: part, isNumber: /^\d/.test(part), spaceBefore: at === 0 && spaceBefore }),
      );
    }
    last = index + match[0].length;
    if (tokens.length >= MAX_TOKENS) break;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// 맞대기 (배우기)
// ---------------------------------------------------------------------------

/** 배우는 중의 틀. 글 낱말이거나 칸이다. */
type TemplateItem = { literal: string; spaceBefore: boolean } | { slot: true };

function isSlot(item: TemplateItem): item is { slot: true } {
  return 'slot' in item;
}

/** 첫 표본으로 만든 틀. 숫자는 칸, 나머지는 늘 같은 글로 둔다. */
function templateOf(tokens: RuleToken[]): TemplateItem[] {
  return mergeSlots(
    tokens.map((token) =>
      token.isNumber ? { slot: true as const } : { literal: token.text, spaceBefore: token.spaceBefore },
    ),
  );
}

/** 붙어 있는 칸은 하나로. 사이에 글이 없으면 어디서 끊을지 정할 수 없다. */
function mergeSlots(items: TemplateItem[]): TemplateItem[] {
  const merged: TemplateItem[] = [];
  for (const item of items) {
    const previous = merged[merged.length - 1];
    if (isSlot(item) && previous && isSlot(previous)) continue;
    merged.push(item);
  }
  return merged;
}

/**
 * 틀에 표본 하나를 더 맞댄다.
 *
 * 틀의 글 낱말과 표본의 글 낱말 사이에서 가장 긴 공통 부분열을 찾는다. 짝지어진 낱말은
 * 틀에 남고, 짝 사이에 어느 한쪽이라도 남는 것이 있으면 그 자리가 칸이 된다. 표본의
 * 숫자와 틀의 칸은 어떤 것과도 짝짓지 않는다.
 */
function alignTemplate(template: TemplateItem[], tokens: RuleToken[]): TemplateItem[] {
  const rows = template.length;
  const cols = tokens.length;
  const same = (i: number, j: number) => {
    const item = template[i];
    const token = tokens[j];
    return !isSlot(item) && !token.isNumber && item.literal === token.text;
  };

  // table[i][j] = template[i..] 와 tokens[j..] 의 공통 부분열 길이
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] = same(i, j)
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (same(i, j) && table[i][j] === table[i + 1][j + 1] + 1) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  const next: TemplateItem[] = [];
  let previousI = -1;
  let previousJ = -1;
  for (const [pairI, pairJ] of [...pairs, [rows, cols] as [number, number]]) {
    const gapInTemplate = pairI - previousI - 1 > 0;
    const gapInSample = pairJ - previousJ - 1 > 0;
    if (gapInTemplate || gapInSample) next.push({ slot: true });
    if (pairI < rows) next.push(template[pairI]);
    previousI = pairI;
    previousJ = pairJ;
  }
  return mergeSlots(next);
}

/**
 * 틀을 저장할 토막으로. 한 줄 안에 이어진 글 낱말은 한 토막으로 붙이고, 칸은 일단
 * `ignore` 로 둔다.
 *
 * **줄바꿈은 따로 한 토막이다.** 사람이 글 토막을 눌러 칸으로 바꿀 때(`literalToField`)
 * 줄 하나만 바꿀 수 있어야 한다 -- 여러 줄이 한 토막이면 가맹점 줄을 바꾸려다 옆 줄까지
 * 칸이 된다.
 */
function segmentsOf(template: TemplateItem[]): NotificationRuleSegment[] {
  const segments: NotificationRuleSegment[] = [];
  for (const item of template) {
    const previous = segments[segments.length - 1];
    if (isSlot(item)) {
      segments.push({ field: 'ignore' });
    } else if (item.literal === '\n' || (previous && 'literal' in previous && previous.literal === '\n')) {
      segments.push({ literal: item.literal });
    } else if (previous && 'literal' in previous) {
      previous.literal += `${item.spaceBefore ? ' ' : ''}${item.literal}`;
    } else {
      segments.push({ literal: item.literal });
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// 대 보기 (읽기)
// ---------------------------------------------------------------------------

/** 칸 하나가 알림에서 차지한 자리. `start`·`end` 는 원문의 글자 위치다. */
export interface RuleFieldMatch {
  /** 토막 목록에서 몇 번째인가. */
  segmentIndex: number;
  field: NotificationRuleField;
  value: string;
  start: number;
  end: number;
}

/** 되짚는 횟수의 상한. 넘으면 맞지 않은 것으로 본다. */
const MATCH_BUDGET = 500;

/**
 * 토막을 알림에 대 본다. 맞으면 칸마다 값을, 아니면 null 을 준다.
 *
 * 빈칸과 줄바꿈은 보지 않는다 -- 빈칸을 뺀 글에서 글 토막을 찾고, 칸 값은 원문에서 잘라
 * 빈칸을 살린다("스타벅스 성수점"). 앱이 줄을 바꾸는 자리가 조금 달라져도 맞는다.
 *
 * 처음 글 토막은 알림의 맨 앞에서, 마지막 글 토막은 맨 끝에서 맞아야 한다.
 */
export function matchSegments(
  segments: NotificationRuleSegment[],
  text: string,
): RuleFieldMatch[] | null {
  /** 빈칸을 뺀 글과, 그 글자가 원문 어디에 있었는지. 줄바꿈은 여럿이어도 하나로 남긴다. */
  let compact = '';
  const origin: number[] = [];
  const trimmed = text.trim();
  const offset = text.indexOf(trimmed);
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '\n') {
      if (!compact.endsWith('\n')) {
        compact += '\n';
        origin.push(offset + index);
      }
    } else if (!/\s/.test(char)) {
      compact += char;
      origin.push(offset + index);
    }
  }
  const literals = segments.map((segment) =>
    'literal' in segment ? compactLiteral(segment.literal) : null,
  );

  let budget = MATCH_BUDGET;
  const found: RuleFieldMatch[] = [];

  const capture = (segmentIndex: number, from: number, to: number) => {
    const segment = segments[segmentIndex] as { field: NotificationRuleField };
    const start = from < origin.length ? origin[from] : text.length;
    const end = to > from ? origin[to - 1] + 1 : start;
    found.push({ segmentIndex, field: segment.field, value: text.slice(start, end).trim(), start, end });
  };

  const walk = (segmentIndex: number, position: number): boolean => {
    if (segmentIndex === segments.length) return position === compact.length;
    const literal = literals[segmentIndex];

    if (literal !== null) {
      return compact.startsWith(literal, position) && walk(segmentIndex + 1, position + literal.length);
    }

    const nextLiteral = literals[segmentIndex + 1];
    // 마지막 칸은 끝까지 가져간다.
    if (nextLiteral === undefined) {
      capture(segmentIndex, position, compact.length);
      return true;
    }
    // 칸 둘이 붙은 토막은 저장 때 막는다(`notificationRuleProblem`). 들어와도 맞지 않은 것으로 본다.
    if (nextLiteral === null) return false;

    for (let at = compact.indexOf(nextLiteral, position); at !== -1; at = compact.indexOf(nextLiteral, at + 1)) {
      budget -= 1;
      if (budget < 0) return false;
      const mark = found.length;
      capture(segmentIndex, position, at);
      if (walk(segmentIndex + 1, at)) return true;
      found.length = mark;
    }
    return false;
  };

  return walk(0, 0) ? found : null;
}

/** 글 토막을 대 볼 모양으로. 빈칸은 버리고 줄바꿈은 하나로 남긴다. */
function compactLiteral(literal: string): string {
  return literal.replace(/\s*\n\s*/g, '\n').replace(/[^\S\n]+/g, '');
}

// ---------------------------------------------------------------------------
// 칸 이름 짐작
// ---------------------------------------------------------------------------

const NUMBER_VALUE = /^\d[\d,]*(?:\.\d+)?$/;
const DATE_PART = /^\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{1,2})?$/;
const TIME_PART = /^\d{1,2}:\d{2}(?::\d{2})?$/;

/** 금액 앞뒤에 붙는 통화 표기와 그 코드. 앞에 붙는 것과 뒤에 붙는 것을 따로 본다. */
const CURRENCY_BEFORE: Array<[RegExp, string]> = [
  [/(?:₩|KRW)$/i, 'KRW'],
  [/(?:USD|US\$|\$)$/i, 'USD'],
  [/(?:JPY|¥)$/i, 'JPY'],
  [/(?:EUR|€)$/i, 'EUR'],
  [/(?:CNY)$/i, 'CNY'],
];
const CURRENCY_AFTER: Array<[RegExp, string]> = [
  [/^(?:원|KRW)/i, 'KRW'],
  [/^(?:USD|달러)/i, 'USD'],
  [/^(?:JPY|엔)/i, 'JPY'],
  [/^(?:EUR|유로)/i, 'EUR'],
  [/^(?:CNY|위안)/i, 'CNY'],
];

function currencyAround(before: string, after: string): string | null {
  const trimmedBefore = before.replace(/\s+/g, '');
  const trimmedAfter = after.replace(/\s+/g, '');
  for (const [pattern, code] of CURRENCY_AFTER) if (pattern.test(trimmedAfter)) return code;
  for (const [pattern, code] of CURRENCY_BEFORE) if (pattern.test(trimmedBefore)) return code;
  return null;
}

/** 칸 앞뒤의 글 토막. 없으면 빈 글. */
function neighbors(segments: NotificationRuleSegment[], index: number): { before: string; after: string } {
  const previous = segments[index - 1];
  const next = segments[index + 1];
  return {
    before: previous && 'literal' in previous ? previous.literal : '',
    after: next && 'literal' in next ? next.literal : '',
  };
}

export interface LearnedRule {
  segments: NotificationRuleSegment[];
  kind: EntryKind | null;
  currency: string | null;
  /** 칸마다 표본에서 들어온 값. 관리 도구가 칸 옆에 보여 준다. */
  values: string[][];
  /** 틀에 맞은 표본 수. 배운 표본은 모두 맞아야 하지만, 빈칸 차이로 어긋나면 여기서 드러난다. */
  matched: number;
}

/**
 * 칸마다 무슨 값인지 짐작한다. 사람이 관리 도구에서 바꿀 수 있다.
 *
 * 차례가 곧 우선이다.
 *
 *   1. **할부** -- 값이 "일시불"·"3개월"이거나, 숫자 뒤 글이 "개월"로 시작한다.
 *   2. **금액** -- 숫자이고 앞뒤에 통화 표기가 붙는다. 여럿이면 앞 글에 "누적·잔액" 같은
 *      낱말이 없는 첫 칸이 금액이고 나머지는 버린다(기존 규칙의 `NOT_AMOUNT` 와 같은 낱말).
 *   3. **시각** -- 값이 날짜·시각 모양이거나, 숫자 뒤 글이 월·일·시·분으로 시작한다.
 *   4. **카드 끝자리** -- 서너 자리 숫자이고 괄호·별표·"카드" 옆에 있다.
 *   5. **가맹점** -- 글자가 든 칸 가운데 표본마다 값이 가장 여러 가지인 칸.
 *   6. 나머지는 버리는 칸.
 */
export function guessFields(
  segments: NotificationRuleSegment[],
  values: string[][],
): { segments: NotificationRuleSegment[]; currency: string | null } {
  const next = segments.map((segment) => ({ ...segment }));
  let currency: string | null = null;
  let amountTaken = false;
  const textSlots: number[] = [];

  next.forEach((segment, index) => {
    if (!('field' in segment)) return;
    const seen = values[index] ?? [];
    const { before, after } = neighbors(next, index);
    const compactAfter = after.replace(/\s+/g, '');
    const all = (test: (value: string) => boolean) => seen.length > 0 && seen.every(test);

    if (
      all((value) => /^(?:일시불|\d{1,2}\s*개월)$/.test(value)) ||
      (all((value) => /^\d{1,2}$/.test(value)) && compactAfter.startsWith('개월'))
    ) {
      segment.field = 'installment';
      return;
    }

    const money = all((value) => NUMBER_VALUE.test(value)) ? currencyAround(before, after) : null;
    if (money) {
      const tail = before.slice(-10);
      if (!amountTaken && !NOT_AMOUNT.some((word) => tail.includes(word))) {
        segment.field = 'amount';
        currency = money;
        amountTaken = true;
      } else {
        segment.field = 'ignore';
      }
      return;
    }

    if (
      all((value) => value.split(/\s+/).every((part) => DATE_PART.test(part) || TIME_PART.test(part))) ||
      (all((value) => /^\d{1,2}$/.test(value)) && /^[월일시분]/.test(compactAfter))
    ) {
      segment.field = 'datetime';
      return;
    }

    if (
      all((value) => /^\d{3,4}$/.test(value)) &&
      (/[(*]$|카드$/.test(before.replace(/\s+/g, '')) || /^[)*]/.test(compactAfter))
    ) {
      segment.field = 'cardTail';
      return;
    }

    segment.field = 'ignore';
    if (seen.some((value) => /\p{L}/u.test(value))) textSlots.push(index);
  });

  // 가맹점: 값이 가장 여러 가지인 글 칸. 같으면 값이 긴 쪽.
  const variety = (index: number) => new Set(values[index] ?? []).size;
  const length = (index: number) => (values[index] ?? []).reduce((sum, value) => sum + value.length, 0);
  const merchant = [...textSlots].sort((a, b) => variety(b) - variety(a) || length(b) - length(a))[0];
  if (merchant !== undefined) (next[merchant] as { field: NotificationRuleField }).field = 'merchant';

  return { segments: next, currency };
}

/**
 * 같은 앱의 표본 여럿에서 규칙 하나를 배운다.
 *
 * 표본이 하나뿐이면 가맹점도 늘 같은 글로 남는다(견줄 것이 없다). 관리 도구가 그 경우를
 * 알리고, 사람이 글 토막을 눌러 칸으로 바꿀 수 있다(`literalToField`).
 */
export function learnRule(texts: string[]): LearnedRule | null {
  const samples = texts.map((text) => text.trim()).filter(Boolean);
  if (samples.length === 0) return null;

  let template = templateOf(tokenizeNotification(samples[0]));
  for (const text of samples.slice(1)) {
    template = alignTemplate(template, tokenizeNotification(text));
  }

  const raw = segmentsOf(template);
  const values = collectValues(raw, samples);
  const guessed = guessFields(raw, values.values);
  const literals = guessed.segments
    .map((segment) => ('literal' in segment ? segment.literal : ''))
    .join('\n');

  return {
    segments: guessed.segments,
    kind: kindOf(literals),
    currency: guessed.currency,
    values: values.values,
    matched: values.matched,
  };
}

/** 토막마다 표본에서 들어온 값을 모은다. 글 토막 자리는 빈 목록이다. */
export function collectValues(
  segments: NotificationRuleSegment[],
  texts: string[],
): { values: string[][]; matched: number } {
  const values: string[][] = segments.map(() => []);
  let matched = 0;
  for (const text of texts) {
    const found = matchSegments(segments, text);
    if (!found) continue;
    matched += 1;
    for (const field of found) values[field.segmentIndex].push(field.value);
  }
  return { values, matched };
}

/**
 * 글 토막 하나를 칸으로 바꾼다. 표본이 적어 가맹점이 글로 남았을 때 사람이 쓴다.
 *
 * 앞뒤가 칸이면 하나로 합친다 -- 칸 둘이 붙으면 끊을 자리가 없다.
 */
export function literalToField(
  segments: NotificationRuleSegment[],
  index: number,
  field: NotificationRuleField,
): NotificationRuleSegment[] {
  const next: NotificationRuleSegment[] = segments.map((segment, at) =>
    at === index ? { field } : { ...segment },
  );
  const merged: NotificationRuleSegment[] = [];
  next.forEach((segment, at) => {
    const previous = merged[merged.length - 1];
    if ('field' in segment && previous && 'field' in previous) {
      // 새로 바꾼 칸의 이름이 이긴다. 다만 합쳐지는 쪽에 금액이 있으면 금액을 지킨다.
      if (segment.field === 'amount' || (at === index && previous.field !== 'amount')) {
        previous.field = segment.field;
      }
      return;
    }
    merged.push(segment);
  });
  return merged;
}

// ---------------------------------------------------------------------------
// 표본 묶기
// ---------------------------------------------------------------------------

/**
 * 같은 서식끼리 묶는다. 한 앱이 승인·취소·입금처럼 여러 서식을 보내므로, 섞어서 배우면
 * 틀이 칸투성이가 된다.
 *
 * 글 낱말(숫자를 뺀)의 **차례**를 견준다 -- 두 표본의 공통 부분열이 둘 길이의 평균에서
 * 차지하는 몫(0~1)이 `threshold` 이상이면 같은 서식이다. 낱말 모음(차례 없이)으로 견주면
 * 승인과 승인취소가 같은 낱말을 대부분 나눠 가져 한 묶음이 된다(검사에서 0.62 대 0.71).
 * 각 묶음의 첫 표본과만 견준다.
 */
export function groupSamples(texts: string[], threshold = 0.75): number[][] {
  const groups: Array<{ words: string[]; members: number[] }> = [];
  texts.forEach((text, index) => {
    const words = tokenizeNotification(text)
      .filter((token) => !token.isNumber)
      .map((token) => token.text);
    const home = groups.find((group) => similarity(group.words, words) >= threshold);
    if (home) home.members.push(index);
    else groups.push({ words, members: [index] });
  });
  return groups.map((group) => group.members).sort((a, b) => b.length - a.length);
}

function similarity(a: string[], b: string[]): number {
  if (a.length + b.length === 0) return 1;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
    }
    previous = row;
  }
  return (2 * previous[b.length]) / (a.length + b.length);
}

// ---------------------------------------------------------------------------
// 규칙으로 읽기
// ---------------------------------------------------------------------------

/**
 * 규칙 하나로 알림을 읽는다. 맞지 않거나 금액을 못 읽으면 null.
 *
 * `base` 는 기존 규칙으로 읽은 결과다. 규칙이 비운 칸을 거기서 채운다.
 */
export function readWithRule(
  rule: Pick<NotificationRule, 'id' | 'segments' | 'kind' | 'currency'>,
  input: NotificationInput,
  base: ParsedDraft | null,
): ParsedDraft | null {
  const text = notificationText(input);
  const found = matchSegments(rule.segments, text);
  if (!found) return null;

  const valueOf = (field: NotificationRuleField) => found.find((item) => item.field === field)?.value || null;

  const amount = normalizeAmount(valueOf('amount')?.replace(/\s+/g, ''));
  if (!amount) return null;

  /*
   * 시각은 칸들이 차지한 자리 전체를 한 번에 읽는다. "9월 8일 14:23" 은 칸이 셋("9" "8"
   * "14:23")이고 사이의 "월"·"일"은 글 토막이라, 칸 값만 이으면 날짜를 잃는다.
   */
  const times = found.filter((item) => item.field === 'datetime' && item.value);
  const occurredAt = times.length
    ? dateOf(
        text.slice(Math.min(...times.map((item) => item.start)), Math.max(...times.map((item) => item.end))),
        input.postedAt,
      )
    : null;

  const installmentText = valueOf('installment');
  const installmentMonths =
    installmentText === null
      ? (base?.installmentMonths ?? null)
      : /^\d{1,2}$/.test(installmentText)
        ? (() => {
            const months = Number(installmentText);
            return months >= 2 && months <= 60 ? months : null;
          })()
        : installmentOf(installmentText);

  const tailText = valueOf('cardTail');
  const cardTail = tailText ? (tailText.match(/\d{4}$/)?.[0] ?? tailText) : (base?.cardTail ?? cardTailOf(text));

  const merchantText = valueOf('merchant');
  const merchant = merchantText ? merchantText.slice(0, 40) : (base?.merchant ?? null);

  const draft: ParsedDraft = {
    kind: rule.kind ?? kindOf(text) ?? base?.kind ?? null,
    amount,
    currency: rule.currency ?? base?.currency ?? 'KRW',
    occurredAt: occurredAt ?? base?.occurredAt ?? null,
    merchant,
    description: merchant ?? base?.description ?? null,
    installmentMonths,
    issuer: base?.issuer ?? issuerOf(text),
    cardTail,
    cardText: text,
    confidence: 0,
    parser: `rule:${rule.id}`,
    rawText: text,
  };
  // 사람이 확인한 규칙으로 읽었으니 아는 금융 앱만큼 더 믿는다.
  draft.confidence = Math.min(100, confidenceOf(draft) + 10);
  return draft;
}

/**
 * 알림 하나를 후보로. 이 앱의 규칙을 먼저 대 보고, 맞지 않으면 기존 규칙이다.
 *
 * 규칙이 맞으면 기존 규칙이 "금융 알림이 아니다"라고 본 알림도 후보가 된다 -- 파서가
 * 모르는 낱말로 온 결제를 읽게 하는 것이 앱별 규칙의 몫이다.
 */
export function parseNotificationWithRules(
  input: NotificationInput,
  rules: readonly NotificationRule[],
): ParsedDraft | null {
  const base = parseNotification(input);
  for (const rule of rules) {
    if (!rule.enabled || rule.packageName !== input.packageName) continue;
    const read = readWithRule(rule, input, base);
    if (read) return read;
  }
  return base;
}

/**
 * 읽은 결과를 표본에 적을 모양으로. 관리 도구가 "그때 읽은 것"과 "지금 다시 읽은 것"을
 * 이 모양으로 견준다.
 */
export function sampleParsedOf(draft: ParsedDraft | null): NotificationSampleParsed | null {
  if (!draft) return null;
  return {
    parser: draft.parser,
    kind: draft.kind,
    amount: draft.amount,
    currency: draft.currency,
    occurredAt: draft.occurredAt,
    merchant: draft.merchant,
    cardTail: draft.cardTail,
    installmentMonths: draft.installmentMonths,
    issuer: draft.issuer,
  };
}
