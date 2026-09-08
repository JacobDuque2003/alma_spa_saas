import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const require = createRequire(import.meta.url);
const { decodeWorkbook } = require('../../src/services/clientImportService');

const sourcePath = process.env.CLIENT_IMPORT_FILE;
const outputPath = process.env.CLIENT_REPORT_OUTPUT;
if (!sourcePath || !outputPath) throw new Error('CLIENT_IMPORT_FILE y CLIENT_REPORT_OUTPUT son requeridos');

const fileData = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${(await fs.readFile(sourcePath)).toString('base64')}`;
const parsed = await decodeWorkbook(fileData);
const clientRows = parsed.rows.filter((row) => row.fullName);
const issueCounts = new Map();
for (const row of clientRows) for (const issue of row.issues) issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);

function birthdayLabel(row) {
  if (!row.birthday) return row.birthdayInput || '—';
  const [, month, day] = row.birthday.split('-');
  const date = new Date(Date.UTC(2026, Number(month) - 1, Number(day)));
  const label = date.toLocaleDateString('es-EC', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return row.birthdayYearKnown ? row.birthday : `${label} (año pendiente)`;
}

const font = 'Arial';
const ink = '#463A2F';
const brown = '#75573B';
const beige = '#F7F1EA';
const amber = '#F5E7BD';
const border = '#DECFC0';
const workbook = Workbook.create();

const summary = workbook.worksheets.add('Resumen');
summary.showGridLines = false;
summary.getRange('A1:G1').merge();
summary.getRange('A1').values = [['Inconsistencias de fichas de clientas']];
summary.getRange('A1').format = { font: { name: font, size: 16, bold: true, color: ink }, verticalAlignment: 'center' };
summary.getRange('A2:G2').merge();
summary.getRange('A2').values = [['Fuente: Libro1.xlsx · Hoja1 · Importación de septiembre de 2026']];
summary.getRange('A2').format = { font: { name: font, size: 10, italic: true, color: brown } };
summary.getRange('A4:B4').values = [['Concepto', 'Cantidad']];
const observedClients = clientRows.filter((row) => row.issues.length > 0).length;
const metrics = [
  ['Fichas importadas', clientRows.length],
  ['Fichas con al menos una observación', observedClients],
  ['Filas omitidas por no tener nombre', parsed.rows.filter((row) => !row.fullName).length],
  ['Sin cumpleaños', issueCounts.get('Sin cumpleaños') || 0],
  ['Cumpleaños inválido', issueCounts.get('Cumpleaños inválido') || 0],
  ['Cumpleaños con año pendiente', clientRows.filter((row) => row.birthday && !row.birthdayYearKnown).length],
  ['Sin cédula', issueCounts.get('Sin cédula') || 0],
  ['Sin celular', issueCounts.get('Sin celular') || 0],
  ['Celular inválido o repetido', (issueCounts.get('Celular inválido') || 0) + (issueCounts.get('Celular repetido en el archivo') || 0)],
  ['Sin dirección', issueCounts.get('Sin dirección') || 0],
  ['Sin correo', issueCounts.get('Sin correo') || 0],
];
summary.getRange(`A5:B${4 + metrics.length}`).values = metrics;
summary.getRange('D4:G4').merge();
summary.getRange('D4').values = [['Criterio usado durante la importación']];
summary.getRange('D5:G8').values = [
  ['La ficha identifica a cada clienta y no se repite.', null, null, null],
  ['Las fichas sin celular se conservaron sin inventar números.', null, null, null],
  ['Día y mes de cumpleaños se guardan; el año queda pendiente de confirmar.', null, null, null],
  ['Los celulares repetidos no se asignaron automáticamente a una ficha.', null, null, null],
];
summary.getRange('D5:G8').format.wrapText = true;
summary.getRange('A4:B4').format = { fill: brown, font: { name: font, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center' };
summary.getRange('D4:G4').format = { fill: brown, font: { name: font, bold: true, color: '#FFFFFF' } };
summary.getRange(`A4:B${4 + metrics.length}`).format.borders = { preset: 'all', style: 'thin', color: border };
summary.getRange('D4:G8').format.borders = { preset: 'all', style: 'thin', color: border };
summary.getRange('A5:A15').format.font = { name: font, color: ink };
summary.getRange('B5:B15').format = { font: { name: font, bold: true, color: ink }, horizontalAlignment: 'right', numberFormat: '#,##0' };
summary.getRange('D5:G8').format.font = { name: font, size: 10, color: ink };
summary.getRange('D5:G8').format.fill = beige;
summary.getRange('A1:G1').format.rowHeight = 28;
summary.getRange('A1:G15').format.font = { name: font, size: 10, color: ink };
summary.getRange('A:A').format.columnWidth = 38;
summary.getRange('B:B').format.columnWidth = 14;
summary.getRange('C:C').format.columnWidth = 4;
summary.getRange('D:G').format.columnWidth = 18;
summary.getRange('D5:G8').format.rowHeight = 52;

const details = workbook.worksheets.add('Para completar');
details.showGridLines = false;
details.getRange('A1:J1').merge();
details.getRange('A1').values = [['Fichas con información por completar']];
details.getRange('A1').format = { font: { name: font, size: 15, bold: true, color: ink } };
details.getRange('A2:J2').merge();
details.getRange('A2').values = [['Incluye solo las clientas con nombre. Las 11 filas sin nombre están en la pestaña siguiente.']];
details.getRange('A2').format = { font: { name: font, size: 10, italic: true, color: brown } };
const headers = ['Ficha', 'Clienta', 'Fila origen', 'Celular', 'Cumpleaños', 'Cédula', 'Dirección', 'Correo', 'Observaciones', 'Estado de cumpleaños'];
details.getRange('A4:J4').values = [headers];
const observed = clientRows.filter((row) => row.issues.length > 0).map((row) => [
  row.recordNumber, row.fullName, row.rowNumber, row.whatsapp || '—', birthdayLabel(row), row.cedula || '—', row.address || '—', row.email || '—', row.issues.join(' · '), row.birthday && !row.birthdayYearKnown ? 'Año pendiente' : row.birthday ? 'Completo' : 'Sin fecha',
]);
details.getRange(`A5:J${4 + observed.length}`).values = observed;
details.getRange('A4:J4').format = { fill: brown, font: { name: font, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
details.getRange(`A4:J${4 + observed.length}`).format.borders = { preset: 'insideHorizontal', style: 'thin', color: '#E8DED3' };
details.getRange(`A5:J${4 + observed.length}`).format = { font: { name: font, size: 10, color: ink }, verticalAlignment: 'center', wrapText: true };
details.getRange(`I5:I${4 + observed.length}`).format.fill = amber;
details.getRange(`J5:J${4 + observed.length}`).format.fill = beige;
details.getRange('A:A').format.columnWidth = 10;
details.getRange('B:B').format.columnWidth = 29;
details.getRange('C:C').format.columnWidth = 11;
details.getRange('D:D').format.columnWidth = 17;
details.getRange('E:E').format.columnWidth = 22;
details.getRange('F:F').format.columnWidth = 16;
details.getRange('G:G').format.columnWidth = 35;
details.getRange('H:H').format.columnWidth = 31;
details.getRange('I:I').format.columnWidth = 45;
details.getRange('J:J').format.columnWidth = 20;
details.getRange(`A4:J${4 + observed.length}`).format.rowHeight = 32;
details.freezePanes.freezeRows(4);

const unnamed = workbook.worksheets.add('Filas sin nombre');
unnamed.showGridLines = false;
unnamed.getRange('A1:D1').merge();
unnamed.getRange('A1').values = [['Filas no importadas por falta de nombre']];
unnamed.getRange('A1').format = { font: { name: font, size: 15, bold: true, color: ink } };
unnamed.getRange('A2:D2').merge();
unnamed.getRange('A2').values = [['Estas filas tenían ficha u otros datos, pero no un nombre de clienta para asociarlos con seguridad.']];
unnamed.getRange('A2').format = { font: { name: font, size: 10, italic: true, color: brown } };
unnamed.getRange('A4:D4').values = [['Fila origen', 'Ficha', 'Celular', 'Datos disponibles']];
const unnamedRows = parsed.rows.filter((row) => !row.fullName).map((row) => [row.rowNumber, row.recordNumber || '—', row.whatsapp || '—', [row.cedula && 'Cédula', row.address && 'Dirección', row.email && 'Correo', row.birthdayInput && 'Cumpleaños'].filter(Boolean).join(', ') || '—']);
unnamed.getRange(`A5:D${4 + unnamedRows.length}`).values = unnamedRows;
unnamed.getRange('A4:D4').format = { fill: brown, font: { name: font, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center' };
unnamed.getRange(`A4:D${4 + unnamedRows.length}`).format.borders = { preset: 'all', style: 'thin', color: border };
unnamed.getRange(`A5:D${4 + unnamedRows.length}`).format = { font: { name: font, size: 10, color: ink }, verticalAlignment: 'center' };
unnamed.getRange('A:D').format.columnWidth = 22;
unnamed.freezePanes.freezeRows(4);

const outputDir = outputPath.slice(0, Math.max(outputPath.lastIndexOf('/'), outputPath.lastIndexOf('\\')));
await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const compact = await workbook.inspect({ kind: 'table', range: 'Resumen!A1:G15', include: 'values,formulas', tableMaxRows: 15, tableMaxCols: 7 });
console.log(compact.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 20 }, summary: 'final formula error scan' });
console.log(errors.ndjson);
const render = await workbook.render({ sheetName: 'Resumen', range: 'A1:G15', scale: 1.4, format: 'png' });
await fs.writeFile(outputPath.replace(/\.xlsx$/i, '.png'), new Uint8Array(await render.arrayBuffer()));
const detailsRender = await workbook.render({ sheetName: 'Para completar', range: 'A1:J14', scale: 1.1, format: 'png' });
await fs.writeFile(outputPath.replace(/\.xlsx$/i, '-para-completar.png'), new Uint8Array(await detailsRender.arrayBuffer()));
const unnamedRender = await workbook.render({ sheetName: 'Filas sin nombre', range: 'A1:D15', scale: 1.2, format: 'png' });
await fs.writeFile(outputPath.replace(/\.xlsx$/i, '-filas-sin-nombre.png'), new Uint8Array(await unnamedRender.arrayBuffer()));
