/**
 * 앱·웹의 버전 정책을 읽고 고친다.
 *
 * 모든 요청이 이 값을 본다(`AppVersionGuard`). 요청마다 표를 읽지 않도록 서버마다 잠깐
 * 들고 있는다. 관리 도구에서 고치면 고친 서버는 곧바로, 다른 서버는 캐시가 지나면 바뀐다.
 */
import { Injectable } from '@nestjs/common';
import {
  APP_PLATFORMS,
  compareVersions,
  isVersion,
  type AppPlatform,
  type AppVersionPolicy,
  type AppVersionPolicyUpdate,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { badRequest } from '@/common/app-error';

/** 캐시를 믿는 시간. 강제 업데이트를 올린 뒤 모든 서버에 먹기까지 이만큼 걸린다. */
const CACHE_MS = 30 * 1000;

/** 안내 문구와 주소의 상한. 창에 들어갈 만큼이면 된다. */
const MAX_MESSAGE = 500;
const MAX_URL = 500;

@Injectable()
export class AppVersionService {
  private cache: { at: number; policies: Map<AppPlatform, AppVersionPolicy> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** 플랫폼 셋의 정책. 줄이 없는 플랫폼은 빈 정책으로 채운다. */
  async list(): Promise<AppVersionPolicy[]> {
    const policies = await this.load();
    return APP_PLATFORMS.map((platform) => policies.get(platform) ?? emptyPolicy(platform));
  }

  async get(platform: AppPlatform): Promise<AppVersionPolicy> {
    return (await this.load()).get(platform) ?? emptyPolicy(platform);
  }

  /**
   * 고친다. 빈 글자는 "없음"(null)이다.
   *
   * **권유가 강제보다 낮으면 거절한다.** "1.3 아래는 막고 1.2 아래는 권한다"는 뜻이 서지
   * 않는다 -- 강제에 걸린 판은 권유 창을 볼 일이 없다. 적다가 뒤바꾼 것일 가능성이 크다.
   */
  async update(platform: AppPlatform, body: Partial<AppVersionPolicyUpdate>): Promise<AppVersionPolicy> {
    const minVersion = versionOrNull(body.minVersion, '강제 업데이트 버전');
    const latestVersion = versionOrNull(body.latestVersion, '권유 버전');
    if (minVersion && latestVersion && compareVersions(latestVersion, minVersion) < 0) {
      throw badRequest('APP_VERSION_INVALID', '권유 버전은 강제 업데이트 버전보다 낮을 수 없습니다.');
    }

    const storeUrl = textOrNull(body.storeUrl, MAX_URL);
    if (storeUrl && !/^(https?|market|itms-apps):\/\//.test(storeUrl)) {
      throw badRequest('APP_VERSION_INVALID', '업데이트 주소는 https:// 로 시작해야 합니다.');
    }
    const data = { minVersion, latestVersion, storeUrl, message: textOrNull(body.message, MAX_MESSAGE) };

    const row = await this.prisma.appVersionPolicy.upsert({
      where: { platform },
      create: { platform, ...data },
      update: data,
    });
    this.cache = null;
    return toPolicy(row);
  }

  private async load(): Promise<Map<AppPlatform, AppVersionPolicy>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.policies;

    const rows = await this.prisma.appVersionPolicy.findMany();
    const policies = new Map<AppPlatform, AppVersionPolicy>();
    for (const row of rows) {
      if (isPlatform(row.platform)) policies.set(row.platform, toPolicy(row));
    }
    this.cache = { at: Date.now(), policies };
    return policies;
  }
}

export function isPlatform(value: unknown): value is AppPlatform {
  return APP_PLATFORMS.includes(value as AppPlatform);
}

function emptyPolicy(platform: AppPlatform): AppVersionPolicy {
  return { platform, minVersion: null, latestVersion: null, storeUrl: null, message: null, updatedAt: null };
}

function toPolicy(row: {
  platform: string;
  minVersion: string | null;
  latestVersion: string | null;
  storeUrl: string | null;
  message: string | null;
  updatedAt: Date;
}): AppVersionPolicy {
  return {
    platform: row.platform as AppPlatform,
    minVersion: row.minVersion,
    latestVersion: row.latestVersion,
    storeUrl: row.storeUrl,
    message: row.message,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function versionOrNull(value: unknown, label: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!isVersion(text)) {
    throw badRequest('APP_VERSION_INVALID', `${label}은 1.2.0 처럼 점으로 나눈 숫자로 적어 주세요.`);
  }
  return text;
}

function textOrNull(value: unknown, max: number): string | null {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}
