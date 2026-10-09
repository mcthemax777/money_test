/**
 * 관리 도구 API. 웹의 `/admin` 이 부른다.
 *
 * 도구가 늘면 여기에 길을 더한다(공휴일, 앱 버전, 알림 원문·규칙, 문의). 로그인 외에는 전부 `AdminGuard` 뒤에 있다.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  HOLIDAY_COUNTRIES,
  isPlanId,
  PLAN_GRANT_DAYS,
  type AdminPlanGrantRequest,
  type AdminPlanGrantResult,
  type AdminProjectPlanDto,
  type AppVersionPolicyUpdate,
  type HolidayCountry,
  type InquiryDto,
  type NotificationRuleDto,
  type NotificationSampleDto,
} from '@money/types';

import { AppVersionService, isPlatform } from '../app-version/app-version.service';
import { SkipVersionCheck } from '../app-version/skip-version-check.decorator';
import { HolidaysService } from '../holidays/holidays.service';
import { InquiriesService } from '../inquiries/inquiries.service';
import { NotificationSamplesService } from '../notification-samples/notification-samples.service';
import { PlansService } from '../plans/plans.service';
import { AdminAuthService, type AdminTokenPayload } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

/** 비밀번호 대입을 막는다. 사람이 틀려 가며 넣는 속도면 충분하다. */
const LOGIN_LIMIT = { default: { ttl: 60_000, limit: 5 } };

@ApiTags('Admin')
// 관리 도구는 웹에서 연다. 웹의 강제 새로고침에 걸린 탭에서도 정책을 되돌릴 수 있어야 한다.
@Controller('admin')
@SkipVersionCheck()
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly holidays: HolidaysService,
    private readonly versions: AppVersionService,
    private readonly samples: NotificationSamplesService,
    private readonly inquiries: InquiriesService,
    private readonly plans: PlansService,
  ) {}

  @Post('login')
  @Throttle(LOGIN_LIMIT)
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { username?: string; password?: string }) {
    return this.auth.login(String(body?.username ?? ''), String(body?.password ?? ''));
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@Req() request: { admin: AdminTokenPayload }) {
    return { username: request.admin.sub };
  }

  @Get('holidays')
  @UseGuards(AdminGuard)
  listHolidays(@Query('country') country: string, @Query('year') year: string) {
    return this.holidays.list(checkCountry(country), checkYear(year));
  }

  /** 공휴일 갱신. 나라를 주지 않으면 모든 나라를 갱신한다. */
  @Post('holidays/sync')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  syncHolidays(@Body() body: { country?: string }) {
    return body?.country
      ? this.holidays.sync(checkCountry(body.country)).then((result) => [result])
      : this.holidays.syncAll();
  }

  @Post('holidays')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async addHoliday(@Body() body: { country?: string; date?: string; name?: string }) {
    const name = String(body?.name ?? '').trim();
    if (!name || name.length > 100) {
      throw new BadRequestException('공휴일 이름을 100자 안으로 적어 주세요.');
    }
    await this.holidays.add(checkCountry(body?.country), checkDate(body?.date), name);
  }

  @Get('app-versions')
  @UseGuards(AdminGuard)
  listAppVersions() {
    return this.versions.list();
  }

  @Put('app-versions/:platform')
  @UseGuards(AdminGuard)
  updateAppVersion(@Param('platform') platform: string, @Body() body: Partial<AppVersionPolicyUpdate>) {
    if (!isPlatform(platform)) {
      throw new BadRequestException('플랫폼은 android, ios, web 중 하나입니다.');
    }
    return this.versions.update(platform, body ?? {});
  }

  // 알림 원문(표본) ---------------------------------------------------------

  @Get('notification-samples')
  @UseGuards(AdminGuard)
  listNotificationSamples(@Query() query: NotificationSampleDto.ListQuery) {
    return this.samples.list(query);
  }

  @Get('notification-samples/packages')
  @UseGuards(AdminGuard)
  notificationSamplePackages() {
    return this.samples.packages();
  }

  @Delete('notification-samples/:id')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeNotificationSample(@Param('id') id: string) {
    await this.samples.removeSample(id);
  }

  // 앱별 알림 문구 규칙 -------------------------------------------------------

  @Get('notification-rules')
  @UseGuards(AdminGuard)
  listNotificationRules(@Query('packageName') packageName?: string) {
    return this.samples.listRules(packageName || undefined);
  }

  @Post('notification-rules')
  @UseGuards(AdminGuard)
  createNotificationRule(@Body() body: NotificationRuleDto.SaveRequest) {
    return this.samples.createRule(body);
  }

  @Put('notification-rules/:id')
  @UseGuards(AdminGuard)
  updateNotificationRule(@Param('id') id: string, @Body() body: Partial<NotificationRuleDto.SaveRequest>) {
    return this.samples.updateRule(id, body ?? {});
  }

  @Delete('notification-rules/:id')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeNotificationRule(@Param('id') id: string) {
    await this.samples.removeRule(id);
  }

  // 문의하기 ---------------------------------------------------------------

  @Get('inquiries')
  @UseGuards(AdminGuard)
  listInquiries(@Query() query: InquiryDto.AdminListQuery) {
    return this.inquiries.adminList(query);
  }

  @Get('inquiries/:id')
  @UseGuards(AdminGuard)
  getInquiry(@Param('id') id: string) {
    return this.inquiries.adminGet(id);
  }

  /** 먼저 보낼 사람 찾기. 이름·이메일의 일부. */
  @Get('users')
  @UseGuards(AdminGuard)
  searchUsers(@Query('q') q?: string) {
    return this.inquiries.adminSearchUsers(q);
  }

  /** 사용자가 묻지 않았어도 관리자가 먼저 대화를 연다. 그 사용자의 기기로 푸시가 간다. */
  @Post('inquiries')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.CREATED)
  startInquiry(@Body() body: InquiryDto.AdminStartRequest) {
    return this.inquiries.adminStart(body);
  }

  /** 답장. 그 사용자의 기기로 푸시가 간다. */
  @Post('inquiries/:id/replies')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.CREATED)
  replyInquiry(@Param('id') id: string, @Body() body: InquiryDto.MessageRequest) {
    return this.inquiries.reply(id, body);
  }

  // 이용권 -----------------------------------------------------------------

  /** 이용권을 줄 프로젝트 찾기. 이름·참여 키·id·소유자 이메일. */
  @Get('projects')
  @UseGuards(AdminGuard)
  searchProjects(@Query('q') q?: string) {
    return this.plans.adminSearchProjects(q);
  }

  /** 한 프로젝트의 지금 이용권과 권한 줄 전부(거둔 줄 포함). */
  @Get('projects/:projectId/plan')
  @UseGuards(AdminGuard)
  async getProjectPlan(@Param('projectId') projectId: string): Promise<AdminProjectPlanDto> {
    return this.plans.adminProjectPlan(projectId);
  }

  /**
   * 관리자 지급 (보상·시험, 금액 0). 이용권 종류(개월)나 날 수(`plan: 'days'`)로 준다.
   * Play 구독이 이어지는 중이면 결제일을 함께 미룬다(PlansService.adminGrant).
   */
  @Post('projects/:projectId/plan-grants')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.CREATED)
  grantPlan(
    @Param('projectId') projectId: string,
    @Body() body: Partial<AdminPlanGrantRequest>,
  ): Promise<AdminPlanGrantResult> {
    const plan = body?.plan;
    if (plan !== PLAN_GRANT_DAYS && !isPlanId(plan)) {
      throw new BadRequestException('이용권 종류가 올바르지 않습니다.');
    }
    if (body.deferStoreBilling !== undefined && typeof body.deferStoreBilling !== 'boolean') {
      throw new BadRequestException('deferStoreBilling 은 true/false 여야 합니다.');
    }
    return this.plans.adminGrant({
      projectId,
      plan,
      days: plan === PLAN_GRANT_DAYS ? body.days : undefined,
      note: typeof body.note === 'string' ? body.note : null,
      deferStoreBilling: body.deferStoreBilling,
    });
  }

  /** 권한 거두기. 뒤에 이어 붙어 있던 기간제는 앞으로 당겨진다. */
  @Post('plan-grants/:id/revoke')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  revokePlan(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.plans.revoke(id, body?.reason?.trim() ?? '');
  }

  @Delete('holidays/:country/:date')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeHoliday(@Param('country') country: string, @Param('date') date: string) {
    await this.holidays.remove(checkCountry(country), checkDate(date));
  }
}

function checkCountry(value: unknown): HolidayCountry {
  if (!HOLIDAY_COUNTRIES.includes(value as HolidayCountry)) {
    throw new BadRequestException(`나라는 ${HOLIDAY_COUNTRIES.join(', ')} 중 하나입니다.`);
  }
  return value as HolidayCountry;
}

function checkYear(value: unknown): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException('연도가 올바르지 않습니다.');
  }
  return year;
}

/** "YYYY-MM-DD" 이고 달력에 있는 날인가. */
function checkDate(value: unknown): string {
  const text = String(value ?? '');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || parsed.toISOString().slice(0, 10) !== text) {
    throw new BadRequestException('날짜는 2026-10-09 처럼 적어 주세요.');
  }
  return text;
}
