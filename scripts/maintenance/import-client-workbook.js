/*
 * Importación controlada de fichas históricas.
 * Uso:
 *   $env:CLIENT_IMPORT_FILE='C:\ruta\clientas.xlsx'; node scripts/maintenance/import-client-workbook.js --confirm
 * Por seguridad, sin --confirm solo muestra la vista previa y no modifica nada.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const prisma = require('../../src/utils/prisma');
const { previewImport, importClients } = require('../../src/services/clientImportService');

async function main() {
  const source = process.env.CLIENT_IMPORT_FILE;
  if (!source) throw new Error('CLIENT_IMPORT_FILE es requerido');
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error('No encontré el archivo indicado');
  const tenant = await prisma.tenant.findUnique({
    where: { slug: process.env.CLIENT_IMPORT_TENANT || 'alma-spa' },
    select: { id: true, slug: true, _count: { select: { clients: true } } },
  });
  if (!tenant) throw new Error('No encontré el tenant de la importación');
  const fileData = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${fs.readFileSync(resolved).toString('base64')}`;
  const actor = { tenantId: tenant.id, role: 'dueno' };
  const preview = await previewImport(actor, fileData);
  const summary = {
    tenant: tenant.slug, clientsBefore: tenant._count.clients,
    headerRow: preview.headerRowNumber, totalRows: preview.totalRows,
    readyRows: preview.validRows, blockedRows: preview.invalidRows,
    warningRows: preview.warningRows,
  };
  if (!process.argv.includes('--confirm')) {
    console.log(JSON.stringify({ mode: 'preview', ...summary }, null, 2));
    return;
  }
  const result = await importClients(actor, fileData);
  const clientsAfter = await prisma.client.count({ where: { tenantId: tenant.id } });
  console.log(JSON.stringify({ mode: 'imported', ...summary, clientsAfter, result }, null, 2));
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
