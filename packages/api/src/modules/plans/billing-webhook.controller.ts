/**
 * 결제 웹훅. 사용자 로그인(JWT)도 앱 버전 검사도 거치지 않는다 -- 부르는 쪽은 RevenueCat 서버다.
 * 대신 RevenueCat 대시보드에 적은 Authorization 머리글 값과 서버 설정(REVENUECAT_WEBHOOK_AUTH)을
 * 견준다.
 *
 * 응답: 처리했거나 일부러 넘긴 알림은 200(넘긴 알림을 실패로 돌려주면 RevenueCat 이 다섯 번
 * 다시 보낸다). 머리글이 틀리면 401, 서버에 값이 없으면 503. DB 오류 따위는 그대로 500 이 되어
 * RevenueCat 이 다시 보낸다 -- 같은 결제는 한 줄만 남으므로 다시 받아도 안전하다.
 */
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';

import { ConfigService } from '@/config/config.service';
import { SkipVersionCheck } from '../app-version/skip-version-check.decorator';
import { BillingWebhookService, type RevenueCatEvent } from './billing-webhook.service';

@ApiExcludeController()
@Controller('webhooks')
@SkipVersionCheck()
@SkipThrottle()
export class BillingWebhookController {
  constructor(
    private readonly webhook: BillingWebhookService,
    private readonly config: ConfigService,
  ) {}

  @Post('revenuecat')
  @HttpCode(HttpStatus.OK)
  async revenueCat(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { event?: RevenueCatEvent } | undefined,
  ) {
    const expected = this.config.revenueCatWebhookAuth;
    if (!expected) throw new ServiceUnavailableException('결제 웹훅이 설정되지 않았습니다.');
    if (!sameSecret(authorization ?? '', expected)) {
      throw new UnauthorizedException('웹훅 인증이 맞지 않습니다.');
    }

    const outcome = await this.webhook.handle(body?.event);
    return { ok: true, outcome };
  }
}

/** 길이가 달라도 같은 시간에 답한다. 글자를 하나씩 맞혀 보는 공격에 단서를 주지 않는다. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
