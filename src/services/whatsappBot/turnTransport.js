const { AsyncLocalStorage } = require('node:async_hooks');
const base = require('../whatsappTransport');
const { formatWhatsapp } = require('./replySafety');
const turns = new AsyncLocalStorage();

function enqueue(method, args) {
  const turn = turns.getStore();
  if (!turn) return base[method](...args);
  turn.messages.push({ method, args });
  return Promise.resolve({ ok: true, deferred: true });
}

async function withTurn(callback, record, savePages) {
  const turn = { messages: [], afterSent: [] };
  return turns.run(turn, async () => {
    const value = await callback();
    if (!turn.messages.length) return value;
    const last = turn.messages.at(-1);
    const [connection, waId] = last.args;
    const text = formatWhatsapp(turn.messages.map(({ method, args }) => method === 'sendText' ? args[2]
      : method === 'sendInteractive' ? args[2]?.body?.text : args[3]).filter(Boolean).join('\n\n'));
    let result, type, body = text;
    if (last.method === 'sendInteractive' && text.length <= 1024) {
      const payload = { ...last.args[2], body: { text } };
      result = await base.sendInteractive(connection, waId, payload); type = 'interactive';
    } else if (turn.messages[0].method === 'sendImageByMediaId' && text.length <= 1024) {
      result = await base.sendImageByMediaId(connection, waId, turn.messages[0].args[2], text); type = 'image';
    } else {
      const action = last.method === 'sendInteractive' ? last.args[2]?.action : null;
      const labels = action?.buttons?.map((button) => button.reply.title) || action?.sections?.flatMap((section) => section.rows.map((row) => row.title)) || [];
      const complete = [text, labels.join('\n')].filter(Boolean).join('\n\n');
      const pages = [];
      for (let offset = 0; offset < complete.length; offset += 3400) pages.push(complete.slice(offset, offset + 3400));
      const firstPage = pages.shift() || '';
      body = firstPage;
      if (pages.length) body += '\n\nEscriba continuar para ver el resto.';
      result = await base.sendText(connection, waId, body); type = 'text';
      if (!result.ok) savePages([firstPage, ...pages]);
      else if (pages.length) savePages(pages);
    }
    if (!result.ok && type !== 'text') savePages([body]);
    await record(result, { type, body });
    if (result.ok) for (const callback of turn.afterSent) callback();
    return value;
  });
}

const methods = { withTurn,
  afterSent: (callback) => { const turn = turns.getStore(); if (turn) turn.afterSent.push(callback); else callback(); },
  sendText: (...args) => enqueue('sendText', args),
  sendInteractive: (...args) => enqueue('sendInteractive', args),
  sendImageByMediaId: (...args) => enqueue('sendImageByMediaId', args),
};
module.exports = new Proxy(base, { get: (target, key) => key in methods ? methods[key] : target[key] });
