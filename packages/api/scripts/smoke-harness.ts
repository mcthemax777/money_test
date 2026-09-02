import { ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { ExchangeRatesService } from '@/modules/exchange-rates/exchange-rates.service';
import { ReportsService } from '@/modules/reports/reports.service';
import { AccountsService } from '@/modules/accounts/accounts.service';
import { EntriesService } from '@/modules/entries/entries.service';
import { BudgetsService } from '@/modules/budgets/budgets.service';

/**
 * 스모크 테스트 공용 뼈대.
 *
 * 이 파일이 존재하는 이유는 정리(cleanup) 때문이다.
 * 예전에는 스크립트마다 성공 경로에서만 정리했고, 실패하면 찌꺼기가 남았다.
 * 그 찌꺼기를 치우려고 `DELETE FROM "User"` 같은 전체 삭제를 손으로 돌리다가
 * 개발 중이던 실제 데이터까지 지웠다.
 *
 * 그래서 여기서 두 가지를 강제한다.
 *   1. 테스트가 만든 Project/User의 id를 추적해 그것만 지운다.
 *   2. 성공하든 실패하든 finally에서 반드시 지운다.
 * 범위를 지정하지 않는 삭제는 이 파일 어디에도 없어야 한다.
 */

export interface SmokeContext {
  prisma: PrismaClient;
  /** 기대값과 다르면 실패로 기록한다. 예외를 던지지 않아 나머지 검사도 계속 돈다. */
  check(label: string, actual: unknown, expected: unknown): void;
  /** 거부되어야 하는 호출. 통과하면 실패로 기록한다. */
  expectReject(label: string, fn: () => Promise<unknown>): Promise<void>;
  /** 정리 대상으로 등록되는 프로젝트 생성 */
  createProject(data?: Partial<Prisma.ProjectCreateInput>): Promise<{ id: string }>;
  /** 정리 대상으로 등록되는 사용자 생성 */
  createUser(data?: Partial<Prisma.UserCreateInput>): Promise<{ id: string; email: string }>;
}

export async function runSmoke(name: string, body: (ctx: SmokeContext) => Promise<void>) {
  const prisma = new PrismaClient();
  const projectIds: string[] = [];
  const userIds: string[] = [];
  let failures = 0;
  let crashed = false;

  const ctx: SmokeContext = {
    prisma,
    check(label, actual, expected) {
      const ok = String(actual) === String(expected);
      if (!ok) failures += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
    },
    async expectReject(label, fn) {
      try {
        await fn();
        failures += 1;
        console.log(`FAIL  ${label}  (기대 거부, 실제 통과됨)`);
      } catch {
        console.log(`PASS  ${label} (거부됨)`);
      }
    },
    async createProject(data = {}) {
      const project = await prisma.project.create({
        data: { name: `${name} 스모크`, ...data } as Prisma.ProjectCreateInput,
      });
      projectIds.push(project.id);
      return project;
    },
    async createUser(data = {}) {
      // 같은 스크립트를 여러 번 돌려도 unique 제약에 걸리지 않도록 id를 섞는다
      const suffix = `${name}-${userIds.length}-${process.pid}`;
      const user = await prisma.user.create({
        data: {
          email: `smoke-${suffix}@example.invalid`,
          googleId: `smoke-${suffix}`,
          name: `스모크 ${suffix}`,
          ...data,
        } as Prisma.UserCreateInput,
      });
      userIds.push(user.id);
      return user;
    },
  };

  try {
    await body(ctx);
  } catch (error) {
    crashed = true;
    console.error(error);
  } finally {
    // 만든 것만, 반드시 지운다. 범위 없는 삭제는 하지 않는다.
    await cleanup(prisma, projectIds, userIds);
    await prisma.$disconnect();
  }

  if (crashed) {
    console.log('\n실행 중 오류');
  } else {
    console.log(failures === 0 ? '\n전체 통과' : `\n실패 ${failures}건`);
  }
  process.exit(crashed || failures > 0 ? 1 : 0);
}

async function cleanup(prisma: PrismaClient, projectIds: string[], userIds: string[]) {
  try {
    if (projectIds.length > 0) {
      /*
       * 명령 기록은 프로젝트와 함께 사라지지 않는다. 외래 키가 없기 때문인데, 그것이
       * 이 표의 뜻이기도 하다 -- 프로젝트가 지워진 뒤에 도착한 재전송도 막아야 한다.
       * 그래서 검사가 만든 것만 골라 여기서 치운다.
       */
      await prisma.mutationLog.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  } catch (error) {
    // 정리 실패는 남은 id를 알려주고 넘어간다. 여기서 범위를 넓히지 않는다.
    console.error('정리 실패. 아래 id가 남아 있을 수 있습니다:', { projectIds, userIds }, error);
  }
}

/**
 * ProjectAccessService 대역.
 *
 * 권한 검증은 스모크 범위 밖이라 통과시키되, 타임존은 실제 프로젝트 값을 읽는다.
 * 월 경계와 카드 청구주기가 이 값을 쓰기 때문에 하드코딩하면 검증 의미가 없다.
 */
export function projectAccessStub(
  prisma: PrismaClient,
  defaultProjectId: string,
  /**
   * 이 사용자의 역할. 기본은 무엇이든 되는 상태다.
   *
   * viewer 를 주면 쓰기를 요구하는 경로가 거절된다. 명령 재생이 "권한을 재생 시점에 다시
   * 본다"를 지키는지 보려면 그 상태를 만들 수 있어야 한다 (설계 문서의 D10).
   */
  role: 'owner' | 'editor' | 'viewer' = 'owner',
) {
  const canWrite = role !== 'viewer';
  const requireWrite = (required?: string) => {
    if (required && required !== 'viewer' && !canWrite) {
      throw new ForbiddenException('이 프로젝트에 대한 권한이 없습니다.');
    }
  };

  const timeZoneOf = async (projectId: string) => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { timezone: true },
    });
    return project?.timezone || 'Asia/Seoul';
  };

  return {
    resolveAndVerifyProjectId: async (_userId: string, projectId?: string, required?: string) => {
      requireWrite(required);
      return projectId ?? defaultProjectId;
    },
    verifyUserHasAccessToProject: async (
      _userId?: string,
      _projectId?: string,
      required?: string,
    ) => requireWrite(required),
    verifyUserRole: async (_userId?: string, _projectId?: string, required?: string) =>
      requireWrite(required),
    resolveProject: async (_userId: string, projectId?: string) => {
      const id = projectId ?? defaultProjectId;
      return { id, timeZone: await timeZoneOf(id) };
    },
    getProjectTimeZone: (projectId: string) => timeZoneOf(projectId),
    getProjectCurrencies: async (projectId: string) => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ledgerCurrency: true, displayCurrency: true },
      });
      const ledger = project?.ledgerCurrency || 'KRW';
      return { ledger, display: project?.displayCurrency || ledger };
    },
    getProjectLedgerCurrency: async (projectId: string) => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ledgerCurrency: true },
      });
      return project?.ledgerCurrency || 'KRW';
    },
  } as any;
}

/**
 * 원장 서비스 조립.
 *
 * 통화 환산이 들어오면서 의존성이 셋으로 늘었다. 스크립트마다 직접 new 하면
 * 의존성이 바뀔 때마다 전부 고쳐야 하므로 여기 한 곳에 모은다.
 */
export function makeLedger(prisma: PrismaClient, access: unknown) {
  const exchangeRates = new ExchangeRatesService(prisma as any);
  return new LedgerService(prisma as any, access as any, exchangeRates);
}

/** 계좌 서비스 조립. 통화 검증 때문에 환율 서비스를 함께 쓴다. */
export function makeAccounts(
  prisma: PrismaClient,
  access: unknown,
  ledger: unknown,
  institutions: unknown,
) {
  const exchangeRates = new ExchangeRatesService(prisma as any);
  return new AccountsService(
    prisma as any,
    access as any,
    ledger as any,
    institutions as any,
    exchangeRates,
  );
}

/** 리포트 서비스 조립. 순자산이 외화를 환산하느라 환율 서비스를 함께 쓴다. */
export function makeReports(prisma: PrismaClient, access: unknown) {
  const exchangeRates = new ExchangeRatesService(prisma as any);
  return new ReportsService(prisma as any, access as any, exchangeRates);
}

/** 거래 서비스 조립. 목록 금액을 표시 통화로 옮기느라 환율 서비스를 쓴다. */
export function makeEntries(prisma: PrismaClient, access: unknown, ledger: unknown) {
  const exchangeRates = new ExchangeRatesService(prisma as any);
  return new EntriesService(prisma as any, access as any, ledger as any, exchangeRates);
}

/** 예산 서비스 조립. 예산액을 저장 통화 <-> 표시 통화로 옮긴다. */
export function makeBudgets(prisma: PrismaClient, access: unknown) {
  const exchangeRates = new ExchangeRatesService(prisma as any);
  return new BudgetsService(prisma as any, access as any, exchangeRates);
}
