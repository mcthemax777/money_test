'use client';

import { CreditCard, Landmark, Plus, UserPlus, Wallet, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@money/core/lib/i18n';

import Modal from '@/components/Modal';

export type AssetAddKind = 'person' | 'account' | 'card';

/**
 * 자산 추가 단추의 그림. 지갑에 작은 더하기 배지를 단다 (앱과 같은 모양).
 *
 * 거래 추가 단추와 같은 자리·같은 파란 원이라, 그림까지 +면 두 화면의 단추가 같은 일을
 * 하는 것처럼 읽힌다. 지갑이 "자산"을, 배지가 "더하기"를 말한다.
 */
export function AssetAddIcon() {
  return (
    <span className="relative inline-flex">
      <Wallet className="h-6 w-6" aria-hidden />
      <span className="absolute -bottom-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white">
        <Plus className="h-2.5 w-2.5 text-blue-600" strokeWidth={3.5} aria-hidden />
      </span>
    </span>
  );
}

/**
 * 자산 화면의 붙박이 추가 단추가 여는 팝업. 무엇을 만들지 고른다.
 *
 * 예전에는 목록 곳곳(목록 위, 사람 상자 안, 계좌 칸 안)에 추가 버튼이 서 있었다.
 * 통장이 늘수록 같은 버튼이 그만큼 쌓여 정작 계좌·카드가 밀려났다. 지금은 거래 화면처럼
 * 오른쪽 아래 단추 하나로 모으고, 주인·결제 통장은 각 폼에서 고른다.
 *
 * 만들 수 없는 것은 막아 두고 까닭을 적는다 -- 계좌는 주인이, 카드는 결제 통장이
 * 있어야 만들어진다. 앱의 같은 이름 컴포넌트와 같은 모양이다.
 */
export default function AssetAddChooser({
  isOpen,
  onClose,
  onChoose,
  hasPeople,
  hasAccounts,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChoose: (kind: AssetAddKind) => void;
  hasPeople: boolean;
  hasAccounts: boolean;
}) {
  const { t } = useTranslation();

  const options: Array<{ kind: AssetAddKind; label: string; Icon: LucideIcon; blocked?: string }> = [
    { kind: 'person', label: t('person.add'), Icon: UserPlus },
    {
      kind: 'account',
      label: t('account.add'),
      Icon: Landmark,
      blocked: hasPeople ? undefined : t('assets.addNeedsPerson'),
    },
    {
      kind: 'card',
      label: t('card.add'),
      Icon: CreditCard,
      blocked: hasAccounts ? undefined : t('assets.addNeedsAccount'),
    },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('assets.addTitle')}>
      <div className="space-y-2">
        {options.map(({ kind, label, Icon, blocked }) => (
          <button
            key={kind}
            type="button"
            disabled={Boolean(blocked)}
            onClick={() => onChoose(kind)}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left transition hover:bg-gray-50 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent motion-reduce:transition-none"
          >
            <Icon className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">{label}</span>
              {blocked ? <span className="block text-xs text-gray-500">{blocked}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
