function summarizeState(state = {}) {
  const flow = state.booking || state.reschedule || {};
  const fields = {
    servicio: flow.serviceName || state.serviceName,
    fecha: flow.date || flow.selectedDate,
    hora: flow.time || flow.timeSlot?.time,
    terapeuta: flow.staffName,
    nombre: String(flow.clientName || state.clientName || '').split(/\s+/)[0],
    trato: state.tone,
    paso: flow.step || state.flow,
    intencion: state.lastIntent,
  };
  return Object.entries(fields).filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => `${key}: ${value.replace(/[\r\n]/g, ' ').slice(0, 100)}`)
    .join('; ').split(/\s+/).slice(0, 60).join(' ');
}

module.exports = { summarizeState };
