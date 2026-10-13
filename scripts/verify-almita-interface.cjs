const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const base = process.env.ALMA_UI_URL || 'http://localhost:3107';
  const out = path.join(__dirname, '..', 'tmp', 'almita-privacy-ui');
  fs.mkdirSync(out, { recursive: true });
  const browser = await playwright.chromium.launch({ headless: true, channel: process.env.ALMA_BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'alma_token', value: 'synthetic-ui-test', url: base }]);
  let saved = null;
  let role = 'superadmin';
  const row = { id: 'synthetic-knowledge', title: 'Ubicacion aprobada', category: 'Ubicacion', content: 'Informacion publica ficticia.', active: true, audience: 'PUBLIC', priority: 88, source: 'Fuente aprobada ficticia' };
  const services = [
    { id: 'paid', name: 'Masaje relajante', category: 'Masajes', priceUsd: 30, durationMins: 60, description: 'Descripcion ficticia para comprobar el formulario.' },
    { id: 'pending', name: 'Servicio con precio pendiente', category: 'Masajes', priceUsd: 0, durationMins: 60, requiresAdvisor: true, priceLabel: 'Valor a confirmar' },
  ];
  // Every API is intercepted: this check cannot read or change production data.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let response = {};
    const endpoint = url.pathname.replace('/api/proxy', '');
    if (endpoint === '/auth/me') response = { id: 'synthetic-support', role, fullName: 'Soporte de prueba', email: 'support@example.test', permissions: {}, tenant: { name: 'Alma Spa' } };
    else if (endpoint === '/almita-center/knowledge') response = { knowledge: [row] };
    else if (endpoint === `/almita-center/knowledge/${row.id}`) {
      saved = route.request().postDataJSON(); response = { knowledge: { ...row, ...saved } };
    } else if (endpoint === '/almita-center/configuration') response = { configuration: { personality: 'Tono ficticio.', instructions: 'Reglas ficticias.', dailyBriefing: 'Aviso ficticio.', active: true } };
    else if (endpoint === '/almita-center/examples') response = { examples: [] };
    else if (endpoint === '/almita-center/metrics') response = { interactions: 0, byIntent: [] };
    else if (endpoint === '/public/alma-spa/services') response = services;
    else if (endpoint.endsWith('/services')) response = services;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/admin/almita`);
      await page.getByRole('button', { name: 'Informacion', exact: true }).or(page.getByRole('button', { name: 'Información', exact: true })).click();
      await page.getByRole('button', { name: 'Editar', exact: true }).click();
      const audience = page.getByLabel('Audiencia');
      await audience.waitFor();
      assert.equal(await audience.inputValue(), 'PUBLIC');
      await audience.selectOption('INTERNAL');
      await page.screenshot({ path: path.join(out, `almita-editor-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Editor overflow at ${width}`);
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.getByRole('button', { name: 'Nueva ficha', exact: true }).waitFor();
      assert.equal(saved.audience, 'INTERNAL');
      assert.equal(saved.priority, 88);
      assert.equal(saved.source, row.source);
      await page.getByRole('button', { name: 'Nueva ficha', exact: true }).click();
      assert.equal(await page.getByLabel('Audiencia').inputValue(), 'INTERNAL');
      await page.goto(`${base}/reservar/alma-spa`);
      await page.getByRole('button', { name: /Servicio con precio pendiente/ }).click();
      assert.equal(await page.getByRole('button', { name: /Continuar|Siguiente/ }).isEnabled(), false);
      assert.ok(!(await page.locator('body').innerText()).includes('$0.00'));
      await page.screenshot({ path: path.join(out, `reserva-pendiente-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Booking overflow at ${width}`);
    }
    assert.deepEqual(errors, []);
    role = 'dueno';
    await page.goto(`${base}/admin/almita`);
    await page.waitForURL((url) => url.pathname.startsWith('/admin/') && url.pathname !== '/admin/almita', { waitUntil: 'commit' });
    assert.equal(await page.getByLabel('Audiencia').count(), 0);
    console.log(JSON.stringify({ ok: true, screenshots: out, viewports: [1440, 390], checks: ['audiencia interna por defecto', 'metadatos conservados', 'precio pendiente sin reserva automatica', 'acceso de dueno bloqueado', 'sin desbordamiento horizontal'] }));
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
