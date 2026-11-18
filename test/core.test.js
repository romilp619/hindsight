import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankBySimilarity, computeOutcome, scoreRisk, findExperts, extractLessons, parseJsonReply, adfToText, textToAdf } from '../src/lib/core.js';

test('similarity ranks payment work above unrelated work', () => {
  const r = rankBySimilarity('Migrate card payments to Stripe Payment Intents', [
    { id: 'A', text: 'Migrate subscription billing to Stripe Billing API webhooks' },
    { id: 'B', text: 'Mobile app offline mode with sqlite cache' },
    { id: 'C', text: 'PayPal checkout payments for EU markets' },
  ]);
  assert.equal(r.at(-1).id, 'B');
  assert.ok(r.find((x) => x.id === 'A').score > 2 * r.find((x) => x.id === 'B').score);
  assert.ok(r.find((x) => x.id === 'C').score > 2 * r.find((x) => x.id === 'B').score);
});

test('outcome uses imported history dates and classifies children', () => {
  const o = computeOutcome(
    { key: 'P-1', summary: 'x', created: '2026-01-01', history: { startedAt: '2025-01-01', dueAt: '2025-02-01', resolvedAt: '2025-03-01', owner: 'Sofia' }, comments: ['Retro: we should load-test webhooks next time.', 'unrelated chatter'] },
    [
      { key: 'P-2', summary: 'dup charges', history: { kind: 'incident', severity: 'Sev-2', fixer: 'Priya' } },
      { key: 'P-3', summary: 'bug', issuetype: 'Bug' },
      { key: 'P-4', summary: 'outage', issuetype: 'Task', labels: ['incident'], assignee: { accountId: 'a1', displayName: 'Wei' } },
    ],
  );
  assert.equal(o.plannedDays, 31);
  assert.equal(o.slipDays, 28);
  assert.equal(o.incidents.length, 2);
  assert.equal(o.incidents[1].fixerAccountId, 'a1');
  assert.equal(o.bugCount, 1);
  assert.equal(o.verdict, 'late+incident');
  assert.match(o.retro, /load-test/);
  assert.doesNotMatch(o.retro, /chatter/);
  assert.equal(o.owner, 'Sofia');
});

const out = (slipDays, incidents = 0) => ({ key: 'K', summary: 's', slipDays, incidents: Array(incidents).fill({}), bugCount: 0 });

test('risk is HIGH when similar work slipped badly and had incidents', () => {
  const r = scoreRisk([{ similarity: 0.5, outcome: out(28, 1) }, { similarity: 0.4, outcome: out(12) }, { similarity: 0.3, outcome: out(20, 1) }]);
  assert.equal(r.risk, 'HIGH');
  assert.ok(r.predictedSlipDays >= 18 && r.predictedSlipDays <= 23, `slip ${r.predictedSlipDays}`);
  assert.equal(r.confidence, 'high');
});

test('risk is LOW when similar work shipped on time with no incidents', () => {
  const r = scoreRisk([{ similarity: 0.5, outcome: out(-2) }, { similarity: 0.4, outcome: out(0) }]);
  assert.equal(r.risk, 'LOW');
  assert.equal(r.predictedSlipDays, 0);
});

test('no history -> UNKNOWN', () => {
  assert.equal(scoreRisk([]).risk, 'UNKNOWN');
});

test('experts ranks people who appear more than once', () => {
  const sim = [
    { outcome: { key: 'A', summary: 'a', owner: 'Sofia', incidents: [{ key: 'A1', summary: 'x', fixer: 'Priya' }] } },
    { outcome: { key: 'B', summary: 'b', owner: 'Priya', incidents: [] } },
  ];
  const e = findExperts(sim);
  assert.equal(e[0].displayName, 'Priya');
  assert.match(e[0].reason, /fixed A1/);
});

test('fallback lessons come from retro sentences', () => {
  const l = extractLessons([{ outcome: { key: 'A', retro: 'Retro: Things went ok. We should add idempotency keys before go-live. Next time involve Finance earlier please.' } }]);
  assert.equal(l.length, 2);
  assert.equal(l[0].sourceKey, 'A');
});

test('parseJsonReply handles fences and prose', () => {
  assert.deepEqual(parseJsonReply('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonReply('here {"b":[1,2]} done'), { b: [1, 2] });
  assert.equal(parseJsonReply('nope'), null);
});

test('ADF round trip', () => {
  assert.equal(adfToText(textToAdf('one\ntwo')).trim(), 'one\ntwo');
});

import { sameDomain, domainsOf } from '../src/lib/core.js';

test('same-domain filter keeps payments work and drops auth "migrations"', () => {
  const q = 'Migrate card payments to Stripe Payment Intents API';
  assert.deepEqual([...domainsOf(q)], ['concept:payments']);
  const cands = [
    { id: 'billing', text: 'Migrate subscription billing to Stripe Billing API' },
    { id: 'oauth', text: 'OAuth2 migration for public partner API. Replace static API keys with OAuth2 client credentials.' },
    { id: 'paypal', text: 'PayPal checkout integration for EU markets' },
  ];
  assert.deepEqual(sameDomain(q, cands, (c) => c.text).map((c) => c.id), ['billing', 'paypal']);
  // no domain in the query -> unchanged
  assert.equal(sameDomain('Improve onboarding docs', cands, (c) => c.text).length, 3);
});
