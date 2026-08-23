import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExchangeRatesService } from './exchange-rates.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { toMoney } from '@/common/money';
import { zonedParts } from '@money/types';
import { AuthenticatedRequest } from '@/common/authenticated-request';

@ApiTags('ExchangeRates')
@Controller('exchange-rates')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ExchangeRatesController {
  constructor(
    private readonly exchangeRates: ExchangeRatesService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * 환율 정보.
   *
   * 두 가지를 함께 준다.
   *   rates       : 각 통화 -> **저장 통화**. 거래를 입력할 때 쓴다. 원장이 저장하는
   *                 환산액이 저장 통화 기준이기 때문이다. 사용자는 이 값을 그대로
   *                 두거나 카드 명세서의 실제 환율로 고친다.
   *   displayRate : 저장 통화 -> **표시 통화**. 화면이 합계를 어느 통화로 보여줄지다.
   *                 표시 통화를 바꿔도 저장값은 그대로이므로 이 환율만 달라진다.
   */
  @Get()
  @ApiOperation({ summary: '거래 입력용 환율과 표시 환율' })
  async list(
    @Request() req: AuthenticatedRequest,
    @Query('projectId') projectId?: string,
  ) {
    const resolved = await this.projectAccess.resolveAndVerifyProjectId(req.user.id, projectId);
    const { ledger, display } = await this.projectAccess.getProjectCurrencies(resolved);

    return {
      ledgerCurrency: ledger,
      displayCurrency: display,
      rates: await this.exchangeRates.listRatesFor(resolved, ledger),
      displayRate: await this.exchangeRates.getRate(resolved, ledger, display),
    };
  }

  /**
   * 환율을 직접 정한다. 설정 화면에서 쓴다.
   *
   * 거래 입력에서는 환율을 받지 않는다. 사용자가 아는 값은 실제로 빠진 금액이고
   * 환율은 그 비로 유도된다. 여기서 정하는 값은 아직 금액을 모르는 거래를
   * 추정할 때와 표시 통화 환산에 쓰인다.
   */
  @Put()
  @ApiOperation({ summary: '환율 직접 설정 (설정 화면)' })
  async set(
    @Request() req: AuthenticatedRequest,
    @Body() dto: { from?: string; to?: string; rate?: string },
    @Query('projectId') projectId?: string,
  ) {
    const resolved = await this.projectAccess.resolveAndVerifyProjectId(req.user.id, projectId);
    await this.projectAccess.verifyUserHasAccessToProject(req.user.id, resolved, 'editor');
    const timeZone = await this.projectAccess.getProjectTimeZone(resolved);

    /*
     * 오늘 날짜.
     *
     * date 컬럼은 @db.Date 라 시각이 없는 달력 날짜다. UTC로 그냥 찍으면 한국
     * 자정 직후에 어제 날짜 행이 만들어져 목록에 두 줄이 남는다. 프로젝트
     * 타임존의 벽시계 날짜를 UTC 자정으로 만들어 넣는다.
     */
    const today = zonedParts(new Date(), timeZone);

    return this.exchangeRates.setRate(
      resolved,
      this.exchangeRates.assertCurrency(dto?.from, '기준 통화'),
      this.exchangeRates.assertCurrency(dto?.to, '대상 통화'),
      toMoney(dto?.rate, '환율'),
      new Date(Date.UTC(today.year, today.month - 1, today.day)),
    );
  }

  /** 직접 정한 환율을 지우고 기본값으로 되돌린다. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '직접 정한 환율 삭제 (기본값으로)' })
  async clear(
    @Request() req: AuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('projectId') projectId?: string,
  ) {
    const resolved = await this.projectAccess.resolveAndVerifyProjectId(req.user.id, projectId);
    await this.projectAccess.verifyUserHasAccessToProject(req.user.id, resolved, 'editor');

    await this.exchangeRates.clearRate(
      resolved,
      this.exchangeRates.assertCurrency(from, '기준 통화'),
      this.exchangeRates.assertCurrency(to, '대상 통화'),
    );
  }
}
