const { AppError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Cuerpo JSON inválido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload demasiado grande' });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err.constructor?.name?.startsWith('PrismaClient') || err.code?.startsWith?.('P')) {
    console.error('[prisma-error]', err);
    if (err.code === 'P2002') return res.status(409).json({ error: 'El registro ya existe' });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Registro no encontrado' });
    return res.status(500).json({ error: 'Error interno' });
  }

  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    return res.status(status).json({ error: 'Error interno' });
  }

  console.warn('[unexpected-4xx]', { status, path: req.path, method: req.method, message: err.message });
  return res.status(status).json({ error: 'Solicitud inválida' });
}

module.exports = errorHandler;
