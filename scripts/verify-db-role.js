#!/usr/bin/env node
// ============================================================================
// verify-db-role.js — verifica privilegios del rol alma_app
//
// Ejecutar después de aplicar docs/append-only-audit-grant.sql.
// Conecta usando DATABASE_URL — apuntar al rol alma_app para verificar.
//
// Usage: npm run db:verify-role
// ============================================================================

require('dotenv').config();
const { PrismaClient, Prisma } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    const [{ current_user: currentUser }] = await prisma.$queryRaw`SELECT current_user`;
    console.log(`Connected as: ${currentUser}`);

    if (currentUser === 'postgres') {
      console.log(
        '\n[WARNING] Connected as postgres (superuser). ' +
        'Privilege checks are meaningless for superusers -- they bypass all GRANT/REVOKE.\n' +
        'To verify alma_app privileges, set DATABASE_URL to use the alma_app role.\n'
      );
      process.exit(1);
    }

    const privileges = await prisma.$queryRaw`
      SELECT table_name::text, string_agg(privilege_type::text, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE grantee = current_user
        AND table_schema = 'public'
      GROUP BY table_name
      ORDER BY table_name
    `;

    console.log('\n--- Table Privileges ---');
    let auditOk = false;
    let migrationTableBlocked = false;
    let allTablesHaveDml = true;

    for (const row of privileges) {
      const name = row.table_name;
      const privs = row.privileges.split(',');
      const privsStr = privs.join(', ');

      if (name === 'ClientIntakeAuditLog') {
        const hasUpdate = privs.includes('UPDATE');
        const hasDelete = privs.includes('DELETE');
        const hasSelect = privs.includes('SELECT');
        const hasInsert = privs.includes('INSERT');

        if (!hasUpdate && !hasDelete && hasSelect && hasInsert) {
          console.log(`  ${name}: ${privsStr}  [OK - append-only]`);
          auditOk = true;
        } else {
          console.log(`  ${name}: ${privsStr}  [FAIL - should be SELECT, INSERT only]`);
        }
      } else if (name === '_prisma_migrations') {
        console.log(`  ${name}: ${privsStr}  [WARN - should have no access]`);
      } else {
        const hasFull = privs.includes('SELECT') && privs.includes('INSERT') &&
                        privs.includes('UPDATE') && privs.includes('DELETE');
        if (!hasFull) {
          console.log(`  ${name}: ${privsStr}  [FAIL - missing DML privileges]`);
          allTablesHaveDml = false;
        } else {
          console.log(`  ${name}: ${privsStr}  [OK]`);
        }
      }
    }

    const migrationEntry = privileges.find(r => r.table_name === '_prisma_migrations');
    if (!migrationEntry) {
      console.log('  _prisma_migrations: (no access)  [OK - blocked]');
      migrationTableBlocked = true;
    }

    const canCreate = await prisma.$queryRaw`
      SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create
    `;
    const createBlocked = !canCreate[0].can_create;
    console.log(`\n  Schema CREATE privilege: ${createBlocked ? 'DENIED [OK]' : 'GRANTED [FAIL - alma_app should not have CREATE]'}`);

    console.log('\n--- Summary ---');
    const checks = [
      { name: 'Connected as non-superuser', ok: currentUser !== 'postgres' },
      { name: 'ClientIntakeAuditLog is append-only', ok: auditOk },
      { name: '_prisma_migrations blocked', ok: migrationTableBlocked },
      { name: 'All other tables have full DML', ok: allTablesHaveDml },
      { name: 'Schema CREATE denied', ok: createBlocked },
    ];

    let allPassed = true;
    for (const check of checks) {
      const status = check.ok ? 'PASS' : 'FAIL';
      if (!check.ok) allPassed = false;
      console.log(`  [${status}] ${check.name}`);
    }

    console.log(allPassed ? '\nAll checks passed.' : '\nSome checks failed. Review the output above.');
    process.exit(allPassed ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});
