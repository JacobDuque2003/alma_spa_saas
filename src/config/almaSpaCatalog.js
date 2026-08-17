const CABINS = [
  { sortOrder: 1, name: 'Cabina 1 - TIENDA', specialty: 'tienda', colorHex: '#D81B60' },
  { sortOrder: 2, name: 'Cabina 2 - FACIAL', specialty: 'facial', colorHex: '#8E24AA' },
  { sortOrder: 3, name: 'Cabina 3 - LASER', specialty: 'laser', colorHex: '#0B8043' },
  { sortOrder: 4, name: 'Cabina 4 - CORPORAL', specialty: 'corporal', colorHex: '#F4511E' },
  { sortOrder: 5, name: 'Cabina 5 - BA\u00d1O DE CAJ\u00d3N', specialty: 'ba\u00f1o de caj\u00f3n', colorHex: '#795548' },
  { sortOrder: 6, name: 'Cabina 6 - CERAGEM', specialty: 'ceragem', colorHex: '#9E9D24' },
  {
    sortOrder: 7,
    name: 'Cabina 7 - TERAPIAS',
    specialty: 'terapias',
    colorHex: '#E67C73',
    schedule: {
      wednesday: {
        morning: { start: '08:00', end: '12:00' },
        afternoon: { start: '14:00', end: '17:00' },
      },
    },
  },
  { sortOrder: 8, name: 'Cabina 8 - YOGA', specialty: 'yoga', colorHex: '#C0CA33' },
  { sortOrder: 9, name: 'Cabina 9 - PIES', specialty: 'pies', colorHex: '#AB47BC' },
];

// Paleta Google Calendar tomada de la referencia de Alma Spa.
const SERVICES = [
  { name: 'Limpieza facial', category: 'facial', durationMins: 75, colorHex: '#8E24AA', cabinOrders: [1, 2, 3] },
  { name: 'Aero yoga', category: 'yoga', durationMins: 60, colorHex: '#C0CA33', cabinOrders: [8] },
  { name: 'Camilla Ceragem', category: 'ceragem', durationMins: 60, colorHex: '#9E9D24', cabinOrders: [6] },
  { name: 'Corporal - Reductor', category: 'corporal', durationMins: 75, colorHex: '#F4511E', cabinOrders: [3, 4, 5] },
  { name: 'Cumplea\u00f1os', category: 'recordatorio', durationMins: 15, colorHex: '#C0CA33', cabinOrders: [1] },
  { name: 'Depilaci\u00f3n', category: 'laser', durationMins: 60, colorHex: '#0B8043', cabinOrders: [3] },
  { name: 'Detox i\u00f3nica', category: 'pies', durationMins: 30, colorHex: '#795548', cabinOrders: [9] },
  { name: 'Drenaje post-operatorio', category: 'corporal', durationMins: 105, colorHex: '#3F51B5', cabinOrders: [3, 4, 5] },
  { name: 'Emo vacuna', category: 'terapias', durationMins: 30, colorHex: '#7CB342', cabinOrders: [3, 4, 5, 7] },
  { name: 'Masaje relajante', category: 'corporal', durationMins: 120, colorHex: '#F6BF26', cabinOrders: [7, 3, 4, 5] },
  { name: 'Reflexolog\u00eda', category: 'pies', durationMins: 60, colorHex: '#AB47BC', cabinOrders: [1, 2, 3, 4, 5, 7, 8, 9] },
  { name: 'Sueroterapia', category: 'terapias', durationMins: 30, colorHex: '#E67C73', cabinOrders: [6, 3, 4, 5, 7] },
  { name: 'Terapia neural', category: 'terapias', durationMins: 105, colorHex: '#33B679', cabinOrders: [3, 4, 5, 7] },
  { name: 'Terapias energ\u00e9ticas', category: 'terapias', durationMins: 75, colorHex: '#009688', cabinOrders: [7] },
  { name: 'Tratamiento capilar', category: 'tienda', durationMins: 60, colorHex: '#D81B60', cabinOrders: [1, 2, 3] },
  { name: 'Tratamientos faciales', category: 'facial', durationMins: 75, colorHex: '#7986CB', cabinOrders: [1, 2, 3] },
];

module.exports = { CABINS, SERVICES };
