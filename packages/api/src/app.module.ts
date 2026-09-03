import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SyncNotifyMiddleware } from './common/sync-notify.middleware';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './config/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PeopleModule } from './modules/people/people.module';
import { InstitutionsModule } from './modules/institutions/institutions.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { CardsModule } from './modules/cards/cards.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { TagsModule } from './modules/tags/tags.module';
import { EntriesModule } from './modules/entries/entries.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ExchangeRatesModule } from './modules/exchange-rates/exchange-rates.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    /*
     * 전역 요청 상한.
     *
     * 화면 하나가 여러 요청을 동시에 보내므로(대시보드는 한 번에 10건 남짓)
     * 일반 경로는 넉넉하게 둔다. 목적은 사용자 제한이 아니라 자동화된 대량
     * 호출을 끊는 것이다. 로그인처럼 값싸게 반복 시도할 수 있는 경로는
     * 컨트롤러에서 @Throttle 로 훨씬 좁게 다시 건다.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    ConfigModule,
    DatabaseModule,
    RealtimeModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    PeopleModule,
    InstitutionsModule,
    AccountsModule,
    CardsModule,
    CategoriesModule,
    TagsModule,
    LedgerModule,
    EntriesModule,
    BudgetsModule,
    ReportsModule,
    ExchangeRatesModule,
    SyncModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  /**
   * 쓰기 요청을 문맥으로 감싸고, 끝나면 실시간 신호를 흘린다.
   *
   * 미들웨어에 두는 이유는 요청 처리 전체를 감싸야 하기 때문이다. 인터셉터는
   * 핸들러가 실제로 도는 시점과 구독 시점이 어긋나 AsyncLocalStorage 가 새어 나간다.
   * 읽기 메서드는 미들웨어가 곧바로 흘려보낸다.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SyncNotifyMiddleware).forRoutes('*');
  }
}
