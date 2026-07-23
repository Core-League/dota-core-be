#!/usr/bin/env bash
# fix-staging-table-ownership.sh
# Run on the staging server as a user with sudo access.
# Transfers ownership of tables that staging_user must ALTER for migration
# TeamDeleteSetNullMatchFks1779640000000.

set -euo pipefail

DB_NAME="staging_db"
DB_USER="staging_user"

echo "Fixing table ownership in ${DB_NAME} → ${DB_USER}"

sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL
-- Tables altered by TeamDeleteSetNullMatchFks1779640000000
ALTER TABLE IF EXISTS qualification_match OWNER TO ${DB_USER};
ALTER TABLE IF EXISTS playoff_match       OWNER TO ${DB_USER};
ALTER TABLE IF EXISTS "match"             OWNER TO ${DB_USER};

-- Verify
SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('qualification_match', 'playoff_match', 'match')
ORDER BY tablename;
SQL

echo "Done. Restart pm2 to retry the migration:"
echo "  pm2 restart core-backend-staging"
