module.exports = {
  apps: [
    {
      name: 'core-backend',
      script: 'dist/main.js',
      cwd: '/home/apps/dota-core-be',
      env: {
        NODE_ENV: 'staging',
        PORT: '3000',
        DB_HOST: '127.0.0.1',
        DB_PORT: '5432',
        DB_USER: 'stage_user',
        DB_PASS: 'strong_password_here',
        DB_NAME: 'stage_db',
      },
    },
  ],
};
