import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AdminAuthService } from './admin-auth.service';

/** 관리 도구 API 를 지킨다. `Authorization: Bearer <관리자 토큰>` 만 통과한다. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { admin?: unknown }>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const payload = token ? await this.auth.verify(token) : null;
    if (!payload) throw new UnauthorizedException('관리자 로그인이 필요합니다.');
    request.admin = payload;
    return true;
  }
}
