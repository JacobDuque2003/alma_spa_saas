const test = require('node:test');
const assert = require('node:assert/strict');
const { formatWhatsapp, guardReply } = require('./replySafety');
test('WhatsApp formatter uses single markers and strips headings', () => {
  assert.equal(formatWhatsapp('# Servicio\n**Masaje** __relajante__'), 'Servicio\n*Masaje* _relajante_');
});
test('AI cannot announce unsupported appointment or payment actions in any intent', () => {
  for (const claim of ['Tu cita está reservada', 'La cita quedó confirmada', 'Agendado', 'Cancelado', 'Reprogramado', 'Pago recibido']) {
    assert.match(guardReply(claim), /No he realizado cambios/);
  }
  assert.equal(guardReply('No he reservado una cita.'), 'No he reservado una cita.');
});
