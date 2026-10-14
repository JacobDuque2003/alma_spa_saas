const prisma = require('../../utils/prisma');
function firstName(value) { return String(value || '').trim().split(/\s+/)[0].slice(0, 60); }
function safeHistory(rows) {
  return (rows || []).filter((row) => row && typeof row.content === 'string'
    && !/\d{6,}|\b(cedula|cédula|direccion|dirección|cuenta bancaria|embaraz|cirug|alerg|diagnostic|medicament|enfermedad|anamnesis)\w*/i.test(row.content)).slice(-8);
}
async function loadCustomerContext(tenantId, client) {
  if (!client?.id || client.tenantId !== tenantId) return {};
  let lastServiceName;
  try {
    const last = await prisma.treatmentHistory.findFirst({ where: { tenantId, clientId: client.id,
      sessionDate: { lte: new Date() }, service: { is: { tenantId, active: true } } },
      orderBy: { sessionDate: 'desc' }, select: { service: { select: { name: true } } } });
    lastServiceName = last?.service?.name;
  } catch { /* Optional personalization must not interrupt a booking. */ }
  return { firstName: firstName(client.fullName), lastServiceName };
}
module.exports = { firstName, safeHistory, loadCustomerContext };
