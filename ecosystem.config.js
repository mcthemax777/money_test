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
      script: 'node_modules/.bin/next',
      args: 'start',
      instances: 1,
      exec_mode: 'cluster',
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
