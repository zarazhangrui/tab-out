'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRenderScheduler,
} = require('./dashboard-runtime.js');

test('createRenderScheduler returns only latest result when renders overlap', async () => {
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const calls = [];

  const scheduleRender = createRenderScheduler(async ({ requestId, isStale }, value) => {
    calls.push({ requestId, value, staleAtStart: isStale() });
    if (value === 'first') {
      await firstGate;
      return `${value}-result`;
    }
    return `${value}-result`;
  }, {
    logger: { warn() {} },
  });

  const firstPromise = scheduleRender('first');
  const secondPromise = scheduleRender('second');
  releaseFirst();

  assert.equal(await firstPromise, undefined);
  assert.equal(await secondPromise, 'second-result');
  assert.deepEqual(calls, [
    { requestId: 1, value: 'first', staleAtStart: true },
    { requestId: 2, value: 'second', staleAtStart: false },
  ]);
});

test('createRenderScheduler logs and rethrows renderer errors', async () => {
  const warnings = [];
  const scheduleRender = createRenderScheduler(async () => {
    throw new Error('boom');
  }, {
    label: 'dashboard render',
    logger: {
      warn(...args) {
        warnings.push(args);
      },
    },
  });

  await assert.rejects(scheduleRender(), /boom/);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /dashboard render failed/);
});
