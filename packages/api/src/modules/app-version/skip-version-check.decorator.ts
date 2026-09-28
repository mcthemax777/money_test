import { SetMetadata } from '@nestjs/common';

export const SKIP_VERSION_CHECK = 'skipVersionCheck';

/**
 * 버전 검사를 건너뛴다. 옛 판도 닿아야 하는 길에 붙인다.
 *
 * 정책 읽기(옛 판이 "무엇으로 올려야 하는가"를 알아야 한다), 상태 확인, 관리 도구.
 */
export const SkipVersionCheck = () => SetMetadata(SKIP_VERSION_CHECK, true);
