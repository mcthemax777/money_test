/**
 * 이 빌드의 번호. "20260929.153000" (UTC, 빌드한 때).
 *
 * 버전 정책(`@money/types` 의 app-version)이 점으로 나눈 숫자를 견주므로 그 모양으로 만든다.
 * 늦게 빌드한 것이 늘 크다. 화면 코드와 `/version` 창구에 빌드할 때 박힌다 -- 열려 있던
 * 탭은 자기 번호를, 창구는 지금 배포된 번호를 알려 주어 둘이 다르면 새 버전이 있는 것이다.
 *
 * `WEB_VERSION` 을 주면 그 값을 쓴다(같은 빌드를 여러 서버에 올릴 때 번호를 맞춘다).
 */
function buildVersion() {
  if (process.env.WEB_VERSION) return process.env.WEB_VERSION;
  const iso = new Date().toISOString(); // 2026-09-29T15:30:00.000Z
  return `${iso.slice(0, 10).replace(/-/g, '')}.${iso.slice(11, 19).replace(/:/g, '')}`;
}

const WEB_VERSION = buildVersion();

/*
 * 한 빌드 안에서 번호가 하나여야 한다.
 *
 * 빌드는 이 파일을 여러 번 읽는다(작업자마다). 그때마다 시각을 새로 재면 화면 코드와
 * `/version` 에 1초 어긋난 번호가 박혀, 막 연 탭에도 "새 버전" 띠가 뜬다(실제로 겪었다).
 * 처음 잰 값을 환경 변수에 적어 두면 뒤에 뜨는 작업자가 물려받는다.
 */
process.env.WEB_VERSION = WEB_VERSION;

/**
 * 보안 정책(CSP). 두 겹이다 (2026-10-16).
 *
 * 막는 정책(`ENFORCED_CSP`)에는 남의 스크립트를 깨지 않는 것만 둔다 -- 플러그인 객체, 기준 주소 바꾸기,
 * 다른 사이트가 이 화면을 틀에 넣기(클릭재킹), 다른 곳으로의 폼 전송.
 *
 * 스크립트·연결·틀·그림의 허용 목록은 **기록만 하는 정책**(`REPORT_ONLY_CSP`)에 둔다. 애드센스는 광고마다
 * 여러 구글 광고 도메인을 오가는데 그 전부를 미리 알 수 없어, 목록을 짐작으로 막으면 광고·로그인이
 * 조용히 깨진다. 목록 밖이 쓰이면 브라우저가 `/csp-report` 로 알리고 웹 서버 로그에 남는다. 며칠 모아
 * 빠진 곳을 채운 뒤 이 목록을 막는 정책으로 옮긴다.
 */
function apiOrigin() {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').origin;
  } catch {
    return '';
  }
}

const ENFORCED_CSP = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

/** 구글 광고(애드센스)가 오가는 곳. 기록을 보고 채운다. */
const GOOGLE_ADS = [
  'https://pagead2.googlesyndication.com',
  'https://*.googlesyndication.com',
  'https://*.doubleclick.net',
  'https://*.googleadservices.com',
  'https://adservice.google.com',
  'https://www.google.com',
  'https://*.adtrafficquality.google',
  'https://fundingchoicesmessages.google.com',
];

const REPORT_ONLY_CSP = [
  "default-src 'self'",
  // Next 가 페이지에 박는 작은 스크립트가 인라인이다. WASM 은 영수증 글자 읽기(tesseract.js)다.
  [
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    'https://accounts.google.com/gsi/client',
    'https://www.googletagmanager.com',
    'https://cdn.jsdelivr.net',
    ...GOOGLE_ADS,
  ].join(' '),
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  // 구글 프로필 사진, 광고 그림.
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.google.com https://*.gstatic.com " +
    GOOGLE_ADS.join(' '),
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    apiOrigin(),
    'https://accounts.google.com/gsi/',
    // Firebase 통계(GA4)
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://firebase.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
    'https://www.googletagmanager.com',
    // 영수증 글자 읽기 자료(언어 모델·WASM)
    'https://cdn.jsdelivr.net',
    ...GOOGLE_ADS,
  ]
    .filter(Boolean)
    .join(' '),
  ['frame-src https://accounts.google.com/gsi/', ...GOOGLE_ADS].join(' '),
  // tesseract.js 는 워커를 blob: 주소로 띄운다.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  'report-uri /csp-report',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: ENFORCED_CSP },
  { key: 'Content-Security-Policy-Report-Only', value: REPORT_ONLY_CSP },
  // 내용 종류를 짐작해 실행하지 않는다 (올린 파일을 스크립트로 읽는 길을 닫는다).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // 다른 사이트로 나갈 때 주소의 경로·검색어(초대 코드 등)를 실어 보내지 않는다.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  env: {
    NEXT_PUBLIC_WEB_VERSION: WEB_VERSION,
  },
  // 빌드 id 도 같은 번호로. 배포마다 바뀌는 값이라 둘을 따로 둘 까닭이 없다.
  generateBuildId: async () => WEB_VERSION,
  /*
   * 가계(/dashboard)는 2026-10-06에 뺐다. 즐겨찾기나 열려 있던 탭이 404 를 보지 않도록
   * 그 일을 넘겨받은 거래 화면으로 보낸다.
   */
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return [{ source: '/dashboard', destination: '/transactions', permanent: false }];
  },
};

module.exports = nextConfig;
