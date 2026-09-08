const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { previewImport, parseBirthday } = require('./clientImportService');

async function workbookDataUrl() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Clientas');
  sheet.getRow(3).values = ['CLIENTE', 'CELULAR', 'FICHA', 'CUMPLEAÑOS', 'CELULAR'];
  sheet.getRow(4).values = ['Ana Andrade', '', 'F-001', '6 DE MAYO', '0998765432'];
  sheet.getRow(5).values = ['Beatriz Ruiz', '', 'F-002', '20 DOCOEMBRE', ''];
  const buffer = await book.xlsx.writeBuffer();
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(buffer).toString('base64')}`;
}

test('importación detecta encabezados fuera de la fila 1 y prioriza la columna celular útil', async () => {
  const preview = await previewImport({}, await workbookDataUrl());
  assert.equal(preview.headerRowNumber, 3);
  assert.equal(preview.totalRows, 2);
  assert.equal(preview.validRows, 2, 'un celular faltante no bloquea la ficha');
  assert.equal(preview.rows[0].whatsapp, '0998765432');
  assert.equal(preview.rows[0].birthday, '2026-05-06');
  assert.equal(preview.rows[0].birthdayYearKnown, false);
  assert.ok(preview.rows[1].issues.includes('Cumpleaños inválido'));
  assert.ok(preview.rows[1].issues.includes('Sin celular'));
});

test('parseBirthday distingue fecha completa de día y mes histórico', () => {
  assert.deepEqual(parseBirthday('21/10/1992'), { birthday: '1992-10-21', birthdayYearKnown: true });
  assert.deepEqual(parseBirthday('19ENERO'), { birthday: '2026-01-19', birthdayYearKnown: false });
  assert.equal(parseBirthday('221 DICIEMBRE'), null);
});
