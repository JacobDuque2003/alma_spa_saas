const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('./state');

const WA_ID = '593000000001';

test('returning to menu clears every appointment branch', () => {
  state.setFlowState(WA_ID, { booking: { step: 'confirm' }, reschedule: { step: 'time' }, bookingForOther: { step: 'name' }, cancellation: { step: 'confirm' } });
  state.setFlowState(WA_ID, { flow: 'menu', tone: 'usted' });
  for (const branch of ['booking', 'reschedule', 'bookingForOther', 'cancellation']) assert.equal(state.getFlowState(WA_ID)[branch], null);
});

test.beforeEach(() => state._reset());

test('isolates flow, history and escalation by tenant and conversation for the same waId', () => {
  const scopes = [['tenant-a', 'conv-a'], ['tenant-b', 'conv-a'], ['tenant-a', 'conv-b']];
  for (const [index, scope] of scopes.entries()) {
    state.withConversation(...scope, () => {
      assert.equal(state.getFlowState(WA_ID), null);
      assert.deepEqual(state.getHistory(WA_ID), []);
      assert.equal(state.isEscalated(WA_ID), false);
      state.setFlowState(WA_ID, { flow: `flow-${index}`, clientName: `fixture-${index}` });
      state.pushHistory(WA_ID, 'user', `history-${index}`);
      if (index === 0) state.markEscalated(WA_ID);
    });
  }
  for (const [index, scope] of scopes.entries()) {
    state.withConversation(...scope, () => {
      assert.equal(state.getFlowState(WA_ID).flow, `flow-${index}`);
      assert.equal(state.getFlowState(WA_ID).clientName, `fixture-${index}`);
      assert.deepEqual(state.getHistory(WA_ID), [{ role: 'user', content: `history-${index}` }]);
      assert.equal(state.isEscalated(WA_ID), index === 0);
    });
  }
});

test('isolates contacts within the same conversation namespace', () => {
  state.withConversation('tenant-a', 'conv-a', () => {
    state.setFlowState(WA_ID, { flow: 'booking' });
    state.pushHistory(WA_ID, 'user', 'fixture-history');
    state.markEscalated(WA_ID);
    assert.equal(state.getFlowState('593000000002'), null);
    assert.deepEqual(state.getHistory('593000000002'), []);
    assert.equal(state.isEscalated('593000000002'), false);
    state.clearFlowState('593000000002');
    assert.equal(state.getFlowState(WA_ID).flow, 'booking');
  });
});

test('legacy calls retain a separate namespace with no fallback in either direction', () => {
  state.setFlowState(WA_ID, { flow: 'legacy' });
  state.pushHistory(WA_ID, 'user', 'legacy-history');
  state.markEscalated(WA_ID);
  state.withConversation('tenant-a', 'conv-a', () => {
    assert.equal(state.getFlowState(WA_ID), null);
    assert.deepEqual(state.getHistory(WA_ID), []);
    assert.equal(state.isEscalated(WA_ID), false);
    state.setFlowState(WA_ID, { flow: 'scoped' });
    state.pushHistory(WA_ID, 'assistant', 'scoped-history');
    state.clearFlowState(WA_ID);
  });
  assert.equal(state.getFlowState(WA_ID).flow, 'legacy');
  assert.deepEqual(state.getHistory(WA_ID), [{ role: 'user', content: 'legacy-history' }]);
  assert.equal(state.isEscalated(WA_ID), true);
  state.clearFlowState(WA_ID);
  state._reset();
  state.withConversation('tenant-b', 'conv-b', () => {
    state.setFlowState(WA_ID, { flow: 'scoped-only' });
    state.pushHistory(WA_ID, 'user', 'scoped-only-history');
    state.markEscalated(WA_ID);
  });
  assert.equal(state.getFlowState(WA_ID), null);
  assert.deepEqual(state.getHistory(WA_ID), []);
  assert.equal(state.isEscalated(WA_ID), false);
  state.withConversation('tenant-a', 'conv-a', () => {
    assert.equal(state.getFlowState(WA_ID), null);
    assert.deepEqual(state.getHistory(WA_ID), []);
    assert.equal(state.isEscalated(WA_ID), false);
  });
});

test('JSON namespaces cannot collide through delimiters or special characters', () => {
  const scopes = [['a:b', 'c'], ['a', 'b:c'], ['a"', 'b\\c'], ['a', '"b\\c']];
  scopes.forEach((scope, index) => state.withConversation(...scope, () => {
    state.setFlowState(WA_ID, { marker: index });
  }));
  scopes.forEach((scope, index) => state.withConversation(...scope, () => {
    assert.equal(state.getFlowState(WA_ID).marker, index);
  }));
});

test('concurrent async callbacks retain their own namespaces across awaits', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started = 0;
  const scopes = [['tenant-a', 'conv-a'], ['tenant-b', 'conv-a'], ['tenant-a', 'conv-b']];
  await Promise.all(scopes.map((scope, index) => state.withConversation(...scope, async () => {
    state.setFlowState(WA_ID, { marker: index });
    state.pushHistory(WA_ID, 'user', `before-${index}`);
    if (index === 0) state.markEscalated(WA_ID);
    started += 1;
    if (started === scopes.length) release();
    await gate;
    assert.equal(state.getFlowState(WA_ID).marker, index);
    assert.equal(state.isEscalated(WA_ID), index === 0);
    state.pushHistory(WA_ID, 'assistant', `after-${index}`);
    await Promise.resolve();
    assert.deepEqual(state.getHistory(WA_ID).map((item) => item.content), [`before-${index}`, `after-${index}`]);
    state.clearFlowState(WA_ID);
    return index;
  })));
  assert.equal(state.getFlowState(WA_ID), null);
  assert.equal(state.isEscalated(WA_ID), false);
});

test('nested callbacks restore the outer scope after return, throw and rejection', async () => {
  state.setFlowState(WA_ID, { marker: 'legacy' });
  const result = await state.withConversation('outer', 'conv', async () => {
    state.setFlowState(WA_ID, { marker: 'outer' });
    assert.equal(state.withConversation('inner', 'conv', () => {
      state.setFlowState(WA_ID, { marker: 'inner' });
      return 42;
    }), 42);
    assert.equal(state.getFlowState(WA_ID).marker, 'outer');
    assert.throws(() => state.withConversation('inner', 'conv', () => {
      throw new Error('fixture-error');
    }), /fixture-error/);
    await assert.rejects(state.withConversation('inner', 'conv', async () => {
      await Promise.resolve();
      throw new Error('fixture-rejection');
    }), /fixture-rejection/);
    assert.equal(state.getFlowState(WA_ID).marker, 'outer');
    return 'returned';
  });
  assert.equal(result, 'returned');
  assert.equal(state.getFlowState(WA_ID).marker, 'legacy');
});

test('withConversation rejects incomplete scopes without invoking the callback', () => {
  for (const ids of [[undefined, 'conv'], ['tenant', null], ['', 'conv'], ['tenant', ' ']]) {
    assert.throws(() => state.withConversation(...ids, () => assert.fail('invalid scope ran')), TypeError);
  }
});

test('TTL expiration and history limits apply independently to each scope', (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  state.withConversation('tenant-a', 'conv', () => {
    state.setFlowState(WA_ID, { marker: 'a' });
    state.markEscalated(WA_ID);
    for (let index = 0; index < state.MAX_HISTORY + 2; index += 1) {
      state.pushHistory(WA_ID, 'user', `${index}-${'x'.repeat(400)}`);
    }
    assert.equal(state.getHistory(WA_ID).length, state.MAX_HISTORY);
    assert.match(state.getHistory(WA_ID)[0].content, /^2-/);
    assert.ok(state.getHistory(WA_ID).every((item) => item.content.length === 300));
  });
  now += state.FLOW_TTL_MS + 1;
  state.withConversation('tenant-b', 'conv', () => {
    state.setFlowState(WA_ID, { marker: 'b' });
    state.markEscalated(WA_ID);
  });
  state.withConversation('tenant-a', 'conv', () => {
    assert.equal(state.getFlowState(WA_ID), null);
    assert.deepEqual(state.getHistory(WA_ID), []);
    assert.equal(state.isEscalated(WA_ID), true);
  });
  state.withConversation('tenant-b', 'conv', () => assert.equal(state.getFlowState(WA_ID).marker, 'b'));
  now = 1000 + state.ESCALATED_TTL_MS;
  state.withConversation('tenant-a', 'conv', () => assert.equal(state.isEscalated(WA_ID), false));
  state.withConversation('tenant-b', 'conv', () => assert.equal(state.isEscalated(WA_ID), true));
});

test('_reset clears flow, history and escalation in all namespaces', () => {
  state.setFlowState(WA_ID, { marker: 'legacy' });
  state.markEscalated(WA_ID);
  state.withConversation('tenant-a', 'conv', () => {
    state.pushHistory(WA_ID, 'user', 'fixture-history');
    state.markEscalated(WA_ID);
  });
  state._reset();
  const checkEmpty = () => {
    assert.equal(state.getFlowState(WA_ID), null);
    assert.deepEqual(state.getHistory(WA_ID), []);
    assert.equal(state.isEscalated(WA_ID), false);
  };
  checkEmpty();
  state.withConversation('tenant-a', 'conv', checkEmpty);
});
