'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import type { AccountExclusion, GroupSelection } from '@money/core/hooks/useAccountExclusion';
import { useTranslation } from '@money/core/lib/i18n';
import { formatAmountWithUnit, formatCurrency } from '@money/core/lib/money';
import {
  ASSET_TYPE_GROUPS,
  assetGroupAmount,
  type AssetGroupKey,
  type NetWorthParts,
} from '@money/core/lib/net-worth';
import type { Account } from '@money/core/lib/types';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import Modal from '@/components/Modal';

interface AssetTypeSummaryProps {
  /** 총자산 응답(또는 고른 사람들의 합). 묶음별 소계를 여기서 읽는다. */
  parts: Pick<NetWorthParts, 'byType' | 'byGroup'> | undefined;
  /**
   * 합계 제외를 덜어 내기 전의 같은 값. 계좌를 모두 뺀 유형 칸이 원래 금액을 지운 줄로
   * 보인다 -- 0원으로 적으면 "넣으면 얼마인가"를 알 수 없다.
   */
  rawParts: Pick<NetWorthParts, 'byType' | 'byGroup'> | undefined;
  /** 유형 칸을 눌렀을 때 목록에 설 계좌 (고른 자산주인의 그 묶음) */
  accountsOf: (group: AssetGroupKey) => Account[];
  /** 계좌 옆에 적을 주인 이름 */
  ownerNameOf: (account: Account) => string | undefined;
  exclusion: AccountExclusion;
  /**
   * 문장 앞머리에 들어가는 자산주인 제목 ("아빠님의 자산", "전체 자산").
   *
   * 이 화면의 h1을 겸한다. 누르면 자산주인을 고르는 목록이 열린다.
   */
  scopeTitle: ReactNode;
  /** 자산주인을 하나도 고르지 않았는지. 그때는 금액 대신 그 사실을 적는다. */
  hasNoScope: boolean;
}

/**
 * 첫 줄 인사와 유형별 소계.
 *
 * "○○님의 자산은 1억 2,345만 원입니다"로 시작한다. 화면 이름("홈")을 적는 대신
 * 지금 궁금한 값을 문장으로 먼저 말한다.
 *
 * 유형 넷은 계좌 유형을 빠짐없이 나눈 것이라(lib/net-worth의 ASSET_TYPE_GROUPS)
 * 넷을 다 켜면 문장의 금액이 총자산이 된다. 대출은 갚아야 할 돈이라 음수로 나온다.
 *
 * 칸을 누르면 그 유형의 계좌 목록이 열리고, 거기서 뺀 계좌는 문장의 금액·아래 추이·
 * 목록의 소계에서 빠진다 (`useAccountExclusion`). "대출을 빼면 얼마인가", "비상금 통장을
 * 빼면 얼마인가"는 총액 하나로는 답할 수 없는 질문이다. 뺀 것은 기기에 남는다.
 */
export default function AssetTypeSummary({
  parts,
  rawParts,
  scopeTitle,
  hasNoScope,
  accountsOf,
  ownerNameOf,
  exclusion,
}: AssetTypeSummaryProps) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  /** 계좌 목록을 펼친 유형. 없으면 닫혀 있다. */
  const [openGroup, setOpenGroup] = useState<AssetGroupKey | null>(null);

  /* 묶음마다 합계에 든 정도. 칸의 표시와 문장 아래 줄이 함께 쓴다. */
  const selectionByGroup = useMemo(
    () =>
      new Map(
        ASSET_TYPE_GROUPS.map((group) => [
          group.key,
          exclusion.selectionOf(accountsOf(group.key).map((account) => account.id)),
        ]),
      ),
    [accountsOf, exclusion],
  );

  /*
   * 합계와 그 이름. 합계는 뺀 계좌를 덜어 낸 값의 네 묶음 합이고, 이름은 하나라도 든 묶음만
   * 적는다. 일부만 든 묶음은 "(일부)"를 붙인다 -- 이름만 적으면 다 든 것으로 읽힌다.
   */
  const { total, label } = useMemo(() => {
    const counted = ASSET_TYPE_GROUPS.filter((group) => selectionByGroup.get(group.key) !== 'none');
    return {
      total: ASSET_TYPE_GROUPS.reduce((acc, group) => acc + assetGroupAmount(parts, group), 0),
      label: counted
        .map((group) =>
          selectionByGroup.get(group.key) === 'some'
            ? t('assetSummary.partialGroup', { name: t(group.labelKey) })
            : t(group.labelKey),
        )
        .join(', '),
    };
  }, [parts, selectionByGroup, t]);

  const pickerGroup = ASSET_TYPE_GROUPS.find((group) => group.key === openGroup);

  return (
    <div className="space-y-4">
      <div>
        {/* 제목과 "은"이 한 문장으로 읽히도록 같은 줄에 둔다. */}
        <div className="flex flex-wrap items-center">
          {scopeTitle}
          {/*
            제목 버튼은 누를 자리를 넓히려고 좌우 여백(px-2)을 갖는다. 그대로 두면
            "자산"과 "은" 사이가 벌어지므로 그 여백만큼 당겨 붙인다.

            relative를 함께 준다. 제목은 자리를 잡은(relative) 상자라 그냥 두면
            마우스를 올렸을 때의 회색 바탕이 "은" 위에 얹혀 글자를 덮는다.
          */}
          {/*
            조사는 언어마다 있고 없다. 영어 사전은 이 자리를 비워 두어 제목 다음에
            바로 금액이 오게 한다.
          */}
          <span className="relative -ml-2 text-2xl font-bold text-gray-900">
            {t('assetSummary.particle')}
          </span>
        </div>

        {hasNoScope ? (
          <p className="mt-1 text-lg text-gray-600">{t('assetSummary.noScope')}</p>
        ) : (
          /*
            가진 돈은 파랑, 모자란 돈은 먹색이다.

            수입·지출처럼 방향이 있는 값이 아니라 "지금 얼마 있는가"라서 초록·빨강으로
            가르지 않는다. 파랑은 그 "가지고 있다"를 말하는 색이다.

            음수는 다르다. 대출만 켜거나 빚이 자산을 넘으면 이 값이 음수가 되는데, 그때
            파랑을 그대로 쓰면 가진 돈처럼 읽힌다. 빨강으로 적으면 이번 달 잘못했다는
            뜻이 되어 그것도 아니다. 그래서 색을 빼고 먹색으로 적는다 -- 무엇을 더한
            값인지는 아래 줄이 말해 준다.
          */
          <p
            className={`mt-1 text-4xl font-bold tabular-nums ${
              total < 0 ? 'text-gray-900' : 'text-blue-600'
            }`}
          >
            {/* 문장으로 읽히는 자리라 기호 대신 이름을 뒤에 붙인다. */}
            {formatAmountWithUnit(total, displayCurrency)}
            <span className="ml-2 text-xl font-medium text-gray-500">
              {t('assetSummary.suffix')}
            </span>
          </p>
        )}

        {/* 무엇을 더한 금액인지. 카드를 끄면 이 줄도 함께 줄어든다. */}
        <p className="mt-1 text-sm text-gray-500">{label || t('assetSummary.noType')}</p>
      </div>

      {/*
        유형 넷. 누르면 그 묶음의 계좌 목록이 열리고, 거기서 합계에 넣을 계좌를 고른다.
        넷이 한눈에 들어와야 해서 좁은 화면에서는 두 줄로 접는다. 옆으로 넘기게 두면
        넷째 칸이 화면 밖에 있어 "왜 대출이 없지"가 된다.

        칸의 모양이 세 상태를 말한다 -- 모두 듦(파란 바탕·채운 체크), 일부 듦(옅은 파랑·
        빼기 표시), 하나도 안 듦(흰 바탕·빈 칸·지운 금액). 색만으로 가르지 않도록 체크
        모양이 함께 바뀐다.
      */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ASSET_TYPE_GROUPS.map((group) => {
          const selection = selectionByGroup.get(group.key) ?? 'all';
          /* 하나도 안 든 칸은 넣으면 얼마인지를 지운 줄로 보인다. 나머지는 합계에 든 만큼이다. */
          const amount =
            selection === 'none'
              ? assetGroupAmount(rawParts, group)
              : assetGroupAmount(parts, group);
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => setOpenGroup(group.key)}
              aria-haspopup="dialog"
              className={`rounded-lg border p-3 text-left transition-colors duration-150 ${
                selection === 'all'
                  ? 'border-blue-300 bg-blue-50 hover:bg-blue-100'
                  : selection === 'some'
                    ? 'border-dashed border-blue-300 bg-blue-50/40 hover:bg-blue-50'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="flex items-center gap-1.5 text-xs text-gray-600">
                <TriCheck selection={selection} size="sm" />
                <span className="truncate">{t(group.labelKey)}</span>
              </p>
              <p
                className={`mt-1 text-base font-semibold tabular-nums transition-colors duration-150 ${
                  selection === 'none'
                    ? 'text-gray-400 line-through'
                    : amount < 0
                      ? 'text-red-600'
                      : 'text-gray-900'
                }`}
              >
                {formatCurrency(amount, displayCurrency)}
              </p>
            </button>
          );
        })}
      </div>

      {pickerGroup && (
        <AccountPicker
          title={t(pickerGroup.labelKey)}
          accounts={accountsOf(pickerGroup.key)}
          ownerNameOf={ownerNameOf}
          exclusion={exclusion}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  );
}

/**
 * 세 상태 체크 칸. 채운 체크 = 모두 듦, 빼기 = 일부 듦, 빈 칸 = 하나도 안 듦.
 *
 * 브라우저의 체크박스(indeterminate)는 모양이 브라우저마다 달라 앱과 맞출 수 없어 직접 그린다.
 */
function TriCheck({ selection, size = 'md' }: { selection: GroupSelection; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  const icon = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded border transition-colors duration-150 ${box} ${
        selection === 'none' ? 'border-gray-300 bg-white' : 'border-blue-600 bg-blue-600 text-white'
      }`}
    >
      {selection === 'all' && <Check className={icon} strokeWidth={3} />}
      {selection === 'some' && <Minus className={icon} strokeWidth={3} />}
    </span>
  );
}

/**
 * 한 유형의 계좌 목록. 계좌마다 합계에 넣고 뺀다.
 *
 * 맨 위 "전체 선택"은 세 상태다 -- 일부만 든 때 누르면 모두 넣는다(흔한 체크박스 규칙).
 * 고른 것은 곧바로 위 합계와 그래프에 반영되어 따로 저장 단추가 없다.
 */
function AccountPicker({
  title,
  accounts,
  ownerNameOf,
  exclusion,
  onClose,
}: {
  title: string;
  accounts: Account[];
  ownerNameOf: (account: Account) => string | undefined;
  exclusion: AccountExclusion;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const ids = accounts.map((account) => account.id);
  const selection = exclusion.selectionOf(ids);
  const countedCount = ids.filter((id) => !exclusion.isExcluded(id)).length;

  return (
    <Modal isOpen onClose={onClose} title={title}>
      {accounts.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-600">
          {t('assetSummary.noAccounts')}
        </p>
      ) : (
        /* 줄이 창 끝까지 닿도록 본문 여백(p-6)을 걷어 낸다. 글은 줄 안의 px-6 이 받친다. */
        <div className="-mx-6 -my-2">
          <p className="px-6 text-xs text-gray-500">{t('assetSummary.pickerHint')}</p>

          <button
            type="button"
            role="checkbox"
            aria-checked={selection === 'all' ? true : selection === 'some' ? 'mixed' : false}
            onClick={() => exclusion.setIncluded(ids, selection !== 'all')}
            className="mt-2 flex w-full items-center gap-3 border-b border-gray-100 px-6 py-3 text-left hover:bg-gray-50"
          >
            <TriCheck selection={selection} />
            <span className="flex-1 text-sm font-semibold text-gray-900">
              {t('assetSummary.selectAll')}
            </span>
            <span className="text-xs tabular-nums text-gray-500">
              {t('assetSummary.countIncluded', { count: countedCount, total: ids.length })}
            </span>
          </button>

          <ul>
            {accounts.map((account) => {
              const included = !exclusion.isExcluded(account.id);
              const amount = exclusion.countedAmountOf(account.id);
              const owner = ownerNameOf(account);
              return (
                <li key={account.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={included}
                    onClick={() => exclusion.setIncluded([account.id], !included)}
                    className="flex w-full items-center gap-3 px-6 py-2.5 text-left hover:bg-gray-50"
                  >
                    <TriCheck selection={included ? 'all' : 'none'} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm transition-colors duration-150 ${
                          included ? 'text-gray-900' : 'text-gray-400'
                        }`}
                      >
                        {account.name}
                      </span>
                      {owner && <span className="block text-xs text-gray-500">{owner}</span>}
                    </span>
                    {/* 표시 통화의 값이다. 빼면 위 합계가 꼭 이만큼 줄어든다 (카드 대금 포함). */}
                    <span
                      className={`shrink-0 text-sm tabular-nums transition-colors duration-150 ${
                        !included
                          ? 'text-gray-400 line-through'
                          : amount < 0
                            ? 'text-red-600'
                            : 'text-gray-900'
                      }`}
                    >
                      {formatCurrency(amount, displayCurrency)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
