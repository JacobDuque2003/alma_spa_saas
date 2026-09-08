const ExcelJS = require('exceljs');
const prisma = require('../utils/prisma');
const { normalizePhone, isValidE164 } = require('../utils/phone');
const { BadRequestError } = require('../utils/errors');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_HEADER_SCAN_ROWS = 20;
const FIELD_ALIASES = {
  fullName: ['nombre', 'nombres', 'cliente', 'clienta', 'nombre completo', 'full name'],
  whatsapp: ['whatsapp', 'celular', 'telefono', 'teléfono', 'movil', 'móvil', 'phone'],
  cedula: ['cedula', 'cédula', 'identificacion', 'identificación', 'dni'],
  address: ['direccion', 'dirección', 'domicilio', 'address'],
  email: ['correo', 'email', 'e-mail'],
  birthday: ['cumpleanos', 'cumpleaños', 'fecha nacimiento', 'fecha de nacimiento', 'birthday'],
  recordNumber: ['ficha', 'n ficha', 'n° ficha', 'numero ficha', 'número ficha', 'record number'],
};
const SPANISH_MONTHS = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function headerKey(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function dateIso(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Los cumpleaños históricos como "12 DE MAYO" se anclan a 2026 solo
// internamente. El flag evita mostrar ese año o una edad falsa.
function parseBirthday(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const birthday = dateIso(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
    return birthday ? { birthday, birthdayYearKnown: true } : null;
  }
  const text = clean(value);
  if (!text) return null;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) {
    const birthday = dateIso(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return birthday ? { birthday, birthdayYearKnown: true } : null;
  }
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (ymd) {
    const birthday = dateIso(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return birthday ? { birthday, birthdayYearKnown: true } : null;
  }
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dayMonth = /^(\d{1,2})\s*(?:de\s*)?([a-z]+)$/.exec(normalized);
  if (!dayMonth || SPANISH_MONTHS[dayMonth[2]] === undefined) return null;
  const birthday = dateIso(2026, SPANISH_MONTHS[dayMonth[2]], Number(dayMonth[1]));
  return birthday ? { birthday, birthdayYearKnown: false } : null;
}

function cellText(cell) {
  if (cell.value instanceof Date) return cell.value;
  return clean(cell.text || cell.value);
}

function fieldCandidates(headers, field) {
  const aliases = FIELD_ALIASES[field];
  return headers.reduce((matches, header, index) => {
    if (aliases.some((alias) => headerKey(header) === headerKey(alias))) matches.push(index);
    return matches;
  }, []);
}

function scoreColumn(sheet, headerRowNumber, columnIndex, field) {
  let score = 0;
  for (let rowNumber = headerRowNumber + 1; rowNumber <= Math.min(sheet.rowCount, headerRowNumber + MAX_ROWS); rowNumber += 1) {
    const raw = cellText(sheet.getRow(rowNumber).getCell(columnIndex + 1));
    const value = clean(raw);
    if (!value) continue;
    if (field === 'whatsapp') score += isValidE164(normalizePhone(value)) ? 3 : 1;
    else if (field === 'birthday') score += parseBirthday(raw) ? 2 : 1;
    else score += 1;
  }
  return score;
}

function mappingForHeaderRow(sheet, headerRowNumber) {
  const headers = Array.from({ length: Math.min(sheet.columnCount, 30) }, (_, index) => cellText(sheet.getRow(headerRowNumber).getCell(index + 1)));
  const mapping = {};
  for (const field of Object.keys(FIELD_ALIASES)) {
    const candidates = fieldCandidates(headers, field);
    if (!candidates.length) continue;
    mapping[field] = candidates.sort((a, b) => scoreColumn(sheet, headerRowNumber, b, field) - scoreColumn(sheet, headerRowNumber, a, field))[0];
  }
  return { headers, mapping };
}

function detectHeaders(sheet) {
  let best = null;
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, MAX_HEADER_SCAN_ROWS); rowNumber += 1) {
    const candidate = mappingForHeaderRow(sheet, rowNumber);
    const score = Number(candidate.mapping.fullName !== undefined) + Number(candidate.mapping.recordNumber !== undefined) + Number(candidate.mapping.whatsapp !== undefined);
    if (!best || score > best.score) best = { ...candidate, rowNumber, score };
  }
  if (!best || best.mapping.fullName === undefined || best.mapping.recordNumber === undefined) {
    throw new BadRequestError('No encontré las columnas de Nombre/Cliente y Ficha. Revise los encabezados del archivo');
  }
  return best;
}

function normalizeRow(worksheetRow, mapping) {
  const value = (field) => mapping[field] === undefined ? '' : clean(cellText(worksheetRow.getCell(mapping[field] + 1)));
  const birthdayInput = mapping.birthday === undefined ? '' : cellText(worksheetRow.getCell(mapping.birthday + 1));
  const parsedBirthday = mapping.birthday === undefined ? null : parseBirthday(birthdayInput);
  const rawPhone = value('whatsapp');
  const normalizedPhone = rawPhone && isValidE164(normalizePhone(rawPhone)) ? normalizePhone(rawPhone) : null;
  return {
    fullName: value('fullName'), whatsapp: rawPhone, normalizedPhone,
    cedula: value('cedula'), address: value('address'), email: value('email').toLowerCase(),
    birthday: parsedBirthday?.birthday || null,
    birthdayInput: clean(birthdayInput),
    birthdayYearKnown: parsedBirthday?.birthdayYearKnown ?? true,
    recordNumber: value('recordNumber'),
  };
}

function rowIssues(row) {
  const issues = [];
  if (!row.fullName) issues.push('Falta nombre');
  if (!row.recordNumber) issues.push('Falta ficha');
  if (row.whatsapp && !row.normalizedPhone) issues.push('Celular inválido');
  if (!row.whatsapp) issues.push('Sin celular');
  if (!row.cedula) issues.push('Sin cédula');
  if (!row.birthday) issues.push(row.birthdayInput ? 'Cumpleaños inválido' : 'Sin cumpleaños');
  if (!row.address) issues.push('Sin dirección');
  if (!row.email) issues.push('Sin correo');
  return issues;
}

function blockingIssues(row) {
  return row.issues.filter((issue) => issue === 'Falta nombre' || issue === 'Falta ficha' || issue === 'Ficha duplicada en el archivo');
}

function enrichDuplicateIssues(rows) {
  const byFicha = new Map();
  const byPhone = new Map();
  for (const row of rows) {
    if (row.recordNumber) byFicha.set(row.recordNumber, [...(byFicha.get(row.recordNumber) || []), row]);
    if (row.normalizedPhone) byPhone.set(row.normalizedPhone, [...(byPhone.get(row.normalizedPhone) || []), row]);
  }
  for (const group of byFicha.values()) if (group.length > 1) group.forEach((row) => row.issues.push('Ficha duplicada en el archivo'));
  for (const group of byPhone.values()) if (group.length > 1) group.forEach((row) => {
    row.issues.push('Celular repetido en el archivo');
    row.normalizedPhone = null;
  });
}

async function decodeWorkbook(dataUrl) {
  const match = /^data:application\/(?:vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-excel);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new BadRequestError('Archivo Excel inválido. Selecciona un archivo .xlsx válido');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new BadRequestError('El archivo debe tener un máximo de 5 MB');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations', 'extLst'] });
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestError('El archivo no contiene una hoja');
  const { headers, mapping, rowNumber: headerRowNumber } = detectHeaders(sheet);
  const rows = [];
  const lastRow = Math.min(sheet.rowCount, headerRowNumber + MAX_ROWS);
  for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRow; rowNumber += 1) {
    const worksheetRow = sheet.getRow(rowNumber);
    const raw = Array.from({ length: headers.length }, (_, index) => clean(cellText(worksheetRow.getCell(index + 1))));
    if (raw.every((value) => !value)) continue;
    const row = normalizeRow(worksheetRow, mapping);
    rows.push({ rowNumber, ...row, issues: rowIssues(row) });
  }
  enrichDuplicateIssues(rows);
  return { headers, mapping, headerRowNumber, rows, truncated: sheet.rowCount > lastRow };
}

async function previewImport(_actor, dataUrl) {
  const parsed = await decodeWorkbook(dataUrl);
  const readyRows = parsed.rows.filter((row) => blockingIssues(row).length === 0);
  const completeRows = readyRows.filter((row) => row.address && row.cedula && row.email && row.birthday && row.normalizedPhone);
  return {
    headers: parsed.headers, headerRowNumber: parsed.headerRowNumber, recognized: Object.keys(parsed.mapping),
    rows: parsed.rows.slice(0, 30).map((row) => ({ ...row, blocking: blockingIssues(row).length > 0 })),
    totalRows: parsed.rows.length, validRows: readyRows.length, completeRows: completeRows.length,
    incompleteRows: readyRows.length - completeRows.length, invalidRows: parsed.rows.length - readyRows.length,
    warningRows: readyRows.filter((row) => row.issues.length > 0).length, truncated: parsed.truncated,
  };
}

function importData(row) {
  return {
    fullName: row.fullName, whatsapp: row.normalizedPhone, recordNumber: row.recordNumber,
    ...(row.email ? { email: row.email } : {}), ...(row.address ? { address: row.address } : {}), ...(row.cedula ? { cedula: row.cedula } : {}),
    ...(row.birthday ? { birthday: new Date(`${row.birthday}T00:00:00.000Z`), birthdayYearKnown: row.birthdayYearKnown } : {}),
  };
}

async function importClients(actor, dataUrl) {
  if (!actor?.tenantId) throw new BadRequestError('Tenant requerido para importar clientes');
  const parsed = await decodeWorkbook(dataUrl);
  const result = { created: 0, completed: 0, skipped: 0, errors: [], warnings: [] };
  const fichaValues = parsed.rows.map((row) => row.recordNumber).filter(Boolean);
  const phoneValues = parsed.rows.map((row) => row.normalizedPhone).filter(Boolean);
  // Cargamos las fichas existentes una sola vez. Evita 950 viajes de red y
  // hace que la importación sea suficientemente rápida para producción.
  const existingRows = await prisma.client.findMany({
    where: {
      tenantId: actor.tenantId,
      OR: [
        ...(fichaValues.length ? [{ recordNumber: { in: fichaValues } }] : []),
        ...(phoneValues.length ? [{ whatsapp: { in: phoneValues } }] : []),
      ],
    },
    select: { id: true, recordNumber: true, whatsapp: true, fullName: true, email: true, address: true, cedula: true, birthday: true, birthdayYearKnown: true },
  });
  const byFicha = new Map(existingRows.filter((client) => client.recordNumber).map((client) => [client.recordNumber, client]));
  const byPhone = new Map(existingRows.filter((client) => client.whatsapp).map((client) => [client.whatsapp, client]));
  const creates = [];
  const updates = [];
  const pendingFichas = new Set(byFicha.keys());
  const pendingPhones = new Set(byPhone.keys());
  for (const row of parsed.rows) {
    const blocks = blockingIssues(row);
    if (blocks.length) {
      result.skipped += 1;
      result.errors.push({ rowNumber: row.rowNumber, recordNumber: row.recordNumber || null, issues: blocks });
      continue;
    }
    if (row.issues.length) result.warnings.push({ rowNumber: row.rowNumber, recordNumber: row.recordNumber, issues: row.issues });
    const incoming = importData(row);
    try {
      const fichaClient = byFicha.get(incoming.recordNumber);
      const phoneClient = incoming.whatsapp ? byPhone.get(incoming.whatsapp) : null;
      if (fichaClient && phoneClient && fichaClient.id !== phoneClient.id) throw new BadRequestError('La ficha y el celular pertenecen a clientas distintas');
      const existing = fichaClient || phoneClient;
      if (!existing) {
        if (pendingFichas.has(incoming.recordNumber) || (incoming.whatsapp && pendingPhones.has(incoming.whatsapp))) {
          throw new BadRequestError('La ficha o el celular se repite durante la importación');
        }
        creates.push({ tenantId: actor.tenantId, ...incoming });
        pendingFichas.add(incoming.recordNumber);
        if (incoming.whatsapp) pendingPhones.add(incoming.whatsapp);
        continue;
      }
      const fill = {};
      for (const [key, value] of Object.entries(incoming)) {
        if (key === 'recordNumber' || key === 'birthdayYearKnown' || !value || existing[key]) continue;
        fill[key] = value;
        if (key === 'birthday') fill.birthdayYearKnown = incoming.birthdayYearKnown;
      }
      if (Object.keys(fill).length) updates.push({ id: existing.id, data: fill });
      else result.skipped += 1;
    } catch (err) {
      result.skipped += 1;
      result.errors.push({ rowNumber: row.rowNumber, recordNumber: row.recordNumber, issues: ['No se pudo guardar: ' + (err.code === 'P2002' ? 'dato duplicado' : err.message)] });
    }
  }
  try {
    if (creates.length) {
      // Si otra ficha se creó entre la vista previa y esta acción, la dejamos
      // intacta y reportamos la omisión; nunca abortamos las demás 900+ fichas.
      const created = await prisma.client.createMany({ data: creates, skipDuplicates: true });
      result.created += created.count;
      if (created.count < creates.length) {
        const importedRows = await prisma.client.findMany({
          where: { tenantId: actor.tenantId, recordNumber: { in: creates.map((row) => row.recordNumber) } },
          select: { recordNumber: true },
        });
        const importedFichas = new Set(importedRows.map((row) => row.recordNumber));
        for (const row of creates) {
          if (!importedFichas.has(row.recordNumber)) {
            result.skipped += 1;
            result.errors.push({ recordNumber: row.recordNumber, issues: ['No se pudo importar porque ya existe un dato único con esa ficha o celular'] });
          }
        }
      }
    }
    if (updates.length) {
      await prisma.$transaction(updates.map((update) => prisma.client.update({ where: { id: update.id }, data: update.data })));
      result.completed += updates.length;
    }
  } catch (err) {
    const duplicateTarget = Array.isArray(err.meta?.target) ? ` (${err.meta.target.join(', ')})` : '';
    throw new BadRequestError(`No se pudo completar la importación: ${err.code === 'P2002' ? `hay una ficha o celular duplicado${duplicateTarget}` : err.message}`);
  }
  return result;
}

module.exports = { previewImport, importClients, decodeWorkbook, parseBirthday, detectHeaders, blockingIssues };
