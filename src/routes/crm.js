const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const inboxService = require('../services/whatsappInboxService');
const crmEvents = require('../services/crmEventBus');

const router = express.Router();
router.use(authenticate, requirePermission('crm'));

router.get('/events', (req, res) => {
  crmEvents.subscribe(req.user.tenantId, res);
});

router.get('/assignees', async (req, res, next) => {
  try {
    const users = await inboxService.listAssignees(req.user);
    res.json({ items: users });
  } catch (err) { next(err); }
});

router.get('/labels', async (req, res, next) => {
  try {
    const labels = await inboxService.listLabelDefinitions(req.user);
    res.json({ items: labels });
  } catch (err) { next(err); }
});

router.put('/labels', async (req, res, next) => {
  try {
    const labels = await inboxService.saveLabelDefinitions(req.user, req.body?.labels);
    res.json({ items: labels });
  } catch (err) { next(err); }
});

router.get('/quick-replies', async (req, res, next) => {
  try {
    const quickReplies = await inboxService.listQuickReplies(req.user);
    res.json({ items: quickReplies });
  } catch (err) { next(err); }
});

router.put('/quick-replies', async (req, res, next) => {
  try {
    const quickReplies = await inboxService.saveQuickReplies(req.user, req.body?.quickReplies);
    res.json({ items: quickReplies });
  } catch (err) { next(err); }
});

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

router.post('/conversations/:id/read-state', async (req, res, next) => {
  try {
    const conv = await inboxService.setReadState(req.user, req.params.id, Boolean(req.body?.unread));
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({
      id: conv.id,
      unreadCount: conv.unreadCount,
      unreadRestoreCount: conv.unreadRestoreCount,
      manuallyMarkedUnread: conv.manuallyMarkedUnread,
      status: conv.status,
      lastReadAt: conv.lastReadAt,
    });
  } catch (err) { next(err); }
});

router.post('/conversations/:id/reactivate-bot', async (req, res, next) => {
  try {
    const conv = await inboxService.reactivateBot(req.user, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ id: conv.id, botActive: conv.botActive });
  } catch (err) { next(err); }
});

router.post('/conversations/:id/bot/pause', async (req, res, next) => {
  try {
    const conv = await inboxService.pauseBot(req.user, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ id: conv.id, botActive: conv.botActive, botPausedUntil: conv.botPausedUntil });
  } catch (err) { next(err); }
});

router.post('/conversations/:id/bot/resume', async (req, res, next) => {
  try {
    const conv = await inboxService.reactivateBot(req.user, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ id: conv.id, botActive: conv.botActive, botPausedUntil: conv.botPausedUntil });
  } catch (err) { next(err); }
});

router.patch('/conversations/:id/assign', async (req, res, next) => {
  try {
    const conv = await inboxService.assignConversation(req.user, req.params.id, req.body?.userId ?? null);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ id: conv.id, assignedToUserId: conv.assignedToUserId });
  } catch (err) { next(err); }
});

router.post('/conversations/:id/status', async (req, res, next) => {
  try {
    const conv = await inboxService.setStatus(req.user, req.params.id, req.body?.status);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ id: conv.id, status: conv.status, archived: conv.archived, botActive: conv.botActive });
  } catch (err) { next(err); }
});

router.patch('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await inboxService.updateConversation(req.user, req.params.id, req.body);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json(conv);
  } catch (err) { next(err); }
});

router.put('/conversations/:id/labels', async (req, res, next) => {
  try {
    const labels = Array.isArray(req.body?.labels) ? req.body.labels : [];
    const conv = await inboxService.setLabels(req.user, req.params.id, labels);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ id: conv.id, labels: conv.labels });
  } catch (err) { next(err); }
});

router.get('/conversations/:id/notes', async (req, res, next) => {
  try {
    const notes = await inboxService.listNotes(req.user, req.params.id);
    if (!notes) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json(notes);
  } catch (err) { next(err); }
});

router.post('/conversations/:id/notes', async (req, res, next) => {
  try {
    const note = await inboxService.createNote(req.user, req.params.id, req.body?.content);
    if (!note) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.status(201).json(note);
  } catch (err) { next(err); }
});

router.delete('/notes/:noteId', async (req, res, next) => {
  try {
    const result = await inboxService.deleteNote(req.user, req.params.noteId);
    if (!result) return res.status(404).json({ error: 'Nota no encontrada' });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
