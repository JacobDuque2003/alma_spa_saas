const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVICES } = require('./config/almaSpaCatalog');

const expectedServices = {
  'Limpieza facial': { durationMins: 75, blockMins: 90, cabinOrders: [1, 2, 3] },
  'Aero yoga': { durationMins: 60, blockMins: 75, cabinOrders: [8] },
  'Camilla Ceragem': { durationMins: 60, blockMins: 75, cabinOrders: [6] },
  'Corporal - Reductor': { durationMins: 75, blockMins: 90, cabinOrders: [3, 4, 5] },
  'Depilación': { durationMins: 60, blockMins: 75, cabinOrders: [3] },
  'Detox iónica': { durationMins: 30, blockMins: 45, cabinOrders: [9] },
  'Drenaje post-operatorio': { durationMins: 105, blockMins: 120, cabinOrders: [3, 4, 5] },
  'Emo vacuna': { durationMins: 30, blockMins: 45, cabinOrders: [3, 4, 5, 7] },
  'Masaje relajante': { durationMins: 120, blockMins: 135, cabinOrders: [7, 3, 4, 5] },
  'Reflexología': { durationMins: 60, blockMins: 75, cabinOrders: [1, 2, 3, 4, 5, 7, 8, 9] },
  'Sueroterapia': { durationMins: 30, blockMins: 45, cabinOrders: [6, 3, 4, 5, 7] },
  'Terapia neural': { durationMins: 105, blockMins: 120, cabinOrders: [3, 4, 5, 7] },
  'Terapias energéticas': { durationMins: 75, blockMins: 90, cabinOrders: [7] },
  'Tratamiento capilar': { durationMins: 60, blockMins: 75, cabinOrders: [1, 2, 3] },
  'Tratamientos faciales': { durationMins: 75, blockMins: 90, cabinOrders: [1, 2, 3] },
};

test('catálogo Alma Spa conserva duración real, pausa de 15 min y cabinas permitidas por servicio', () => {
  for (const [name, expected] of Object.entries(expectedServices)) {
    const service = SERVICES.find((item) => item.name === name);
    assert.ok(service, `Falta el servicio ${name}`);
    assert.equal(service.durationMins, expected.durationMins, `${name}: duración incorrecta`);
    assert.equal(service.durationMins + 15, expected.blockMins, `${name}: bloque total incorrecto`);
    assert.deepEqual(service.cabinOrders, expected.cabinOrders, `${name}: cabinas incorrectas`);
  }
});
