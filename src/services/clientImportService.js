const ExcelJS = require('exceljs');
const prisma = require('../utils/prisma');
const { normalizePhone, isValidE164 } = require('../utils/phone');
const { BadRequestError } = require('../utils/errors');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const FIELD_ALIASES = {
  fullName: ['nombre', 'nombres', 'cliente', 'clienta', 'nombre completo', 'full name'],
  whatsapp: ['whatsapp', 'celular', 'telefono', 'teléfono', 'movil', 'móvil', 'phone'],
  cedula: ['cedula', 'cédula', 'identificacion', 'identificación', 'dni'],
  address: ['direccion', 'dirección', 'domicilio', 'address'],
  email: ['correo', 'email', 'e-mail'],
  birthday: ['cumpleanos', 'cumpleaños', 'fecha nacimiento', 'fecha de nacimiento', 'birthday'],
  recordNumber: ['ficha', 'n ficha', 'n° ficha', 'numero ficha', 'número ficha', 'record number'],
};

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function headerKey(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function fieldsFromHeaders(headers) {
  const result = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const index = headers.findIndex((header) => aliases.some((alias) => headerKey(header) === headerKey(alias)));
    if (index >= 0) result[field] = index;
  }
  return result;
}

function parseBirthday(value) {
  const text = clean(value);
  if (!text) return null;
  // En Ecuador las hojas suelen usar DD/MM/AAAA. Evitamos que Node lo
  // interprete como MM/DD/AAAA y cambie silenciosamente la fecha.
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) {
    const [, day, month, year] = dmy;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() === Number(year)
      && date.getUTCMonth() === Number(month) - 1
      && date.getUTCDate() === Number(day)) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function normalizeRow(row, mapping) {
  const value = (field) => mapping[field] === undefined ? '' : clean(row[mapping[field]]);
  return {
    fullName: value('fullName'),
    whatsapp: value('whatsapp'),
    cedula: value('cedula'),
    address: value('address'),
    email: value('email').toLowerCase(),
    birthday: parseBirthday(value('birthday')),
    recordNumber: value('recordNumber'),
  };
}

function rowIssues(row) {
  const issues = [];
  if (!row.fullName) issues.push('Falta nombre');
  if (!row.whatsapp) issues.push('Falta celular');
  else if (!isValidE164(normalizePhone(row.whatsapp))) issues.push('Celular inválido');
  return issues;
}

async function decodeWorkbook(dataUrl) {
  const match = /^data:application\/(?:vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-excel);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new BadRequestError('Archivo Excel inválido. Selecciona un archivo .xlsx válido');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
    throw new BadRequestError('El archivo debe tener un máximo de 5 MB');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations', 'extLst'] });
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestError('El archivo no contiene una hoja');
  const headerRow = sheet.getRow(1);
  const headers = Array.from({ length: Math.min(sheet.columnCount, 30) }, (_, index) => clean(headerRow.getCell(index + 1).text));
  const mapping = fieldsFromHeaders(headers);
  if (mapping.fullName === undefined || mapping.whatsapp === undefined) {
    throw new BadRequestError('No encontré las columnas de Nombre y WhatsApp/Celular');
  }
  const rows = [];
  for (let rowNumber = 2; rowNumber <= Math.min(sheet.rowCount, MAX_ROWS + 1); rowNumber += 1) {
    const worksheetRow = sheet.getRow(rowNumber);
    const raw = Array.from({ length: headers.length }, (_, index) => worksheetRow.getCell(index + 1).text);
    if (raw.every((value) => !clean(value))) continue;
    const row = normalizeRow(raw, mapping);
    rows.push({ rowNumber, ...row, issues: rowIssues(row) });
  }
  return { headers, mapping, rows, truncated: sheet.rowCount > MAX_ROWS + 1 };
}

async function previewImport(_actor, dataUrl) {
  const parsed = await decodeWorkbook(dataUrl);
  const validRows = parsed.rows.filter((row) => row.issues.length === 0);
  const completeRows = validRows.filter((row) => row.address && row.cedula);
  return {
    headers: parsed.headers,
    recognized: Object.keys(parsed.mapping),
    rows: parsed.rows.slice(0, 30),
    totalRows: parsed.rows.length,
    validRows: validRows.length,
    completeRows: completeRows.length,
    incompleteRows: validRows.length - completeRows.length,
    invalidRows: parsed.rows.length - validRows.length,
    truncated: parsed.truncated,
  };
}

function importData(row) {
  return {
    fullName: row.fullName,
    whatsapp: normalizePhone(row.whatsapp),
    ...(row.email ? { email: row.email } : {}),
    ...(row.address ? { address: row.address } : {}),
    ...(row.cedula ? { cedula: row.cedula } : {}),
    ...(row.birthday ? { birthday: new Date(`${row.birthday}T00:00:00.000Z`) } : {}),
    ...(row.recordNumber ? { recordNumber: row.recordNumber } : {}),
  };
}

async function importClients(actor, dataUrl) {
  if (!actor?.tenantId) throw new BadRequestError('Tenant requerido para importar clientes');
  const parsed = await decodeWorkbook(dataUrl);
  const result = { created: 0, completed: 0, skipped: 0, errors: [] };
  for (const row of parsed.rows) {
    if (row.issues.length) {
      result.skipped += 1;
      result.errors.push({ rowNumber: row.rowNumber, issues: row.issues });
      continue;
    }
    const incoming = importData(row);
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.client.findUnique({
          where: { tenantId_whatsapp: { tenantId: actor.tenantId, whatsapp: incoming.whatsapp } },
        });
        if (!existing) {
          await tx.client.create({ data: { tenantId: actor.tenantId, ...incoming } });
          result.created += 1;
          return;
        }
        // La importación enriquece una ficha existente: nunca borra ni pisa
        // datos que ya fueron verificados por recepción.
        const fill = Object.fromEntries(Object.entries(incoming).filter(([key, value]) => (
          key !== 'whatsapp' && value && !existing[key]
        )));
        if (Object.keys(fill).length) {
          await tx.client.update({ where: { id: existing.id }, data: fill });
          result.completed += 1;
        } else {
          result.skipped += 1;
        }
      });
    } catch (err) {
      result.skipped += 1;
      result.errors.push({ rowNumber: row.rowNumber, issues: ['No se pudo guardar: ' + (err.code === 'P2002' ? 'dato duplicado' : err.message)] });
    }
  }
  return result;
}

module.exports = { previewImport, importClients };
