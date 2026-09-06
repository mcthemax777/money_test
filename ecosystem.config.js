/**
 * 몇 개를 띄울 것인가.
 *
 * `API_INSTANCES=4 ./scripts/deploy.sh` 처럼 넘긴다. 'max' 를 주면 코어 수만큼이다.
 * 기본은 1 -- 늘리는 것은 아래 셋을 함께 정한 뒤에 할 일이다.
 *
 *   1. **REDIS_URL.** 없으면 실시간 신호가 그 프로세스 안에서만 돌고, 요청 상한도
 *      인스턴스마다 따로 세어져 한도가 N배가 된다.
 *   2. **DATABASE_CONNECTION_LIMIT.** 없으면 Prisma 가 프로세스마다 코어×2+1 을 잡아
 *      그 수만큼 곱해진다. 어림값은 (max_connections - 여유) / 인스턴스 수.
 *   3. **마이그레이션의 하위 호환.** 배포가 reload 라 잠깐 옛 코드와 새 코드가 함께 돈다.
 */
const apiInstances = process.env.API_INSTANCES || 1;

module.exports = {
  apps: [
    {
      name: 'money-api',
      cwd: './packages/api',
      script: 'dist/main.js',
      instances: apiInstances === 'max' ? 'max' : Number(apiInstances),
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      // log_file(합본)은 두지 않는다. out·err를 합친 것이라 같은 내용이 두 번 쌓인다.
      // 회전은 pm2-logrotate 모듈이 맡는다 (pm2 install pm2-logrotate).
      error_file: 'logs/api-error.log',
      out_file: 'logs/api-out.log',
      time_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'money-web',
      cwd: './packages/web',
      // .bin/next 는 셸 스크립트라 PM2가 fork 할 수 없다. 실제 Node 진입점을 가리킨다.
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      instances: 1,
      // cluster 모드는 Node의 cluster 모듈로 fork 하는데 next 는 그 방식과 맞지 않아
      // 계속 죽는다. 인스턴스가 하나면 cluster 로 얻는 것도 없다.
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // 포트를 놓기 전에 다음 프로세스가 뜨면 EADDRINUSE 로 죽는다.
      // 종료할 시간을 주고, 재시작 사이에도 간격을 둔다.
      kill_timeout: 5000,
      restart_delay: 3000,
      // 바인딩 실패처럼 즉시 죽는 상황에서 수십 번씩 재시도하며 로그를 채우는 것을 막는다.
      // 10초를 못 넘기고 죽으면 실패로 보고, 5번이면 포기한다.
      min_uptime: 10000,
      max_restarts: 5,
      error_file: 'logs/web-error.log',
      out_file: 'logs/web-out.log',
      time_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
