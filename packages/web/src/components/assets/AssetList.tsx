'use client';

/*
 * 자산 화면 왼쪽의 목록. 사용자별(사람마다 한 상자)과 자산유형별 두 보기가 있고,
 * 상자 안에 계좌가, 계좌 아래에 그 통장에서 빠져나가는 카드가 달린다.
 *
 * 오른쪽 패널이 지금 보고 있는 항목은 목록에서 바탕색으로 표시한다 (구성원·계좌는
 * bg-blue-50, 카드는 그 위에 얹히므로 한 단 진한 bg-blue-100).
 *
 * 예전에는 테두리 링(ring)이었다. 줄이 제 상자를 갖고 있을 때의 표시라, 상자를 걷어낸
 * 지금은 줄 하나를 링이 감싸면 도로 상자가 하나 생긴다. 바탕은 줄의 높이를 바꾸지
 * 않으므로 눌러도 목록이 미세하게 움직이지 않는다.
 */
import type { Account, Card, Person } from '@money/core/lib/types';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import {
  assetGroupAmount,
  groupAccountsOfPeople,
  type AssetGroupKey,
  type NetWorthParts,
} from '@money/core/lib/net-worth';
import { accountDueOf } from '@money/core/lib/card-settlement';
import { accountBalanceLine, accountMetaParts } from '@money/core/lib/asset-meta';
import { todayKey } from '@money/core/lib/datetime';
import type { AccountExclusion } from '@money/core/hooks/useAccountExclusion';
import { useTranslation } from '@money/core/lib/i18n';
import { useAssetListView } from '@money/core/store/asset-list-view';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';
import { useDragReorder } from '@/hooks/useDragReorder';
import { AccountTypeBadge, AssetMetaLine, CardOutstanding, ExcludedBadge } from './AssetBits';

/** 오른쪽 패널이 보고 있는 항목. 두 목록이 이것을 보고 저마다 한 줄을 강조한다. */
export type SelectedItem = { type: 'person' | 'account' | 'card' | 'group'; id: string } | null;

/**
 * 통장과 카드 목록. **사람마다 한 상자다.**
 *
 * 계좌의 자리(sortRank)가 주인 안에서의 자리라 남의 통장 사이로 끌어다 놓을 자리가
 * 없다. 사람을 지우고 한 줄기로 늘어놓아 보니, 끌어도 어떤 줄 앞에서는 멎는 목록이
 * 되어 고장으로 보였다. 상자가 그 경계다 -- 끌 수 있는 데까지가 그 상자 안이다.
 *
 * 상자로 나누면 끌어 옮기는 모습도 제대로 보인다. 한 장의 목록에서는 머리글만 떠올라
 * 제 계좌들을 남겨 둔 채 움직였다. 지금은 사람 하나가 통째로 들린다.
 *
 * 머리글은 이름과 소계뿐이다. 누르면 그 사람의 상세가 열리고, **조금 길게 눌러 끌면
 * 구성원 차례가 바뀐다** (계좌·카드와 같은 손짓이다). 계좌가 없는 사람도 상자는
 * 내준다 -- 그 상자가 없으면 그 사람만 차례를 바꿀 수 없다.
 */
export default function AssetList({
  people,
  accounts,
  cardsOf,
  netWorthByPerson,
  accountProfit,
  selected,
  onPersonClick,
  onAccountClick,
  onCardClick,
  onReorderPeople,
  onReorderAccounts,
  onReorderCards,
  groupTotals,
  onGroupClick,
  isExcluded,
}: {
  people: Person[];
  accounts: Account[];
  cardsOf: (accountId: string) => Card[];
  netWorthByPerson: Map<string, { total: string }>;
  /** 고른 사람들의 묶음별 소계. "자산유형별" 상자의 머리글 금액이다 (맨 위 유형 카드와 같은 값). */
  groupTotals: Pick<NetWorthParts, 'byType' | 'byGroup'> | undefined;
  /** 자산유형별 상자의 머리글을 누르면 그 묶음의 상세를 펼친다 (사람 머리글과 같은 자리). */
  onGroupClick: (group: AssetGroupKey) => void;
  /** 합계에서 뺀 계좌인지. 목록에는 그대로 서고 "합계 제외"가 붙는다. */
  isExcluded: AccountExclusion['isExcluded'];
  /** 투자·저축 계좌별 누적 수익. 계좌 id -> 금액 */
  accountProfit: Map<string, string>;
  selected: SelectedItem;
  onPersonClick: (person: Person) => void;
  onAccountClick: (account: Account) => void;
  onCardClick: (card: Card) => void;
  /** 끌어서 바꾼 구성원 차례. 목록에 선 사람들만 들어 있다. */
  onReorderPeople: (ids: string[]) => void;
  onReorderAccounts: (ids: string[]) => void;
  onReorderCards: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  /*
   * 묶음 끌기. 안쪽 목록(계좌·카드)도 같은 훅을 쓰지만 서로 밟지 않는다 -- 훅이 제
   * 손짓의 전파를 끊어 **안쪽이 이긴다** (계좌를 잡으면 계좌만 움직인다).
   */
  const { items, dragProps, draggingId } = useDragReorder(people, onReorderPeople);
  const { view, setView } = useAssetListView();

  /* 자산유형별 상자. 사람 차례 → 그 사람 안의 차례로 늘어놓은 뒤 네 묶음으로 나눈다. */
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const byType = groupAccountsOfPeople(items, accounts);

  return (
    <div>
      {/*
        사용자별 · 자산유형별. 같은 계좌를 다르게 묶을 뿐이라 금액은 바뀌지 않는다.
        고른 것은 기기에 남는다 (`useAssetListView`).
      */}
      <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1">
        {(['person', 'type'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              view === id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t(id === 'person' ? 'assets.view.person' : 'assets.view.type')}
          </button>
        ))}
      </div>

      {people.length === 0 ? (
        <p className="text-sm text-gray-600">{t('assets.noSelection')}</p>
      ) : view === 'type' ? (
        byType.length === 0 ? (
          <p className="text-sm text-gray-600">{t('assets.noAccounts')}</p>
        ) : (
          <div className="space-y-3">
            {byType.map(({ group, accounts: grouped }) => (
              <div key={group.key} className="overflow-hidden rounded-lg bg-white shadow">
                {/*
                  머리글은 묶음 이름과 소계. 사용자별 상자의 머리글과 같은 짜임이고, 누르면
                  그 묶음의 상세(합계 추이와 최근 거래)가 열린다.
                */}
                <button
                  onClick={() => onGroupClick(group.key)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-gray-200 px-4 py-2 text-left transition ${
                    selected?.type === 'group' && selected.id === group.key
                      ? 'bg-blue-50 active:bg-blue-100'
                      : 'bg-gray-50 hover:bg-gray-100 active:bg-gray-200'
                  }`}
                >
                  <h2 className="min-w-0 truncate text-sm font-bold text-gray-900">
                    {t(group.labelKey)}
                  </h2>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-gray-900">
                    {formatCurrency(assetGroupAmount(groupTotals, group), displayCurrency)}
                  </p>
                </button>
                {/*
                  여기서는 끌어 옮기지 않는다. 계좌의 차례는 주인 안에서의 차례라, 여러
                  사람이 섞인 이 목록에서 옮긴 자리는 뜻이 없다. 차례는 사용자별에서 정한다.
                */}
                <AccountList
                  accounts={grouped}
                  cardsOf={cardsOf}
                  accountProfit={accountProfit}
                  selected={selected}
                  onAccountClick={onAccountClick}
                  onCardClick={onCardClick}
                  onReorderCards={onReorderCards}
                  ownerNameOf={(account) => nameOf.get(account.ownerId ?? '')}
                  isExcluded={isExcluded}
                />
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {items.map((person) => {
            const owned = accounts.filter((account) => account.ownerId === person.id);

            return (
              <div
                key={person.id}
                {...dragProps(person.id)}
                className={`overflow-hidden rounded-lg bg-white shadow transition ${
                  draggingId === person.id ? 'opacity-50' : ''
                }`}
              >
                {/*
                  상자의 머리글. 이름과 소계를 한 줄의 양 끝에 둔다. "소계"라는 말은
                  적지 않는다 -- 사람 이름 옆의 금액은 그 사람 몫이라는 뜻 말고 읽힐
                  것이 없다. 계좌 줄도 같은 자리에 금액을 두어 오른쪽 끝이 나란히 선다.
                */}
                <button
                  onClick={() => onPersonClick(person)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-gray-200 px-4 py-2 text-left transition ${
                    selected?.type === 'person' && selected.id === person.id
                      ? 'bg-blue-50 active:bg-blue-100'
                      : 'bg-gray-50 hover:bg-gray-100 active:bg-gray-200'
                  }`}
                >
                  <h2 className="min-w-0 truncate text-sm font-bold text-gray-900">
                    {person.name}
                  </h2>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-gray-900">
                    {formatCurrency(netWorthByPerson.get(person.id)?.total ?? 0, displayCurrency)}
                  </p>
                </button>

                {owned.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-600">{t('assets.noAccounts')}</p>
                ) : (
                  /*
                    사용자가 끌어 정한 차례 그대로다. 묶음(입출금·현금 · 예적금·연금 …)으로
                    나누지 않는다 -- 그 나눔은 맨 위 유형 카드가 보여 주고, 여기서는 각자가
                    정한 차례가 앞선다 (2026-10-05, 사용자 결정).
                  */
                  <AccountList
                    accounts={owned}
                    cardsOf={cardsOf}
                    accountProfit={accountProfit}
                    selected={selected}
                    onAccountClick={onAccountClick}
                    onCardClick={onCardClick}
                    onReorder={onReorderAccounts}
                    onReorderCards={onReorderCards}
                    isExcluded={isExcluded}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 한 주인의 계좌들. 머리글 바로 밑에 선다.
 *
 * 묶음마다 컴포넌트를 따로 두어야 한다 -- 끌기 훅은 목록 하나를 다루므로 한 컴포넌트가
 * 여러 묶음을 맡을 수 없다.
 */
function AccountList({
  accounts,
  cardsOf,
  accountProfit,
  selected,
  onAccountClick,
  onCardClick,
  onReorder,
  onReorderCards,
  ownerNameOf,
  isExcluded,
}: {
  accounts: Account[];
  cardsOf: (accountId: string) => Card[];
  accountProfit: Map<string, string>;
  selected: SelectedItem;
  onAccountClick: (account: Account) => void;
  onCardClick: (card: Card) => void;
  /** 없으면 끌어 옮기지 않는다 (자산유형별 목록). */
  onReorder?: (ids: string[]) => void;
  onReorderCards: (ids: string[]) => void;
  /** 있으면 계좌명 옆에 주인 이름을 적는다 (여러 사람이 섞인 자산유형별 목록). */
  ownerNameOf?: (account: Account) => string | undefined;
  isExcluded: AccountExclusion['isExcluded'];
}) {
  const { t } = useTranslation();
  // 만기 D-day 는 가계부 타임존의 오늘과 견준다.
  const today = todayKey(useProjectTimeZone());
  const { items, dragProps, draggingId } = useDragReorder(accounts, onReorder ?? (() => {}));

  // 빈 상자는 부르는 쪽이 이미 가려냈다. 그래도 그리는 동안 비는 순간은 있다.
  if (items.length === 0) return null;

  return (
    <div className="divide-y divide-gray-100 border-t border-gray-100">
      {items.map((account) => {
        const cards = cardsOf(account.id);
        /* 이 통장으로 빠져나갈 카드 대금과, 그것을 뺀 남은 금액. 셈은 core 가 한다. */
        const { due, remaining } = accountDueOf(account.balance, cards);
        const balanceLine = accountBalanceLine(account, { due, t });
        const metaParts = accountMetaParts(account, {
          profit: accountProfit.get(account.id),
          today,
          t,
        });
        /* 합계에서 뺀 계좌. 줄은 그대로 두고 표시를 붙여, 금액을 옅게 적는다 (딸린 카드도 함께 빠진다). */
        const excluded = isExcluded(account.id);

        return (
          <div
            key={account.id}
            {...(onReorder ? dragProps(account.id) : {})}
            /* 오른쪽 패널에 펼쳐 둔 계좌를 목록에서도 알 수 있게 표시한다 */
            className={`px-4 py-2 transition ${
              selected?.type === 'account' && selected.id === account.id
                ? 'bg-blue-50 active:bg-blue-100'
                : 'hover:bg-gray-50 active:bg-gray-100'
            } ${draggingId === account.id ? 'opacity-50' : ''}`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAccountClick(account);
              }}
              className="w-full text-left"
            >
              {/*
                왼쪽에 계좌명, 오른쪽 끝에 남은 금액이다. 어느 계좌인지 먼저 알아야 하고,
                금액은 오른쪽 끝에 모여 있어야 위아래로 훑으며 견줄 수 있다.

                유형은 묶음보다 잘게 나눈 이름이라(같은 예적금·연금 안의 예금과 적금)
                계좌명 옆에 붙인다.
              */}
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-gray-900">
                    {account.name}
                  </span>
                  <AccountTypeBadge type={account.type} />
                  {ownerNameOf?.(account) && (
                    <span className="shrink-0 text-xs text-gray-500">{ownerNameOf(account)}</span>
                  )}
                  {excluded && <ExcludedBadge />}
                </span>
                {/*
                  잔액이 아니라 카드 대금을 뺀 남은 금액이다. 통장에 찍힌 돈에는 카드사가
                  이미 가져가기로 된 몫이 섞여 있어, 잔액만 보면 쓸 수 있는 돈을 그만큼
                  부풀려 읽는다.

                  마이너스면 빨강이다 (아래 잔액도 같다). 대출·마이너스통장처럼 갚을 돈이
                  남은 계좌를 훑어보며 바로 가려낼 수 있어야 한다.
                */}
                <span
                  className={`shrink-0 text-base font-bold tabular-nums transition-colors duration-150 ${
                    excluded ? 'text-gray-400' : remaining < 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {formatCurrency(remaining, account.currency)}
                </span>
              </div>

              {/*
                둘째 줄. 왼쪽에 수익·계좌번호, 오른쪽 끝에 잔액이다. 무엇을 적을지는
                core 가 정한다 (`accountMetaParts`·`accountBalanceLine` -- 앱과 같다).

                윗줄과 같은 짜임이라 이름 밑에 주인이, 큰 금액 밑에 잔액이 선다. 잔액을
                따로 한 줄 더 내리면 계좌 하나가 세 줄이 되고, 왼쪽에 끼워 넣으면 어느
                수를 설명하는 줄인지 사라진다.
              */}
              {(metaParts.length > 0 || balanceLine) && (
                <div className="mt-0.5 flex items-center justify-between gap-3">
                  {/*
                    왼쪽이 비어도 자리는 남긴다. 적을 것이 잔액뿐일 때 감싸는 칸까지
                    사라지면 잔액이 왼쪽으로 붙어, 윗줄의 큰 금액과 어긋난다.
                  */}
                  <div className="min-w-0 flex-1">
                    <AssetMetaLine parts={metaParts} />
                  </div>
                  {balanceLine && (
                    <span
                      className={`shrink-0 text-xs font-medium tabular-nums ${
                        toNumber(account.balance) < 0 ? 'text-red-600' : 'text-gray-700'
                      }`}
                    >
                      {balanceLine}
                    </span>
                  )}
                </div>
              )}
            </button>

            {/*
              카드는 결제 통장에 **달려 내려온다.** 그 통장이 곧 이 계좌다.

              왼쪽의 세로줄 하나와 들여쓰기가 딸린 것임을 말한다. 예전에는 가름줄을
              긋고 초록 상자를 쌓았는데, 상자는 그 자체로 한 항목의 무게라 통장과 카드가
              같은 층에 선 것처럼 보였다. 세로줄은 자리를 거의 쓰지 않으면서 층을 만든다.
            */}
            {cards.length > 0 && (
            <div
              className={`ml-1 mt-1 border-l border-gray-200 pl-3 transition-opacity duration-150 ${
                excluded ? 'opacity-60' : ''
              }`}
            >
              <CardList
                cards={cards}
                /* 사용액·남은 대금은 모두 결제 통장의 통화다 (기준통화 환산액이 아니다). */
                currency={account.currency}
                selected={selected}
                onCardClick={onCardClick}
                onReorder={onReorderCards}
              />
            </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 한 계좌에 달린 카드 목록 */
function CardList({
  cards,
  currency,
  selected,
  onCardClick,
  onReorder,
}: {
  cards: Card[];
  /** 결제 통장의 통화. 카드 금액은 전부 이 통화다. */
  currency: string;
  selected: SelectedItem;
  onCardClick: (card: Card) => void;
  onReorder: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const { items, dragProps, draggingId } = useDragReorder(cards, onReorder);

  if (items.length === 0) return null;

  /* 들여쓰기와 세로줄은 부르는 쪽(AccountList)이 갖는다. 카드가 없으면 세로줄도 긋지 않는다. */
  return (
    <div>
      {items.map((card) => (
        <div
          key={card.id}
          {...dragProps(card.id)}
          className={`-mx-1 rounded px-1 transition ${
            selected?.type === 'card' && selected.id === card.id
              ? 'bg-blue-100 active:bg-blue-200'
              : 'hover:bg-gray-100 active:bg-gray-200'
          } ${draggingId === card.id ? 'opacity-50' : ''}`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCardClick(card);
            }}
            className="w-full py-1 text-left"
          >
            {/*
              한 줄에 다 넣는다. 갈래(신용·체크)를 아랫줄로 내리면 카드 하나가 두 줄이
              되어, 통장마다 카드가 둘씩만 있어도 목록이 화면을 훌쩍 넘는다. 갈래는 이름
              옆의 작은 배지다 -- 계좌 유형 배지와 같은 자리, 같은 모양이다.
            */}
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm text-gray-700">💳 {card.name}</span>
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
                  {t(card.cardType === 'debit' ? 'method.debit_card' : 'method.credit_card')}
                </span>
              </span>
              <CardOutstanding card={card} currency={currency} />
            </div>
          </button>
        </div>
      ))}
    </div>
  );
}
