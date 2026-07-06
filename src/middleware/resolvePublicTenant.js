const prisma = require('../utils/prisma');

/**
 * Deriva el tenant EXCLUSIVAMENTE del slug en la URL — nunca de un tenantId
 * que el cliente mande en body/query. 404 genérico si el slug no existe o
 * el tenant está inactivo, para no revelar cuál es el caso (evita
 * enumeración de tenants).
 */
async function resolvePublicTenant(req, res, next) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: req.params.tenantSlug } });
  if (!tenant || !tenant.active) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  req.publicTenant = { id: tenant.id, slug: tenant.slug, config: tenant.config };
  next();
}

module.exports = resolvePublicTenant;
