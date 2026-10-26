/**
 * 원장 서비스. 화면 개념을 전표로 옮기고, 전표를 원장 잠금 아래에서 쓰고 지운다.
 *
 * 입력 모양은 ledger-types.ts, 순수 변환은 ledger-rows.ts, 트랜잭션 안의 쓰기·검사는
 * ledger-writes.ts 와 ledger-payback.ts, 기초잔액 찾기는 opening-balance.ts 에 있다
 * (2026-10-26 나눔). 잠금 순서와 트랜잭션 경계는 모두 이 파일이 정한다.
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, AccountType } from '@prisma/client';
import {
  Dec,
  type EntryBuildRequest,
  buildEntry,
  RestateError,
  restateAmounts,
  buildCardTransfer,
  buildExpense,
  buildIncome,
  buildTransfer,
  isAfterHlc,
} from '@money/types';
import { PrismaService } from '@/config/prisma.service';
import { prismaLedgerLookup } from './prisma-lookup';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ServerClockService } from '@/common/server-clock';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { conflict, notFound } from '@/common/app-error';
import { lockLedgerWrites } from '@/common/ledger-lock';
import type {
  CardTransferInput,
  CommonInput,
  EntryInput,
  ExpenseInput,
  IncomeInput,
  PaybackLink,
  TransferInput,
  Tx,
} from './ledger-types';
import {
  assertBalanced,
  assertDateInRange,
  baseLeg,
  buildCommon,
  entryRowData,
  interestOf,
  reversedDeltas,
  toBase,
  toBuildLines,
  toEntryInput,
  translateBuildError,
} from './ledger-rows';
import {
  applyBalanceDeltas,
  assertTargetsActive,
  assertTargetsBelongToProject,
  saveInstallmentPlan,
  saveTags,
} from './ledger-writes';
import {
  checkInstallmentCutUnderLock,
  checkPaybackCap,
  paybackLink,
  rebindPaybacks,
} from './ledger-payback';
import {
  OPENING_BALANCE_DATE,
  findOpeningEntry,
  getOrCreateOpeningBalanceAccount,
} from './opening-balance';

// 다른 모듈은 입력 모양을 이 파일에서 가져간다. 옮긴 뒤에도 그 길을 그대로 둔다.
export type {
  CardTransferDirection,
  CardTransferInput,
  CategoryLine,
  EntryInput,
  ExpenseInput,
  IncomeInput,
  PostingInput,
  TransferInput,
} from './ledger-types';

const ZERO = new Prisma.Decimal(0);

/**
 * 원장 조립 레이어.
 *
 * 이 서비스 밖의 코드는 Posting을 직접 만들지 않는다. 화면이 다루는 개념
 * (지출, 수입, 이체, 카드대금 결제)을 받아 전표로 번역하는 것이 여기의 책임이다.
 *
 * 부호 규칙 (schema.prisma 상단과 동일)
 *   자산 계좌   : 증가 +, 감소 -
 *   부채 계좌   : 빚 증가 -, 상환 +
 *   지출 카테고리: 지출 발생 +
 *   수입 카테고리: 수입 발생 -
 * 따라서 한 전표 안의 amount 합계는 항상 0이다.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly clock: ServerClockService,
  ) {}

  // ───────────────────────────────────────────
  // 원시 연산
  // ───────────────────────────────────────────

  /**
   * 전표 하나를 만든다. 검증과 잔액 반영을 모두 한 트랜잭션에서 처리한다.
   * 중간에 실패하면 잔액도 함께 롤백되므로 드리프트가 생기지 않는다.
   *
   * outerTx를 주면 새 트랜잭션을 열지 않고 그 안에서 실행한다. 읽고-고쳐-쓰는
   * 상위 연산(setBalanceTo)이 전체를 하나의 원자 단위로 묶기 위해 쓴다.
   */
  async createEntry(input: EntryInput, outerTx?: Tx) {
    assertBalanced(input.postings);
    assertDateInRange(input.date);
    await assertTargetsBelongToProject(outerTx ?? this.prisma, input);

    return this.runInTransaction(outerTx, async (tx) => {
      /*
       * 만들기도 잠근다. 스스로 읽고 고칠 것은 없지만, 이 쓰기가 **남의 선행조건을
       * 깨기** 때문이다 -- 잔액 0을 확인하고 통장을 숨기려는 요청과 겹치면, 잔액이
       * 남은 통장이 목록에서 사라진다.
       */
      await this.lockLedger(tx, input.projectId);
      await assertTargetsActive(tx, input);
      const payback = await paybackLink(tx, input);
      await checkPaybackCap(tx, input, payback);
      await this.checkInstallmentCut(tx, input, payback);

      const entry = await tx.journalEntry.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          createdByUserId: input.createdByUserId ?? null,
          ...entryRowData(input, payback, input.updatedHlc ?? this.clock.now()),
        },
        include: { postings: true },
      });

      await saveTags(tx, entry.id, input.projectId, input.postings, input.tagIds);
      await applyBalanceDeltas(tx, input.postings);
      await saveInstallmentPlan(
        tx,
        entry.postings,
        input.installmentMonths,
        input.installmentInterest,
        input.installmentShares,
        interestOf(input),
      );
      return entry;
    });
  }

  /**
   * 전표 내용을 통째로 갈아끼운다. id는 유지된다.
   *
   * posting을 하나씩 비교해 수정하는 대신 "옛 잔액을 되돌리고 새로 적용"하는 방식을 쓴다.
   * 다리 개수가 바뀌는 수정(수수료 추가, 분할 변경)까지 한 경로로 처리되고,
   * 되돌림과 재적용이 같은 트랜잭션 안에 있어 중간 상태가 남지 않는다.
   */
  async replaceEntry(entryId: string, input: EntryInput, outerTx?: Tx) {
    assertBalanced(input.postings);
    assertDateInRange(input.date);
    await assertTargetsBelongToProject(outerTx ?? this.prisma, input);

    return this.runInTransaction(outerTx, async (tx) => {
      /*
       * 읽기 전에 잠근다. 트랜잭션 안이라는 것만으로는 모자라다 (`lockLedger`).
       *
       * 아래 되돌리기가 딛고 서는 것은 "지금 이 전표의 다리"인데, 잠그지 않고 읽으면
       * 그것이 방금 다른 요청이 갈아 치운 옛 값일 수 있다. 그러면 같은 금액을 두 번
       * 되돌려 통장 잔액만 조용히 어긋난다.
       */
      await this.lockLedger(tx, input.projectId);

      const existing = await tx.journalEntry.findUnique({
        where: { id: entryId },
        include: { postings: true },
      });
      if (!existing || existing.projectId !== input.projectId) {
        throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
      }

      /*
       * 내가 본 판이 그대로인가. 화면이 시계를 실어 보냈을 때만 본다.
       *
       * 잠근 뒤에 본다는 것이 요점이다. 잠그기 전에 견주면 견준 값이 그 사이에 또
       * 바뀔 수 있어 검사가 검사 노릇을 못한다.
       *
       * 여기서 막지 않으면 늦게 누른 쪽이 이기고 진 편집은 아무 흔적도 남기지 않는다.
       * 오프라인 명령은 보류 칸에 남아 사람이 고르지만(D6), 지금 눌러서 보낸 요청에는
       * 그런 자리가 없다 -- 그 자리를 만드는 것이 이 거절이다.
       */
      if (input.baseHlc != null && (existing.updatedHlc ?? null) !== input.baseHlc) {
        throw conflict('ENTRY_MODIFIED', '다른 사람이 이 거래를 먼저 고쳤습니다.');
      }
      await assertTargetsActive(tx, input, existing.postings);
      const payback = await paybackLink(tx, input, entryId);
      await checkPaybackCap(tx, input, payback, entryId);
      await this.checkInstallmentCut(tx, input, payback, entryId);

      // 1) 옛 posting의 잔액 영향을 되돌린다
      await applyBalanceDeltas(tx, reversedDeltas(existing.postings));

      // 2) 옛 posting을 지우고 새로 만든다
      await tx.posting.deleteMany({ where: { entryId } });

      const entry = await tx.journalEntry.update({
        where: { id: entryId },
        data: entryRowData(input, payback, input.updatedHlc ?? this.clock.now()),
        include: { postings: true },
      });

      await saveTags(tx, entryId, input.projectId, input.postings, input.tagIds);

      // 이 전표에 걸린 환불·페이백을 새 줄에 맞춘다. 맞출 수 없으면 여기서 던지고 통째로 되돌린다.
      await rebindPaybacks(tx, entryId, input);

      // 3) 새 posting의 잔액을 적용한다
      await applyBalanceDeltas(tx, input.postings);
      // posting을 새로 만들었으므로 할부 일정도 다시 붙인다 (옛 것은 cascade로 사라졌다)
      await saveInstallmentPlan(
        tx,
        entry.postings,
        input.installmentMonths,
        input.installmentInterest,
        input.installmentShares,
        interestOf(input),
      );
      return entry;
    });
  }

  /**
   * 전표를 지운다. 잔액을 역방향으로 되돌린 뒤 삭제한다.
   * Posting은 onDelete: Cascade로 함께 사라진다.
   *
   * **걸린 환불·페이백도 함께 지운다** (PAYBACK_DESIGN.md 7-6). 원거래가 없으면 돌려받은 돈도
   * 뜻을 잃는다 -- 사용자가 그렇게 정했다. 외래 키의 SET NULL 로는 다리와 잔액이 남으므로
   * 여기서 하나씩 잔액을 되돌려 지운다. 잠금 안이라 그 사이에 새로 걸리는 것은 없다.
   * 환불·페이백에는 환불·페이백이 걸리지 않으므로(PAYBACK_TARGET_INVALID) 한 겹이면 된다.
   */
  async deleteEntry(entryId: string, projectId: string, outerTx?: Tx) {
    return this.runInTransaction(outerTx, async (tx) => {
      // 되돌릴 다리를 읽기 전에 잠근다. 수정과 같은 이유다 (`lockLedger`).
      await this.lockLedger(tx, projectId);

      const entry = await tx.journalEntry.findUnique({
        where: { id: entryId },
        include: { postings: true },
      });

      if (!entry || entry.projectId !== projectId) {
        throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
      }

      const paybacks = await tx.journalEntry.findMany({
        where: { paybackOfEntryId: entryId, projectId },
        include: { postings: true },
      });

      const reversed = [entry, ...paybacks].flatMap((row) => reversedDeltas(row.postings));
      await applyBalanceDeltas(tx, reversed);
      if (paybacks.length > 0) {
        await tx.journalEntry.deleteMany({ where: { id: { in: paybacks.map((row) => row.id) } } });
      }
      return tx.journalEntry.delete({ where: { id: entryId } });
    });
  }

  /**
   * 원화 카드의 외화 결제를 실제 청구액으로 고쳐 적는다.
   *
   * 입력할 때는 청구액을 알 수 없다. 카드사가 결제일 환율에 수수료를 얹어
   * 정하기 때문이다. 그래서 추정으로 기록해 두고(rateProvisional = true),
   * 명세서가 나오면 이 메서드로 확정한다.
   *
   * posting을 지우고 다시 만들지 않고 금액만 고친다. 그래야 할부 일정이
   * 붙어 있는 posting 행이 살아남는다(지우면 cascade로 함께 사라진다).
   *
   * 원 통화 금액($50)은 사실이므로 건드리지 않는다. 바뀌는 것은 그것이 얼마로
   * 청구되었는가뿐이다. 적용 환율은 저장하지 않고 둘의 비로 유도한다
   * (entry-view의 deriveRate).
   */
  async restateForeignEntry(
    entryId: string,
    projectId: string,
    billedTotal: Prisma.Decimal,
    outerTx?: Tx,
    /**
     * 오프라인 명령을 재생할 때 그 명령의 시계. 없으면 지금 시계를 찍는다.
     *
     * 재생에서 오늘 시계를 찍으면 그 사이 다른 기기가 이 거래를 고친 편집보다 뒤로 가서,
     * 며칠 전의 확정이 그 편집을 이긴 것처럼 남는다.
     */
    hlc?: string,
  ) {
    return this.runInTransaction(outerTx, async (tx) => {
      // 옛 금액에서 새 금액을 빼 잔액을 움직이므로, 여기도 읽기 전에 잠근다.
      await this.lockLedger(tx, projectId);

      const entry = await tx.journalEntry.findUnique({
        where: { id: entryId },
        include: { postings: true },
      });
      if (!entry || entry.projectId !== projectId) {
        throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
      }
      /*
       * 재생이면 잠근 뒤에 시계를 다시 본다 (2026-10-16).
       *
       * 재생 서비스가 먼저 견주지만 그것은 잠금 밖이다. 그 사이 다른 기기의 편집이 커밋하면 며칠 전의
       * 확정이 그 편집을 덮었다. 더 늦은 편집이 있으면 거절해 트랜잭션 전체(같은 명세서의 다른 건까지)를
       * 되돌리고, 재생 서비스가 충돌로 돌려준다.
       */
      if (hlc && isAfterHlc(entry.updatedHlc, hlc)) {
        throw conflict('ENTRY_MODIFIED', '다른 기기에서 이 거래를 더 늦게 고쳤습니다.');
      }
      if (!entry.originalCurrency || !entry.originalAmount) {
        throw new BadRequestException('원 통화 금액이 없는 거래는 청구액을 확정할 수 없습니다.');
      }

      /*
       * 나누는 규칙은 기기와 같은 함수다 (`@money/types` 의 restateAmounts). 기기는
       * 오프라인에서 확정한 결과를 사본에 먼저 적으므로, 끝수를 어느 줄에 몰지가 여기와
       * 다르면 같은 거래가 두 자리에서 1원씩 갈린다.
       */
      const base = await this.projectAccess.getProjectLedgerCurrency(projectId);
      let shares: Map<string, Dec>;
      try {
        shares = restateAmounts(
          entry.postings.map((p) => ({
            id: p.id,
            amount: p.amount.toString(),
            currency: p.currency,
            lineKey: p.lineKey,
          })),
          billedTotal.toString(),
          base,
        );
      } catch (error) {
        if (error instanceof RestateError) throw new BadRequestException(error.message);
        throw error;
      }

      const deltas: Array<{ accountId?: string; amount: Prisma.Decimal }> = [];
      for (const posting of entry.postings) {
        const next = new Prisma.Decimal((shares.get(posting.id) ?? Dec.of(0)).toString());
        if (next.equals(posting.amount)) continue;

        await tx.posting.update({
          where: { id: posting.id },
          // 다리가 전부 기준통화라 환산액도 같은 값이다 (exchangeRate 는 1로 남는다).
          data: { amount: next, baseAmount: next },
        });
        deltas.push({
          accountId: posting.accountId ?? undefined,
          amount: next.sub(posting.amount),
        });
      }

      await applyBalanceDeltas(tx, deltas);

      return tx.journalEntry.update({
        where: { id: entryId },
        /*
         * 확정도 편집이다. 시계를 새로 찍는다.
         *
         * 찍지 않으면, 확정 전에 오프라인에서 이 거래를 고쳐 둔 기기의 명령이 나중에
         * 도착해 조용히 이긴다. 명세서로 확정한 실제 청구액이 추정액으로 되돌아가는
         * 자리다. 시계가 있으면 충돌로 갈려 사람이 고른다.
         */
        data: { rateProvisional: false, updatedHlc: hlc ?? this.clock.now() },
        include: { postings: true },
      });
    });
  }

  /**
   * 트랜잭션 안에서 실행한다. 이미 트랜잭션 안이면 그것을 그대로 쓴다.
   *
   * Prisma의 대화형 트랜잭션은 중첩할 수 없다. 상위 연산이 자기 트랜잭션을
   * 열어 둔 채 createEntry를 부르면 여기서 갈라진다.
   */
  private runInTransaction<T>(outerTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return outerTx ? fn(outerTx) : this.prisma.$transaction(fn);
  }

  /**
   * 이 프로젝트의 원장을 고치는 다른 트랜잭션을 기다린다. **읽기 전에, 맨 먼저 부른다.**
   *
   * 왜 필요한가. 전표를 고치고 지우는 일은 읽고-고쳐-쓰기다 -- 옛 다리를 읽어 잔액에서
   * 되돌린 다음 새 다리를 적용한다. 트랜잭션 안에서 읽어도 그것만으로는 모자라다.
   * PostgreSQL 의 기본 격리 수준(READ COMMITTED)에서는 **문장마다 새 스냅숏**을 잡고,
   * 읽기는 아무 잠금도 걸지 않기 때문이다.
   *
   * 그래서 두 사람이 같은 거래를 거의 동시에 저장하면 이런 일이 벌어졌다.
   *
   *   1. 둘 다 옛 다리(10,000원)를 읽는다. 앞선 쪽이 아직 커밋 전이라 값이 같다.
   *   2. 앞선 쪽이 -10,000 되돌리고 +20,000 적용하고 커밋한다.
   *   3. 뒤선 쪽이 **이미 사라진 10,000 을 한 번 더 되돌리고** +30,000 을 적용한다.
   *
   * 전표와 다리는 뒤선 쪽 값으로 맞게 남는데 통장 잔액만 10,000 어긋난다. 오류가 나지
   * 않아 알아챌 수도 없다. 잔액은 다리 합계의 캐시라 한 번 어긋나면 스스로 맞지 않는다.
   *
   * 잠금 자체와 그 규칙은 `common/ledger-lock.ts` 가 갖는다. 숨기기의 선행조건을 보는
   * 통장·카드·구성원·분류도 같은 이름을 잡아야 하기 때문이다 -- **만드는 쪽이 잡지
   * 않으면 확인하는 쪽만 잡아 봐야 소용이 없다.** 그래서 전표를 만드는 길
   * (`createEntry`)도 잡는다. 스스로 읽고 고칠 것은 없지만, 그 쓰기가 남의 선행조건을
   * 깨기 때문이다.
   */
  private async lockLedger(tx: Tx, projectId: string): Promise<void> {
    await lockLedgerWrites(tx, projectId);
  }

  /** 할부 환불이 줄인 회차를 잠금 아래에서 다시 본다 (`checkInstallmentCutUnderLock`). */
  private checkInstallmentCut(
    tx: Tx,
    input: EntryInput,
    link: PaybackLink,
    selfId?: string,
  ): Promise<void> {
    return checkInstallmentCutUnderLock(tx, this.projectAccess, this.exchangeRates, input, link, selfId);
  }

  // ───────────────────────────────────────────
  // 통화 환산
  // ───────────────────────────────────────────

  /**
   * 이 전표에서 쓸 통화 정보를 정리한다.
   *
   * 사용자가 입력한 통화(entered)를 기준통화로 바꾸는 환율 하나가 전표 전체의
   * 기준이 된다. 환율을 직접 넘기면 그것을 쓰고(카드사가 실제로 적용한 환율을
   * 명세서에서 보고 고쳐 넣는 경우), 없으면 서버가 들고 있는 값을 쓴다.
   */
  private async resolveConversion(
    projectId: string,
    enteredCurrency: string | undefined,
    accountCurrency: string,
    explicitRate?: Prisma.Decimal,
  ) {
    // 저장 통화다. 표시 통화가 아니다. 표시 통화는 언제든 바뀌므로 원장이
    // 그것을 기준으로 값을 만들면 나중에 저장값을 다시 계산해야 한다.
    const base = await this.projectAccess.getProjectLedgerCurrency(projectId);
    const entered = this.exchangeRates.assertCurrency(
      enteredCurrency ?? accountCurrency,
      '입력 통화',
    );

    if (explicitRate !== undefined && explicitRate.lte(ZERO)) {
      throw new BadRequestException('환율은 0보다 커야 합니다.');
    }

    const rate =
      explicitRate ??
      new Prisma.Decimal((await this.exchangeRates.getRate(projectId, entered, base)).rate);

    // 사용자가 환율을 넣지 않았다면 이 환산액은 서버 추정이다. 원화 카드의 외화
    // 결제라면 실제 청구액은 결제일에 정해지므로, 그 사실을 전표에 남겨야 한다.
    return { base, entered, rate, estimatedRate: explicitRate === undefined };
  }

  // ───────────────────────────────────────────
  // 조립
  // ───────────────────────────────────────────

  /**
   * 전표 조립이 읽을 창구. 규칙은 `@money/types` 의 entry-build 가 갖는다.
   *
   * 게으르게 만드는 것은 생성자에서 프로젝트 접근 서비스가 아직 준비되지 않았을 수
   * 있어서가 아니라, 이 서비스가 트랜잭션마다 새로 만들어지지 않기 때문이다. 한 번
   * 만들어 두고 계속 쓴다.
   */
  private readonly lookup = prismaLedgerLookup(
    this.prisma,
    this.projectAccess,
    this.exchangeRates,
  );

  /**
   * 지출. 결제수단이 계좌든 체크카드든 신용카드든 카테고리측 posting은 동일하다.
   * "지출 = 지출 카테고리 posting의 합"이라는 정의가 결제수단과 분리되는 지점.
   */
  async createExpense(input: ExpenseInput) {
    return this.createEntry(await this.buildExpense(input));
  }

  /**
   * 화면 개념(kind)을 그대로 받아 전표를 만든다.
   *
   * 갈래를 나누는 규칙도 공용 함수가 갖는다. 서버의 REST 경로와 기기의 명령 재생이
   * 같은 입구를 써야 "오프라인에서 만든 전표"와 "온라인에서 만든 전표"가 같아진다.
   */
  async buildFromRequest(
    request: EntryBuildRequest & { createdByUserId?: string | null },
  ): Promise<EntryInput> {
    return toEntryInput(request as CommonInput, await translateBuildError(() => buildEntry(request, this.lookup)));
  }

  /**
   * 지출.
   *
   * 사용자는 결제한 통화로 금액을 입력한다. 카테고리 다리는 언제나 기준통화로
   * 남는데, 그래야 "8월 식비"가 통화별로 쪼개지지 않는다.
   *
   * 자금이 빠지는 계좌 다리는 두 가지로 갈린다.
   *   - 계좌 통화 == 입력 통화 : 달러 통장에서 달러로 결제. 계좌 다리도 외화다.
   *   - 계좌 통화 == 기준통화  : 원화 카드로 달러 결제. 청구되는 돈은 원화이므로
   *     계좌 다리는 원화이고, "$50를 썼다"는 사실은 전표에 따로 적는다.
   */
  async buildExpense(input: ExpenseInput): Promise<EntryInput> {
    return toEntryInput(
      input,
      await translateBuildError(() => buildExpense(
        {
          ...buildCommon(input),
          lines: toBuildLines(input.lines),
          accountId: input.accountId,
          cardId: input.cardId,
          installmentMonths: input.installmentMonths,
          installmentInterest: input.installmentInterest,
          installmentShares: input.installmentShares,
          installmentInterestShares: input.installmentInterestShares,
          installmentMonthlyPayment: input.installmentMonthlyPayment,
          installmentAnnualRate: input.installmentAnnualRate,
          countsPerformance: input.countsPerformance,
        },
        this.lookup,
      )),
    );
  }

  /** 수입. 수입 카테고리는 -, 입금 계좌는 +. */
  async createIncome(input: IncomeInput) {
    return this.createEntry(await this.buildIncome(input));
  }

  async buildIncome(input: IncomeInput): Promise<EntryInput> {
    return toEntryInput(
      input,
      await translateBuildError(() =>
        buildIncome(
          {
            ...buildCommon(input),
            lines: toBuildLines(input.lines),
            accountId: input.accountId,
          },
          this.lookup,
        ),
      ),
    );
  }

  /**
   * 이체. 수수료가 있으면 3-leg 전표 하나로 만든다.
   * 기존 구조처럼 수수료를 별도 거래로 만들고 서로 참조시키지 않는다.
   *
   * 한쪽이 신용카드 부채 계정이면 카드사와의 자금 이동이 된다.
   *   통장 -> 카드  대금 결제
   *   카드 -> 통장  환불 입금
   * 전표 모양은 buildCardTransfer와 같으므로 카드 화면에서 기록하든 이체로
   * 기록하든 결과가 하나로 모인다.
   */
  async createTransfer(input: TransferInput) {
    return this.createEntry(await this.buildTransfer(input));
  }

  async buildTransfer(input: TransferInput): Promise<EntryInput> {
    return toEntryInput(
      input,
      await translateBuildError(() =>
        buildTransfer(
          {
            ...buildCommon(input),
            fromAccountId: input.fromAccountId,
            toAccountId: input.toAccountId,
            amount: input.amount,
            toAmount: input.toAmount,
            feeAmount: input.feeAmount,
            feeCategoryId: input.feeCategoryId,
            feeLineKey: input.feeLineKey,
          },
          this.lookup,
        ),
      ),
    );
  }

  /**
   * 카드사와 통장 사이의 자금 이동. 지출이 아니라 부채의 증감이므로 카테고리 posting이 없다.
   * 이것이 credit_usage/credit_payment 이중 계상 문제가 사라지는 이유다.
   *
   * 금액에 상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
   * 입금해 주는 방식(총액형)이 실제로 있기 때문이다. 그때 부채는 일시적으로
   * 양수가 되고, 뒤이은 환불 입금이 0으로 되돌린다. 부채의 부호는 상태일 뿐 오류가 아니다.
   */
  async createCardTransfer(input: CardTransferInput) {
    return this.createEntry(await this.buildCardTransfer(input));
  }

  async buildCardTransfer(input: CardTransferInput): Promise<EntryInput> {
    return toEntryInput(
      input,
      await translateBuildError(() =>
        buildCardTransfer(
          {
            ...buildCommon(input),
            cardId: input.cardId,
            accountId: input.accountId,
            amount: input.amount,
            direction: input.direction,
          },
          this.lookup,
        ),
      ),
    );
  }

  /**
   * 계좌 잔액을 목표값으로 맞춘다. 계좌 추가와 잔액 수정이 함께 쓰는 유일한 경로다.
   *
   * 조정 전표를 새로 쌓지 않는다. 그 계좌의 기초잔액 전표 하나만 다시 계산해 덮어쓴다.
   *   기초잔액 = 목표 잔액 - (기초잔액을 뺀 나머지 거래 합계)
   * 그래서 잔액을 몇 번 고쳐도 거래내역은 기초잔액 1건뿐이고, 그 뒤의 거래는 그대로 남는다.
   *
   * 목표는 **지금** 잔액이다. 화면이 미래 날짜의 거래를 뺀 잔액을 보여 주므로
   * (common/balance-as-of), 나머지 합계도 지금까지의 거래만 센다. 미래의 거래는 맞춘
   * 잔액 위에 그 날짜에 얹힌다.
   *
   * balance 컬럼을 직접 쓰지 않는 이유는 그대로다. 자본 계정을 상대편으로 하는
   * 2-leg 전표로 남겨 "잔액 = posting 합계" 불변식을 지킨다.
   *
   * 주의: opening_balance 계정은 자산이 아니므로 순자산 집계에서 제외해야 한다.
   */
  async setBalanceTo(input: {
    projectId: string;
    accountId: string;
    /** 목표 잔액. 그 계좌의 통화로 본 값이다. */
    targetBalance: Prisma.Decimal;
    /** 외화 계좌의 환산에 쓸 환율. 생략하면 서버 환율. */
    exchangeRate?: Prisma.Decimal;
    createdByUserId?: string | null;
    /**
     * 기초잔액 전표를 **새로 만들 때** 쓸 id. 기기의 오프라인 잔액 맞추기가 준다 -- 사본에 먼저
     * 세운 전표와 같은 줄이 되게. 이미 있는 전표를 고칠 때는 쓰지 않는다.
     */
    openingEntryId?: string;
  }) {
    const account = await this.getAccount(input.projectId, input.accountId);
    if (account.type === AccountType.opening_balance) {
      throw new BadRequestException('자본 계정에는 잔액을 직접 설정할 수 없습니다.');
    }
    if (!account.ownerId) {
      throw new BadRequestException('소유자가 없는 계좌에는 잔액을 설정할 수 없습니다.');
    }

    /*
     * 읽고-고쳐-쓰기 전체를 한 트랜잭션으로 묶는다.
     *
     * 나머지 거래의 합을 읽어 기초잔액을 역산하는 구조라, 읽기와 쓰기 사이에
     * 다른 요청이 끼어들면 두 번째 요청이 첫 번째의 결과를 덮어쓴다
     * (잔액 100만 설정과 50만 설정이 겹치면 어느 쪽도 아닌 값이 남는다).
     *
     * 자문 잠금은 프로젝트 단위로 잡는다. 계좌 단위로 잡으면 그 프로젝트의
     * 자본 계정을 처음 만드는 순간이 서로 겹쳐 자본 계정이 두 벌 생긴다.
     * 트랜잭션이 끝나면 커밋이든 롤백이든 자동으로 풀린다.
     *
     * **전표 수정·삭제와 같은 이름을 쓴다** (`lockLedger`). 아래에서 읽는 "나머지 거래의
     * 합"은 그 사이 누가 같은 계좌의 거래를 고치면 어긋나므로, 그쪽과도 줄을 서야 한다.
     */
    return this.prisma.$transaction(async (tx) => {
      await this.lockLedger(tx, input.projectId);

      const existing = await findOpeningEntry(tx, input.projectId, input.accountId);

      // 기초잔액을 뺀 나머지 거래의 합. 이 위에 얹어서 목표 잔액을 만든다.
      const others = await tx.posting.aggregate({
        _sum: { amount: true },
        where: {
          accountId: input.accountId,
          ...(existing ? { entryId: { not: existing.id } } : {}),
          entry: { date: { lte: new Date() } },
        },
      });
      const openingAmount = input.targetBalance.sub(others._sum.amount ?? ZERO);

      // 기초잔액이 0이면 전표를 남기지 않는다. 0원 내역이 목록에 보일 이유가 없다.
      if (openingAmount.isZero()) {
        if (existing) await this.deleteEntry(existing.id, input.projectId, tx);
        return null;
      }

      const equity = await getOrCreateOpeningBalanceAccount(tx, input.projectId);

      // 외화 통장이면 기초잔액도 그 통화로 남고, 상대편 자본 계정은 기준통화다.
      const { base, rate } = await this.resolveConversion(
        input.projectId,
        account.currency,
        account.currency,
        input.exchangeRate,
      );
      const openingBase = toBase(openingAmount, rate, base);

      const entry: EntryInput = {
        ...(!existing && input.openingEntryId ? { id: input.openingEntryId } : {}),
        projectId: input.projectId,
        personId: account.ownerId!,
        date: OPENING_BALANCE_DATE,
        description: `${account.name} 기초잔액`,
        createdByUserId: input.createdByUserId,
        postings: [
          {
            accountId: account.id,
            amount: openingAmount,
            currency: account.currency,
            exchangeRate: rate,
            baseAmount: openingBase,
          },
          baseLeg({ accountId: equity.id }, openingBase.neg(), base),
        ],
      };

      // replaceEntry는 옛 posting의 잔액 영향을 되돌린 뒤 새로 적용하므로
      // 금액만 바뀐 경우에도 balance 컬럼이 정확히 따라온다.
      return existing
        ? this.replaceEntry(existing.id, entry, tx)
        : this.createEntry(entry, tx);
    },
    // 잠금을 기다리는 시간이 더해질 수 있어 기본 5초보다 넉넉하게 둔다.
    { timeout: 15_000 });
  }

  /** 이 프로젝트의 계좌. 없거나 남의 것이면 404 다. */
  private async getAccount(projectId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.projectId !== projectId) {
      throw new NotFoundException('계좌를 찾을 수 없습니다.');
    }
    return account;
  }
}
