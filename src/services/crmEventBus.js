const clientsByTenant = new Map();

function safePayload(payload) {
  return payload && typeof payload === 'object' ? payload : {};
}

function writeEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(safePayload(payload))}\n\n`);
}

function subscribe(tenantId, res) {
  if (!tenantId) {
    res.status(400).json({ error: 'Tenant requerido para eventos CRM' });
    return () => {};
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const client = { res, createdAt: Date.now() };
  if (!clientsByTenant.has(tenantId)) clientsByTenant.set(tenantId, new Set());
  clientsByTenant.get(tenantId).add(client);

  writeEvent(res, 'crm.connected', { ok: true, at: new Date().toISOString() });
  const heartbeat = setInterval(() => {
    try { writeEvent(res, 'crm.ping', { at: new Date().toISOString() }); }
    catch { cleanup(); }
  }, 25_000);

  function cleanup() {
    clearInterval(heartbeat);
    const clients = clientsByTenant.get(tenantId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) clientsByTenant.delete(tenantId);
    }
  }

  res.on('close', cleanup);
  res.on('error', cleanup);
  return cleanup;
}

function publish(tenantId, event, payload = {}) {
  const clients = clientsByTenant.get(tenantId);
  if (!clients || clients.size === 0) return;
  for (const client of [...clients]) {
    try {
      writeEvent(client.res, event, payload);
    } catch {
      clients.delete(client);
    }
  }
}

module.exports = { subscribe, publish };
