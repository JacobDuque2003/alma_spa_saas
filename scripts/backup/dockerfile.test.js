const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Dockerfile.backup incluye el notificador usado por run.js', () => {
  const dockerfile = fs.readFileSync(path.resolve(__dirname, '../../Dockerfile.backup'), 'utf8');
  assert.match(
    dockerfile,
    /COPY\s+src\/services\/telegramAlertService\.js\s+\.\/src\/services\/telegramAlertService\.js/
  );
});
