const CABINS = [
  { sortOrder: 1, name: 'Cabina 1 - TIENDA', specialty: 'tienda' },
  { sortOrder: 2, name: 'Cabina 2 - FACIAL', specialty: 'facial' },
  { sortOrder: 3, name: 'Cabina 3 - LASER', specialty: 'laser' },
  { sortOrder: 4, name: 'Cabina 4 - CORPORAL', specialty: 'corporal' },
  { sortOrder: 5, name: 'Cabina 5 - BA\u00d1O DE CAJ\u00d3N', specialty: 'ba\u00f1o de caj\u00f3n' },
  { sortOrder: 6, name: 'Cabina 6 - CERAGEM', specialty: 'ceragem' },
  {
    sortOrder: 7,
    name: 'Cabina 7 - TERAPIAS',
    specialty: 'terapias',
    schedule: {
      wednesday: {
        morning: { start: '08:00', end: '12:00' },
        afternoon: { start: '14:00', end: '17:00' },
      },
    },
  },
  { sortOrder: 8, name: 'Cabina 8 - YOGA', specialty: 'yoga' },
  { sortOrder: 9, name: 'Cabina 9 - PIES', specialty: 'pies' },
];

// Paleta suave y consistente con Alma: tonos bronce, oliva, arcilla,
// salvia y lavanda apagada. Evita colores el\u00e9ctricos tipo calendario gen\u00e9rico.
const SERVICES = [
  { name: 'Limpieza facial', category: 'facial', durationMins: 60, colorHex: '#9B7A58', cabinOrders: [2] },
  { name: 'Aero yoga', category: 'yoga', durationMins: 60, colorHex: '#B8A65A', cabinOrders: [8] },
  { name: 'Almuerzos', category: 'operativo', durationMins: 60, colorHex: '#A89A87', cabinOrders: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { name: 'Camilla Ceragem', category: 'ceragem', durationMins: 45, colorHex: '#9A8F82', cabinOrders: [6] },
  { name: 'Corporal - Reductor', category: 'corporal', durationMins: 60, colorHex: '#C56F4B', cabinOrders: [4] },
  { name: 'Cumplea\u00f1os', category: 'recordatorio', durationMins: 15, colorHex: '#B6A45E', cabinOrders: [1] },
  { name: 'Depilaci\u00f3n', category: 'laser', durationMins: 45, colorHex: '#5E8B68', cabinOrders: [3] },
  { name: 'Detox i\u00f3nica', category: 'pies', durationMins: 45, colorHex: '#7B5E50', cabinOrders: [9] },
  { name: 'Drenaje port-operatorio', category: 'corporal', durationMins: 60, colorHex: '#6F7FB8', cabinOrders: [4, 7] },
  { name: 'Emo vacuna', category: 'terapias', durationMins: 45, colorHex: '#6D8A52', cabinOrders: [7] },
  { name: 'Masaje relajante', category: 'corporal', durationMins: 60, colorHex: '#D1A84F', cabinOrders: [4, 7] },
  { name: 'Reflexolog\u00eda', category: 'pies', durationMins: 45, colorHex: '#9B6FA6', cabinOrders: [9, 7] },
  { name: 'Sueroterapia', category: 'terapias', durationMins: 60, colorHex: '#C97870', cabinOrders: [7] },
  { name: 'Terapia neural', category: 'terapias', durationMins: 45, colorHex: '#4F9B70', cabinOrders: [7] },
  { name: 'Terapias energ\u00e9ticas', category: 'terapias', durationMins: 60, colorHex: '#4E9C8C', cabinOrders: [7, 8] },
  { name: 'Tratamiento capilar', category: 'tienda', durationMins: 45, colorHex: '#B64F83', cabinOrders: [1] },
  { name: 'Tratamientos faciales', category: 'facial', durationMins: 60, colorHex: '#8C78B6', cabinOrders: [2] },
];

module.exports = { CABINS, SERVICES };
