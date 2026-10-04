/**
 * 전표 조립이 읽는 것을 Prisma 로 채우는 창구.
 *
 * 조립 규칙 자체는 `@money/types` 의 entry-build 가 갖는다. 기기도 같은 규칙으로 오프라인
 * 전표를 만들어야 하기 때문이다. 여기 남는 것은 "무엇을 읽을지"뿐이고, 기기 쪽 짝은
 * `@money/core` 의 사본 창구다.
 */
import { PrismaClient } from '@prisma/client';
import {
  Dec,
  type LedgerLookup,
  type LookupAccount,
  type LookupCard,
  type LookupCategory,
  type LookupPaybackTarget,
} from '@money/types';

import type { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import type { ProjectAccessService } from '@/common/project-access.guard';

type PrismaLike = Pick<PrismaClient, 'account' | 'card' | 'category' | 'journalEntry'>;

export function prismaLedgerLookup(
  prisma: PrismaLike,
  projectAccess: Pick<ProjectAccessService, 'getProjectLedgerCurrency'>,
  exchangeRates: Pick<ExchangeRatesService, 'getRate' | 'assertCurrency'>,
): LedgerLookup {
  return {
    ledgerCurrency: (projectId) => projectAccess.getProjectLedgerCurrency(projectId),

    async rate(projectId, from, to) {
      if (from === to) return Dec.of(1);
      const info = await exchangeRates.getRate(
        projectId,
        exchangeRates.assertCurrency(from, '입력 통화'),
        exchangeRates.assertCurrency(to, '저장 통화'),
      );
      return Dec.of(info.rate);
    },

    async account(projectId, accountId): Promise<LookupAccount | null> {
      const account = await prisma.account.findUnique({ where: { id: accountId } });
      // 다른 프로젝트의 계좌는 없는 것으로 본다. 존재 여부를 알려 주지 않는다.
      if (!account || account.projectId !== projectId) return null;
      return {
        id: account.id,
        projectId: account.projectId,
        type: account.type,
        currency: account.currency,
      };
    },

    async card(projectId, cardId): Promise<LookupCard | null> {
      const card = await prisma.card.findUnique({ where: { id: cardId } });
      if (!card || card.projectId !== projectId) return null;
      return {
        id: card.id,
        projectId: card.projectId,
        name: card.name,
        cardType: card.cardType,
        paymentAccountId: card.paymentAccountId,
        liabilityAccountId: card.liabilityAccountId,
      };
    },

    async cardIdForLiability(projectId, accountId) {
      const card = await prisma.card.findUnique({
        where: { liabilityAccountId: accountId },
        select: { id: true, projectId: true },
      });
      return card && card.projectId === projectId ? card.id : null;
    },

    async unassignedAccount(projectId): Promise<LookupAccount | null> {
      // 프로젝트마다 하나다 (부분 고유 색인 Account_unassigned_per_project).
      const account = await prisma.account.findFirst({
        where: { projectId, type: 'unassigned' },
        select: { id: true, projectId: true, type: true, currency: true },
      });
      return account;
    },

    async categories(projectId, ids): Promise<LookupCategory[]> {
      const rows = await prisma.category.findMany({
        where: { id: { in: [...ids] }, projectId },
      });
      return rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        type: row.type,
      }));
    },
    /*
     * 페이백인지는 링크가 아니라 다리로 본다 -- 지출 분류 다리가 음수다. 원거래가 지워져
     * 링크가 빈 페이백도 페이백이다 (종류 판정 classifyEntry 와 같은 기준).
     */
    async paybackTarget(projectId, entryId, lineKey): Promise<LookupPaybackTarget | null> {
      const entry = await prisma.journalEntry.findUnique({
        where: { id: entryId },
        select: {
          id: true,
          projectId: true,
          postings: {
            where: { categoryId: { not: null } },
            select: { lineKey: true, categoryId: true, baseAmount: true, category: { select: { type: true } } },
          },
        },
      });
      if (!entry || entry.projectId !== projectId) return null;
      return {
        id: entry.id,
        isPayback: entry.postings.some(
          (leg) => leg.category?.type === 'expense' && leg.baseAmount.isNegative(),
        ),
        lineCategoryId: entry.postings.find((leg) => leg.lineKey === lineKey)?.categoryId ?? null,
      };
    },
  };
}
