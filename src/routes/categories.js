const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const categoryService = require('../services/categoryService');

const router = express.Router();
const auth = [authenticate, requirePermission('configuracion')];

router.get('/', authenticate, async (req, res, next) => {
  // Cualquier usuario autenticado puede listar categorías (se necesitan para formularios).
  try {
    const cats = await categoryService.listCategories(req.user, req.query);
    res.json(cats);
  } catch (err) {
    next(err);
  }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const cat = await categoryService.createCategory(req.user, req.body);
    res.status(201).json(cat);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', auth, async (req, res, next) => {
  try {
    const cat = await categoryService.updateCategory(req.user, req.params.id, req.body);
    if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(cat);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const cat = await categoryService.deleteCategory(req.user, req.params.id);
    if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
