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
  async redirects() {
    return [{ source: '/dashboard', destination: '/transactions', permanent: false }];
  },
};

module.exports = nextConfig;
