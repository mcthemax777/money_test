/**
 * 앱·웹의 버전 정책. 서버·앱·웹이 같은 비교를 쓴다.
 *
 * 두 단계가 있다.
 *
 *   - **강제**(`minVersion`): 이보다 낮은 판은 쓸 수 없다. 서버가 요청을 426 으로 거절하고,
 *     화면은 닫을 수 없는 업데이트 창을 띄운다. API 를 옛 판과 맞지 않게 바꿀 때 올린다.
 *   - **권유**(`latestVersion`): 이보다 낮으면 "새 버전이 있습니다"를 한 번 묻는다. 그대로
 *     써도 된다.
 *
 * 값은 관리 도구(`/admin/app-versions`)에서 바꾼다. 재배포 없이 곧바로 먹는다.
 */

/** 정책을 따로 두는 자리. 웹은 설치가 없어 "새로고침"이 곧 업데이트다. */
export const APP_PLATFORMS = ['android', 'ios', 'web'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

/** 요청마다 싣는 머리글. 서버의 검사가 이 둘을 본다. 없으면 검사하지 않는다(옛 판). */
export const APP_PLATFORM_HEADER = 'x-app-platform';
export const APP_VERSION_HEADER = 'x-app-version';

export interface AppVersionPolicy {
  platform: AppPlatform;
  /** 이보다 낮으면 강제 업데이트. null 이면 강제하지 않는다. */
  minVersion: string | null;
  /** 이보다 낮으면 권유. null 이면 권하지 않는다. */
  latestVersion: string | null;
  /** 업데이트 단추가 여는 주소. null 이면 화면이 정한 기본(스토어)을 쓴다. */
  storeUrl: string | null;
  /** 창에 덧붙일 말. "카드 대금 계산이 바뀌었습니다" 같은 것. */
  message: string | null;
  updatedAt: string | null;
}

/** 관리 도구가 고칠 때 보내는 값. */
export type AppVersionPolicyUpdate = Pick<
  AppVersionPolicy,
  'minVersion' | 'latestVersion' | 'storeUrl' | 'message'
>;

/** 버전의 모양. 점으로 나눈 숫자("1.2.0", 웹 빌드 "20260929.153000"). */
export const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/**
 * 두 버전을 견준다. 왼쪽이 낮으면 음수, 같으면 0, 높으면 양수.
 *
 * 글자로 견주면 "1.10.0" 이 "1.9.0" 보다 낮게 나온다. 마디마다 숫자로 견주고, 모자란 마디는
 * 0 으로 본다("1.2" 와 "1.2.0" 은 같다).
 */
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 지금 판에 필요한 것. 강제·권유·없음. */
export type UpdateLevel = 'force' | 'recommend' | null;

/**
 * 이 판이 정책에 비추어 무엇을 해야 하는가.
 *
 * 버전을 읽을 수 없으면(모양이 틀리면) 아무것도 하지 않는다 -- 모르는 판을 막으면 멀쩡한
 * 사람이 아무것도 못 한다. 정책 값이 틀린 모양이어도 그 단계는 없는 것으로 본다.
 */
export function updateLevelOf(
  current: string | null | undefined,
  policy: Pick<AppVersionPolicy, 'minVersion' | 'latestVersion'> | null | undefined,
): UpdateLevel {
  if (!policy || !isVersion(current)) return null;
  if (isVersion(policy.minVersion) && compareVersions(current, policy.minVersion) < 0) return 'force';
  if (isVersion(policy.latestVersion) && compareVersions(current, policy.latestVersion) < 0) {
    return 'recommend';
  }
  return null;
}
