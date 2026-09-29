import { Module } from '@nestjs/common';

import { ProjectAccessService } from '@/common/project-access.guard';
import { DatabaseModule } from '@/config/database.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CardsModule } from '../cards/cards.module';
import { CategoriesModule } from '../categories/categories.module';
import { EntriesModule } from '../entries/entries.module';
import { InstitutionsModule } from '../institutions/institutions.module';
import { PeopleModule } from '../people/people.module';
import { TagsModule } from '../tags/tags.module';
import { EntrySheetController } from './entry-sheet.controller';
import { EntrySheetService } from './entry-sheet.service';

/** 거래내역 엑셀 가져오기·내보내기. 없는 것을 만드는 길은 각 모듈의 서비스를 그대로 쓴다. */
@Module({
  imports: [
    DatabaseModule,
    EntriesModule,
    PeopleModule,
    AccountsModule,
    CardsModule,
    CategoriesModule,
    TagsModule,
    InstitutionsModule,
  ],
  controllers: [EntrySheetController],
  providers: [EntrySheetService, ProjectAccessService],
})
export class EntrySheetModule {}
