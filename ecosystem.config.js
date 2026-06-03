module.exports = {
  apps: [
    {
      name: 'core-backend',
      script: 'dist/entry-points/http/api-v1/main.js',
      cwd: '/home/ubuntu/apps/dota-core-be',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        DB_HOST: '127.0.0.1',
        DB_PORT: '5432',
        DB_USER: 'stage_user',
        DB_PASS: 'strong_password_here',
        DB_NAME: 'stage_db',
      },
    },
    {
      name: 'core-backend-staging',
      script: 'dist/entry-points/http/api-v1/main.js',
      cwd: '/home/ubuntu/apps/dota-core-be-staging',
      env: {
        NODE_ENV: 'staging',
        PORT: '3001',
        DB_HOST: '127.0.0.1',
        DB_PORT: '5432',
        DB_USER: 'staging_user',
        DB_PASS: 'strong_password_staging',
        DB_NAME: 'staging_db',
      },
    },
    // ── v2 (layered app) ─ same build/dist as v1, same DB, separate
    //    process/port. Route the v2 subdomain to these ports in the reverse
    //    proxy. v1 owns the schema; v2 is a non-migrating client.
    {
      name: 'core-backend-v2',
      script: 'dist/entry-points/http/api-v2/main.js',
      cwd: '/home/ubuntu/apps/dota-core-be',
      env: {
        NODE_ENV: 'production',
        PORT: '3010',
        DB_HOST: '193.169.241.19',
        DB_PORT: '5432',
        DB_USER: 'stage_user',
        DB_PASS: 'strong_password_here',
        DB_NAME: 'stage_db',
      },
    },
    {
      name: 'core-backend-v2-staging',
      script: 'dist/entry-points/http/api-v2/main.js',
      cwd: '/home/ubuntu/apps/dota-core-be-staging',
      env: {
        NODE_ENV: 'staging',
        PORT: '3011',
        DB_HOST: '127.0.0.1',
        DB_PORT: '5432',
        DB_USER: 'staging_user',
        DB_PASS: 'strong_password_staging',
        DB_NAME: 'staging_db',
      },
    },
  ],
};
