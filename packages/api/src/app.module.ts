import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './config/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';

// v2 모듈
import { PeopleModule } from './modules/v2/people/people.module';
import { AccountsModule as AccountsModuleV2 } from './modules/v2/accounts/accounts.module';
import { CardsModule } from './modules/v2/cards/cards.module';
import { CategoriesModule as CategoriesModuleV2 } from './modules/v2/categories/categories.module';
import { TransactionsModule as TransactionsModuleV2 } from './modules/v2/transactions/transactions.module';
import { BudgetsModule } from './modules/v2/budgets/budgets.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    PeopleModule,
    AccountsModuleV2,
    CardsModule,
    CategoriesModuleV2,
    TransactionsModuleV2,
    BudgetsModule,
  ],
})
export class AppModule {}
