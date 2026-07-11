const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const inboxService = require('../services/whatsappInboxService');

const router = express.Router();
router.use(authenticate, requirePermission('crm'));

router.get('/conversations', async (req, res, next) => {
  try {
    const result = await inboxService.listConversations(req.user, req.query);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await inboxService.getConversation(req.user, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json(conv);
  } catch (err) { next(err); }
});

router.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const result = await inboxService.listMessages(req.user, req.params.id, req.query);
    if (!result) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/conversations/:id/messages', async (req, res, next) => {
  try {
    const msg = await inboxService.sendManualText(req.user, req.params.id, req.body?.body);
    if (!msg) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.status(201).json(msg);
  } catch (err) { next(err); }
});

router.post('/conversations/:id/reminder', async (req, res, next) => {
  try {
    const msg = await inboxService.sendReminder(req.user, req.params.id);
    if (!msg) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.status(201).json(msg);
  } catch (err) { next(err); }
});

router.post('/conversations/:id/mark-read', async (req, res, next) => {
  try {
    const conv = await inboxService.markRead(req.user, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ id: conv.id, unreadCount: conv.unreadCount, lastReadAt: conv.lastReadAt });
  } catch (err) { next(err); }
});

router.patch('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await inboxService.updateConversation(req.user, req.params.id, req.body);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json(conv);
  } catch (err) { next(err); }
});

module.exports = router;
