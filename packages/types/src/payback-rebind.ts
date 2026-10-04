/**
 * 원거래와 걸린 환불·페이백을 맞추는 규칙 (PAYBACK_DESIGN.md 7-4).
 *
 * 환불·페이백은 원거래의 한 줄을 되돌린 돈이다. 그런데 그 다리는 만들 때의 분류와 금액을
 * 들고 있어서, 원거래를 고치면 둘이 어긋난다 -- 원거래 줄의 분류를 바꾸면 환불은 옛 분류의
 * 지출을 줄이고, 원거래 금액을 돌려받은 것보다 작게 줄이면 그 분류의 지출이 음수가 된다.
 *
 * 그래서 원거래를 저장할 때와 환불·페이백을 적을 때 이 함수로 본다.
 *
 *   - **줄을 따라간다.** 걸린 줄이 남아 있으면 그 줄의 분류로 맞춘다. 줄이 사라졌는데 원거래의
 *     줄이 하나뿐이면 그 줄로 옮긴다 (분류 나누기를 그만둔 경우가 그렇다).
 *   - **넘지 않는다.** 한 줄에 걸린 돌려받은 돈의 합은 그 줄의 금액(할인 뒤)을 넘지 못한다.
 *   - **지출이어야 한다.** 원거래를 수입·이체로 바꾸면 되돌릴 지출 줄이 없다.
 *
 * 서버(원장)와 기기(사본 창구)가 같은 함수를 쓴다. 금액은 저장 통화(baseAmount)다.
 */
import { Dec, type DecInput } from './decimal';

/** 원거래의 분류 줄 하나. */
export interface RebindLine {
  lineKey: string;
  categoryId: string;
  categoryType: 'income' | 'expense' | string;
  /** 그 줄의 금액 (할인 뒤, 저장 통화, 지출이면 양수). */
  baseAmount: DecInput;
}

/** 원거래에 걸린 환불·페이백 하나. */
export interface RebindPayback {
  id: string;
  /** 걸린 줄. */
  lineKey: string | null;
  /** 그 페이백의 분류 다리가 지금 가리키는 분류. */
  categoryId: string | null;
  /** 돌려받은 금액 (저장 통화). 다리는 음수이므로 크기만 본다. */
  baseAmount: DecInput;
}

export type RebindError =
  | { code: 'PAYBACK_LINE_GONE'; paybackId: string }
  | { code: 'PAYBACK_ORIGIN_NOT_EXPENSE'; paybackId: string }
  | { code: 'PAYBACK_EXCEEDS_LINE'; lineKey: string; limit: string; total: string };

export interface RebindPlan {
  error: RebindError | null;
  /** 줄이나 분류를 고쳐야 하는 환불·페이백. 그대로면 싣지 않는다. */
  moves: Array<{ paybackId: string; lineKey: string; categoryId: string }>;
}

export function planPaybackRebind(
  lines: readonly RebindLine[],
  paybacks: readonly RebindPayback[],
): RebindPlan {
  const moves: RebindPlan['moves'] = [];
  const totals = new Map<string, Dec>();

  for (const payback of paybacks) {
    const line =
      lines.find((candidate) => candidate.lineKey === payback.lineKey) ??
      (lines.length === 1 ? lines[0] : null);
    if (!line) return { error: { code: 'PAYBACK_LINE_GONE', paybackId: payback.id }, moves: [] };
    if (line.categoryType !== 'expense') {
      return { error: { code: 'PAYBACK_ORIGIN_NOT_EXPENSE', paybackId: payback.id }, moves: [] };
    }

    totals.set(line.lineKey, (totals.get(line.lineKey) ?? Dec.of(0)).plus(Dec.of(payback.baseAmount).abs()));
    if (payback.lineKey !== line.lineKey || payback.categoryId !== line.categoryId) {
      moves.push({ paybackId: payback.id, lineKey: line.lineKey, categoryId: line.categoryId });
    }
  }

  for (const line of lines) {
    const total = totals.get(line.lineKey);
    if (!total) continue;
    const limit = Dec.of(line.baseAmount);
    if (total.gt(limit)) {
      return {
        error: { code: 'PAYBACK_EXCEEDS_LINE', lineKey: line.lineKey, limit: limit.toString(), total: total.toString() },
        moves: [],
      };
    }
  }

  return { error: null, moves };
}

/** 사람이 읽을 문장. 서버의 응답과 기기의 조립 오류가 같은 말을 한다. */
export function rebindErrorMessage(error: RebindError): string {
  switch (error.code) {
    case 'PAYBACK_LINE_GONE':
      return '환불·페이백이 걸린 줄을 지울 수 없습니다. 그 환불·페이백을 먼저 지우거나 다른 줄로 옮겨 주세요.';
    case 'PAYBACK_ORIGIN_NOT_EXPENSE':
      return '환불·페이백이 걸린 거래는 지출이 아닌 것으로 바꿀 수 없습니다.';
    case 'PAYBACK_EXCEEDS_LINE':
      return `돌려받은 금액(${error.total})이 그 줄의 금액(${error.limit})보다 큽니다.`;
  }
}
