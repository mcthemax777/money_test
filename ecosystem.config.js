module.exports = {
  apps: [
    {
      name: 'money-api',
      cwd: './packages/api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      error_file: 'logs/api-error.log',
      out_file: 'logs/api-out.log',
      log_file: 'logs/api-combined.log',
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
      error_file: 'logs/web-error.log',
      out_file: 'logs/web-out.log',
      log_file: 'logs/web-combined.log',
      time_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
