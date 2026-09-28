/**
 * 강제 업데이트. 최소 버전보다 낮은 판의 요청을 426 으로 거절한다.
 *
 * 화면의 창만으로는 막히지 않는다 -- 창을 띄우기 전에 보낸 요청, 창을 띄우는 코드가 없는
 * 판, 백그라운드 작업(알림 담기)이 있다. 서버가 막아야 옛 판이 새 API 를 틀린 모양으로
 * 부르는 일이 없어진다.
 *
 * **머리글이 없으면 통과시킨다.** 이 검사가 생기기 전의 판은 버전을 싣지 않는다. 그 판을
 * 막으려면 그 판이 알아들을 창이 없어, 사람은 까닭 모를 오류만 본다.
 */
import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_PLATFORM_HEADER, APP_VERSION_HEADER, updateLevelOf } from '@money/types';

import { AppVersionService, isPlatform } from './app-version.service';
import { SKIP_VERSION_CHECK } from './skip-version-check.decorator';

/** Upgrade Required. 다시 보내도 같은 답이라 화면은 재시도하지 않는다. */
const UPGRADE_REQUIRED = 426;

@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly versions: AppVersionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_VERSION_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const platform = request.headers[APP_PLATFORM_HEADER];
    const version = request.headers[APP_VERSION_HEADER];
    if (!isPlatform(platform) || typeof version !== 'string') return true;

    const policy = await this.versions.get(platform);
    if (updateLevelOf(version, policy) !== 'force') return true;

    throw new HttpException(
      {
        code: 'APP_UPDATE_REQUIRED',
        message: '이 버전은 더 이상 쓸 수 없습니다. 업데이트해 주세요.',
        details: { minVersion: policy.minVersion ?? '' },
      },
      UPGRADE_REQUIRED,
    );
  }
}
