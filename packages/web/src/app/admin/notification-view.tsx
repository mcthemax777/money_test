/*
 * 알림 원문·알림 규칙·학습 문서가 함께 쓰는 조각.
 *
 * 세 화면이 같은 칸 이름과 같은 모양으로 읽은 결과를 보여야 서로 견줄 수 있다.
 */
import type {
  NotificationRuleField,
  NotificationRuleSegment,
  NotificationSampleDto,
  NotificationSampleParsed,
} from '@money/types';
import type { NotificationInput } from '@money/core/lib/draft-parse';

export const FIELD_NAME: Record<NotificationRuleField, string> = {
  amount: '금액',
  merchant: '가맹점',
  datetime: '시각',
  cardTail: '카드 끝자리',
  installment: '할부',
  ignore: '버림',
};

/** 칸마다 다른 색. 글 토막(회색)과 한눈에 갈린다. */
export const FIELD_COLOR: Record<NotificationRuleField, string> = {
  amount: 'bg-blue-100 text-blue-800 border-blue-200',
  merchant: 'bg-green-100 text-green-800 border-green-200',
  datetime: 'bg-purple-100 text-purple-800 border-purple-200',
  cardTail: 'bg-amber-100 text-amber-800 border-amber-200',
  installment: 'bg-pink-100 text-pink-800 border-pink-200',
  ignore: 'bg-gray-100 text-gray-500 border-gray-200 border-dashed',
};

export const KIND_NAME: Record<string, string> = {
  expense: '지출',
  income: '수입',
  transfer: '이체',
};

/** 관리 도구가 받은 표본을 파서가 받는 모양으로. */
export function inputOf(sample: NotificationSampleDto.Response): NotificationInput {
  return {
    packageName: sample.packageName,
    title: sample.title,
    text: sample.text,
    postedAt: Date.parse(sample.postedAt),
  };
}

/** 줄바꿈을 눈에 보이게. 규칙의 글 토막에서 줄바꿈은 뜻이 있다. */
export function showLiteral(literal: string): string {
  return literal.replace(/\n/g, '⏎');
}

const ROWS: Array<{ key: keyof NotificationSampleParsed; label: string }> = [
  { key: 'parser', label: '읽은 규칙' },
  { key: 'kind', label: '갈래' },
  { key: 'amount', label: '금액' },
  { key: 'merchant', label: '가맹점' },
  { key: 'occurredAt', label: '시각' },
  { key: 'cardTail', label: '끝자리' },
  { key: 'installmentMonths', label: '할부' },
  { key: 'issuer', label: '카드사' },
];

function cell(parsed: NotificationSampleParsed | null, key: keyof NotificationSampleParsed): string {
  if (!parsed) return '';
  const value = parsed[key];
  if (value === null || value === undefined) return '';
  if (key === 'kind') return KIND_NAME[String(value)] ?? String(value);
  if (key === 'amount') return `${Number(value).toLocaleString()} ${parsed.currency ?? ''}`.trim();
  if (key === 'occurredAt') return new Date(String(value)).toLocaleString();
  return String(value);
}

/** 두 결과가 다른 칸. 비교는 화면에 보이는 값으로 한다. */
export function changedRows(
  before: NotificationSampleParsed | null,
  after: NotificationSampleParsed | null,
): string[] {
  return ROWS.filter((row) => cell(before, row.key) !== cell(after, row.key)).map((row) => row.label);
}

/**
 * 읽은 결과의 표. `compare` 를 주면 두 열로 놓고 다른 칸을 칠한다.
 *
 * 읽은 규칙 이름(parser)이 다른 것만으로는 칠하지 않는다 -- 같은 값을 규칙이 읽었는지는
 * 확인할 일이 아니다.
 */
export function ParsedTable({
  parsed,
  compare,
  labels = ['그때 읽은 것', '지금 다시 읽은 것'],
}: {
  parsed: NotificationSampleParsed | null;
  compare?: NotificationSampleParsed | null;
  labels?: [string, string];
}) {
  const twoColumns = compare !== undefined;
  return (
    <table className="w-full table-fixed text-xs">
      {twoColumns ? (
        <thead>
          <tr className="text-left text-gray-500">
            <th className="w-20 py-1 font-medium" />
            <th className="py-1 font-medium">{labels[0]}</th>
            <th className="py-1 font-medium">{labels[1]}</th>
          </tr>
        </thead>
      ) : null}
      <tbody>
        {ROWS.map((row) => {
          const left = cell(parsed, row.key);
          const right = twoColumns ? cell(compare ?? null, row.key) : '';
          const differs = twoColumns && row.key !== 'parser' && left !== right;
          return (
            <tr key={row.key} className="border-t border-gray-100">
              <td className="py-1 text-gray-500">{row.label}</td>
              <td className={`break-words py-1 ${differs ? 'bg-amber-50' : ''} ${left ? 'text-gray-900' : 'text-gray-300'}`}>
                {left || '—'}
              </td>
              {twoColumns ? (
                <td
                  className={`break-words py-1 ${differs ? 'bg-amber-50 font-medium' : ''} ${right ? 'text-gray-900' : 'text-gray-300'}`}
                >
                  {right || '—'}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 규칙의 토막을 칩으로. 눌러 고치는 화면은 `onPick` 을 준다. */
export function SegmentChips({
  segments,
  onPick,
  selected,
}: {
  segments: NotificationRuleSegment[];
  onPick?: (index: number) => void;
  selected?: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-xs leading-relaxed">
      {segments.map((segment, index) => {
        const isField = 'field' in segment;
        const tone = isField
          ? FIELD_COLOR[segment.field]
          : 'border-gray-200 bg-white text-gray-700';
        const ring = selected === index ? 'ring-2 ring-blue-400' : '';
        const label = isField ? `{${FIELD_NAME[segment.field]}}` : showLiteral(segment.literal);
        return onPick ? (
          <button
            key={index}
            type="button"
            onClick={() => onPick(index)}
            className={`rounded border px-1.5 py-0.5 transition-colors hover:brightness-95 motion-reduce:transition-none ${tone} ${ring}`}
          >
            {label}
          </button>
        ) : (
          <span key={index} className={`rounded border px-1.5 py-0.5 ${tone}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

/** 오류는 로그인 화면으로 보내고, 나머지는 문구로. 관리 화면마다 같다. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
