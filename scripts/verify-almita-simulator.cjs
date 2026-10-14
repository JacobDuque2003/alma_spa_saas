const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const base = process.env.ALMA_UI_URL || 'http://localhost:3110';
  const out = path.join(__dirname, '..', 'tmp', 'almita-simulator-ui');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'alma_token', value: 'synthetic-simulator-test', url: base }]);
  const calls = [];
  let shouldFail = true;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/proxy', '');
    let body = {};
    let status = 200;
    if (endpoint === '/auth/me') body = { id: 'synthetic-support', role: 'superadmin', fullName: 'Soporte', permissions: {} };
    else if (endpoint === '/almita-center/configuration') body = { configuration: { personality: 'Prueba', instructions: 'Prueba', dailyBriefing: 'Prueba', active: true } };
    else if (endpoint === '/almita-center/knowledge') body = { knowledge: [] };
    else if (endpoint === '/almita-center/examples') body = { examples: [] };
    else if (endpoint === '/almita-center/metrics') body = { interactions: 0 };
    else if (endpoint === '/almita-center/simulate') {
      const call = route.request().postDataJSON();
      calls.push(call);
      if (call.message === 'quiero un masaje relajante' && shouldFail) {
        shouldFail = false; status = 504;
        body = { error: 'La IA tardo demasiado en responder. Puede reintentar el mensaje.' };
      } else body = { intent: 'greeting', handler: 'Reglas', reply: 'Respuesta ficticia de prueba.', params: {}, sources: [], usage: { totalTokens: 0, costUsd: 0 } };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (const width of [1440, 390]) {
      shouldFail = true;
      calls.length = 0;
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/admin/almita`);
      await page.getByRole('button', { name: 'Simulador', exact: true }).click();
      const input = page.getByRole('textbox', { name: 'Mensaje de prueba' });
      const alert = page.getByRole('alert').filter({ hasText: 'La IA tardo demasiado' });
      await input.fill('hola');
      await page.getByRole('button', { name: 'Enviar prueba' }).click();
      await page.getByText('Respuesta ficticia de prueba.', { exact: true }).waitFor();
      assert.equal(calls[0].history.some((entry) => entry.content === 'hola'), false);
      await input.fill('quiero un masaje relajante');
      await page.getByRole('button', { name: 'Enviar prueba' }).click();
      await alert.waitFor();
      assert.equal(await input.inputValue(), 'quiero un masaje relajante');
      assert.equal(await page.getByText('Reglas', { exact: true }).count(), 0);
      await page.screenshot({ path: path.join(out, `simulator-error-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
      await alert.waitFor({ state: 'hidden' });
      assert.equal(calls[2].history.some((entry) => entry.content === 'quiero un masaje relajante'), false);
      assert.equal(await page.getByText('quiero un masaje relajante', { exact: true }).count(), 1);
      await input.fill('prefiero a una persona');
      await page.getByRole('button', { name: 'Enviar prueba' }).click();
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Mensaje de prueba"]').value === '' && !document.body.innerText.includes('Almita esta preparando'));
      await page.getByText('Reglas', { exact: true }).waitFor();
      assert.equal(calls[3].history.filter((entry) => entry.content === 'quiero un masaje relajante').length, 1);
      assert.equal(calls[3].history.some((entry) => entry.content === 'prefiero a una persona'), false);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.screenshot({ path: path.join(out, `simulator-success-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, viewports: [1440, 390], checks: ['no duplicated current message', 'failed turn excluded', 'retry preserves input', 'no stale diagnostics', 'no horizontal overflow'], screenshots: out }));
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
