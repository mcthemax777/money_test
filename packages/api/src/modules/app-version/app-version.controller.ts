import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { badRequest } from '@/common/app-error';
import { AppVersionService, isPlatform } from './app-version.service';
import { SkipVersionCheck } from './skip-version-check.decorator';

/**
 * 버전 정책 읽기. 로그인 없이 부른다.
 *
 * 로그인 화면에서도, 강제 업데이트에 걸린 판에서도 읽혀야 한다 -- 그 판이 "어디로 올려야
 * 하는가"를 알 길이 이것뿐이다.
 */
@ApiTags('App version')
@Controller('app-version')
@SkipVersionCheck()
export class AppVersionController {
  constructor(private readonly versions: AppVersionService) {}

  @Get(':platform')
  get(@Param('platform') platform: string) {
    if (!isPlatform(platform)) {
      throw badRequest('APP_VERSION_INVALID', '플랫폼은 android, ios, web 중 하나입니다.');
    }
    return this.versions.get(platform);
  }
}
