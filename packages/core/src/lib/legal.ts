/**
 * 법적 고지 페이지의 자리 (2026-10-25). 웹의 /privacy·/terms·/account-deletion 이 그 글이고, 앱은 같은 주소를
 * 브라우저로 연다. 로그인 화면(가입 동의)과 설정이 함께 쓴다.
 */
export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  accountDeletion: '/account-deletion',
} as const;

/** 앱이 여는 웹의 주소. 웹은 같은 출처라 경로만 쓴다. */
export const LEGAL_ORIGIN = 'https://bboyong.online';

export function legalUrl(page: keyof typeof LEGAL_PATHS): string {
  return `${LEGAL_ORIGIN}${LEGAL_PATHS[page]}`;
}
