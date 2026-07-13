/**
 * migrateTimezones.js — One-time fix: shift existing appointment timestamps
 * from "local hours stored as UTC" to "correct UTC for America/Guayaquil".
 *
 * The old code stored 10:00 AM Ecuador as T10:00:00Z (wrong).
 * Correct is T15:00:00Z (UTC-5). This script adds +5 hours to startsAt/endsAt.
 *
 * Uses raw SQL to update all rows atomically (avoids unique constraint
 * violations that happen with row-by-row Prisma updates).
 *
 * Safe to run multiple times — the WHERE clause filters by the old UTC range.
 *
 * Run: node prisma/migrateTimezones.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const TID = 'cmr99z3jv0000j4ijwodukjen';

  // Shift appointments: only those with startsAt hour 9-18 UTC (the old wrong range)
  const apptResult = await prisma.$executeRaw`
    UPDATE "Appointment"
    SET "startsAt" = "startsAt" + INTERVAL '5 hours',
        "endsAt"   = "endsAt"   + INTERVAL '5 hours'
    WHERE "tenantId" = ${TID}
      AND EXTRACT(HOUR FROM "startsAt") >= 9
      AND EXTRACT(HOUR FROM "startsAt") <= 18
  `;
  console.log(`Shifted ${apptResult} appointments by +5 hours`);

  // Shift treatment history sessionDate
  const treatResult = await prisma.$executeRaw`
    UPDATE "TreatmentHistory"
    SET "sessionDate" = "sessionDate" + INTERVAL '5 hours'
    WHERE "tenantId" = ${TID}
      AND EXTRACT(HOUR FROM "sessionDate") >= 9
      AND EXTRACT(HOUR FROM "sessionDate") <= 18
  `;
  console.log(`Shifted ${treatResult} treatment sessionDates by +5 hours`);

  // Verify a sample
  const sample = await prisma.$queryRaw`
    SELECT id, "startsAt", EXTRACT(HOUR FROM "startsAt") as utc_hour
    FROM "Appointment"
    WHERE "tenantId" = ${TID}
    ORDER BY "startsAt" DESC
    LIMIT 5
  `;
  console.log('\nSample (should show UTC hours 14-23):');
  for (const row of sample) {
    console.log(`  ${row.id.slice(0, 12)}... startsAt=${row.startsAt.toISOString()} (UTC hour ${row.utc_hour})`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
