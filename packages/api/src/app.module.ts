import { Module } from '@nestjs/common';
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
import { EntriesModule } from './modules/entries/entries.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    PeopleModule,
    InstitutionsModule,
    AccountsModule,
    CardsModule,
    CategoriesModule,
    LedgerModule,
    EntriesModule,
    BudgetsModule,
    ReportsModule,
  ],
})
export class AppModule {}
