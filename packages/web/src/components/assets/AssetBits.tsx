'use client';

/*
 * 자산 화면의 작은 표시들. 계좌 이름 밑의 한 줄, 카드의 남은 대금, 계좌 유형·합계 제외 배지.
 *
 * 목록(AssetList)과 상세 머리글이 같은 모양을 쓴다.
 */
import type { Card } from '@money/core/lib/types';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { AssetMetaPart, AssetMetaTone } from '@money/core/lib/asset-meta';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { useTranslation } from '@money/core/lib/i18n';

/**
 * 계좌 이름 밑에 한 줄로 이어 붙는 작은 글씨들 (core 의 `accountMetaParts`).
 *
 * 수익·계좌번호를 줄마다 하나씩 쌓으면 계좌 하나가 네 줄이 된다. 가운뎃점으로
 * 이어 한 줄에 두되, 좁은 화면에서는 접혀 내려가게 둔다 -- 잘라 내면 뒤에 선
 * 계좌번호가 통째로 사라진다.
 *
 * 무게는 조각마다 다르다. 셋을 같은 색으로 두면 한 줄에 모인 순간 어느 것이 큰 금액을
 * 설명하는 수인지 알 수 없다.
 */
const META_TONE_CLASS: Record<AssetMetaTone, string> = {
  profit: 'font-semibold text-green-600',
  loss: 'font-semibold text-red-600',
  maturity: 'font-semibold text-blue-600',
  muted: 'text-gray-400',
};

export function AssetMetaLine({ parts }: { parts: AssetMetaPart[] }) {
  if (parts.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs tabular-nums">
      {parts.map((part, index) => (
        <span key={part.key} className={META_TONE_CLASS[part.tone]}>
          {/* 가운뎃점은 앞 조각의 색을 따르지 않는다. 이어 주는 표시일 뿐이다. */}
          {index > 0 && <span className="mr-1.5 text-gray-300">·</span>}
          {part.text}
        </span>
      ))}
    </div>
  );
}

/**
 * 카드 줄 오른쪽 끝의 남은 대금.
 *
 * 아직 정산하지 않은 것이 있을 때만 적는다. 0원을 적어 두면 다 갚은 카드가 밀린
 * 카드와 같은 무게로 보인다. 체크카드는 결제 즉시 통장에서 빠져 갚을 것이 남지 않는다.
 *
 * 금액만 두면 이번 달 사용액인지 남은 대금인지 알 수 없어 앞에 이름을 붙인다.
 * 음수는 카드사가 갚을 돈이다(사용을 취소했거나 대금을 더 가져간 뒤). 부호만 바꿔
 * 적으면 빚으로 읽히므로 이름과 색을 함께 바꾼다 -- 정산 판과 같은 규칙이다.
 */
export function CardOutstanding({ card, currency }: { card: Card; currency: string }) {
  // 훅은 이른 반환보다 앞이어야 한다.
  const { t } = useTranslation();

  if (card.cardType !== 'credit') return null;

  const outstanding = toNumber(card.currentUsage);
  if (outstanding === 0) return null;

  const refundPending = outstanding < 0;

  return (
    <p
      className={`shrink-0 text-sm font-bold tabular-nums ${
        refundPending ? 'text-emerald-700' : 'text-red-600'
      }`}
    >
      <span className="mr-1 text-xs font-medium">
        {t(refundPending ? 'settlement.refundPending' : 'settlement.remaining')}
      </span>
      {formatCurrency(Math.abs(outstanding), currency)}
    </p>
  );
}

/** 계좌 유형 배지. 목록과 상세 머리글이 같은 모양을 쓴다. */
export function AccountTypeBadge({ type }: { type: string }) {
  return (
    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
      {accountTypeLabel(type)}
    </span>
  );
}

/**
 * 합계에서 뺀 계좌의 표시. 계좌 유형 배지와 같은 자리·크기이되 점선 테두리로 갈라,
 * 유형의 하나로 읽히지 않게 한다.
 */
export function ExcludedBadge() {
  const { t } = useTranslation();
  return (
    <span className="shrink-0 rounded border border-dashed border-gray-400 px-1.5 py-px text-[11px] text-gray-500">
      {t('assets.excludedFromTotal')}
    </span>
  );
}
