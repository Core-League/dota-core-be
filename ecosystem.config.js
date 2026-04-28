module.exports = {
  apps: [
    {
      name: 'core-backend',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/apps/dota-core-be',
      env: {
        NODE_ENV: 'staging',
        PORT: '3000',
        DB_HOST: '193.169.241.19',
        DB_PORT: '5432',
        DB_USER: 'stage_user',
        DB_PASS: 'strong_password_here',
        DB_NAME: 'stage_db',
      },
    },
    {
      name: 'core-backend-staging',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/apps/dota-core-be-staging',
      env: {
        NODE_ENV: 'staging',
        PORT: '3001',
        DB_HOST: '127.0.0.1',
        DB_PORT: '5432',
        DB_USER: 'staging_user',
        DB_PASS: 'change_me',
        DB_NAME: 'staging_db',
      },
    },
  ],
};
