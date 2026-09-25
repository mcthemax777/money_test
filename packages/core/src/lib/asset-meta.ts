/**
 * 자산 목록에서 계좌 이름·금액 밑에 작게 붙는 것들.
 *
 * 잔액·누적 수익·계좌번호를 줄마다 하나씩 쌓으면 계좌 하나가 다섯 줄이 되어, 통장이
 * 예닐곱만 있어도 목록이 화면 몇 개를 넘는다. 이어 붙여 두 줄로 줄이되 **무엇 하나
 * 빼지 않는다** -- 줄 수를 줄이자고 정보를 버리면 목록과 상세를 오가는 일이 늘 뿐이다.
 *
 * 두 줄인 까닭은 잔액이 설명하는 대상이 다르기 때문이다. 잔액은 오른쪽의 큰 금액을
 * 풀어 주는 줄이라 그 밑에 붙고(`accountBalanceLine`), 나머지는 왼쪽 이름 밑에 선다
 * (`accountMetaParts`).
 *
 * 무엇을 어떤 차례로 적는지는 웹과 앱이 같아야 해서 여기서 정한다. 색과 크기로 그리는
 * 일만 화면이 맡는다.
 */
import type { MessageKey } from './i18n';
import { formatCurrency, toNumber } from './money';
import type { Account } from './types';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * 한 조각을 어떤 무게로 그릴지.
 *
 * - `profit`/`loss` 누적 수익. 부호 대신 이름과 색이 갈린다.
 * - `muted` 계좌번호. 읽어야 할 때만 찾는 것이라 가장 흐리다.
 *
 * 잔액은 여기 없다. 큰 금액 바로 밑에 붙는 줄이라 이 줄과 섞이지 않는다
 * (`accountBalanceLine`). 주인도 없다 -- 목록이 주인별로 묶여 머리글이 그 일을 한다.
 */
export type AssetMetaTone = 'profit' | 'loss' | 'muted';

export interface AssetMetaPart {
  key: string;
  text: string;
  tone: AssetMetaTone;
}

/**
 * 통장에 실제로 찍힌 돈. 적을 것이 없으면 null 이다.
 *
 * **큰 금액(카드 대금을 뺀 남은 금액) 바로 밑에 오른쪽 맞춤으로 선다.** 그 수가 왜 그
 * 값인지를 설명하는 줄이라 설명 대상 옆에 붙어 있어야 한다 -- 주인·수익·계좌번호가
 * 늘어선 왼쪽 줄에 섞어 두면 어느 수를 설명하는지가 사라진다.
 *
 * @param due 이 통장으로 빠져나갈 카드 대금 (`accountDueOf`). 0이면 적지 않는다 --
 *   남은 금액이 곧 잔액이라 같은 수를 한 번 더 적는 꼴이 된다.
 */
export function accountBalanceLine(
  account: Account,
  { due, t }: { due: number; t: Translate },
): string | null {
  if (due === 0) return null;

  return t('assets.balanceLine', {
    balance: formatCurrency(account.balance, account.currency),
  });
}

/**
 * 계좌 이름 밑에 한 줄로 이어 붙일 조각들. 적을 것이 없으면 빈 배열이다.
 *
 * @param profit 누적 수익. 서버가 그 계좌를 수익 대상으로 보지 않으면 없다. 아직
 *   기록이 없어 0인 것과 "계산이 안 됐다"를 가르려고 0도 적지 않는다.
 */
export function accountMetaParts(
  account: Account,
  { profit, t }: { profit?: string; t: Translate },
): AssetMetaPart[] {
  const parts: AssetMetaPart[] = [];

  const profitAmount = profit === undefined ? 0 : toNumber(profit);
  if (profitAmount !== 0) {
    parts.push({
      key: 'profit',
      // 손실에 "수익 -"를 붙이면 두 번 읽어야 한다. 부호 대신 이름을 바꾼다.
      text:
        t(profitAmount > 0 ? 'assets.profit' : 'assets.loss') +
        formatCurrency(Math.abs(profitAmount), account.currency),
      tone: profitAmount > 0 ? 'profit' : 'loss',
    });
  }

  if (account.accountNumber) {
    parts.push({ key: 'accountNumber', text: account.accountNumber, tone: 'muted' });
  }

  return parts;
}
