// End-to-end: sample history -> new epic -> automatic pre-mortem -> lessons as tasks -> learning loop,
// running the real backend against an in-memory Jira (see test/stubs).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { jira, resetJira } from './stubs/forge-api.mjs';
import { store } from './stubs/forge-kvs.mjs';
import { llmState } from './stubs/forge-llm.mjs';
import { twgState } from './stubs/forge-twg.mjs';
import { seedStep, seedStatus, clearSample } from '../src/lib/seed.js';
import { SAMPLE_EPICS } from '../src/lib/sample-data.js';
import { adfToText } from '../src/lib/core.js';
import * as app from '../src/index.js';

const P = 'PAY';
const epicCount = () => [...jira.issues.values()].filter((i) => i.fields.issuetype.hierarchyLevel === 1).length;
async function newEpic(summary, description = '') {
  const res = await app.findSimilarWorkAction; // ensure module loaded
  const { createIssue } = await import('../src/lib/jira.js');
  const created = await createIssue({ project: { key: P }, issuetype: { id: '10000' }, summary, description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description || summary }] }] } });
  return created.key;
}

before(async () => {
  resetJira();
  store.clear();
  llmState.reply = null; // start with the LLM unavailable: deterministic path must work alone
  for (let i = 0; i < SAMPLE_EPICS.length; i++) await seedStep(P, i);
});

test('sample history is created as real Jira data', async () => {
  const s = await seedStatus(P);
  assert.equal(s.completed, SAMPLE_EPICS.length);
  assert.equal(epicCount(), SAMPLE_EPICS.length);
  const billing = [...jira.issues.values()].find((i) => /Stripe Billing/.test(i.fields.summary));
  assert.equal(billing.fields.status.statusCategory.key, 'done');
  assert.ok(billing.properties['hindsight-history'].dueAt);
  assert.match(adfToText(billing.fields.comment.comments[0].body), /idempotency/);
  // re-running a step is idempotent
  await seedStep(P, 0);
  assert.equal(epicCount(), SAMPLE_EPICS.length);
});

test('new payments epic gets a HIGH-risk pre-mortem and a comment (no LLM)', async () => {
  const key = await newEpic('Migrate card payments to Stripe Payment Intents API', 'Move card charges to Payment Intents with webhooks and 3DS.');
  await app.onIssueCreated({ issue: { key } });
  const f = store.get(`forecast:${key}`);
  assert.ok(f, 'forecast stored');
  console.log('similar:', f.similar.map((s) => `${s.key} ${s.summary} ${s.outcome.verdict} slip=${s.outcome.slipDays}`));
  console.log('risk:', f.risk, 'slip:', f.predictedSlipDays, 'conf:', f.confidence, '| experts:', f.experts.map((e) => e.displayName));
  assert.equal(f.similar.length, 3);
  assert.ok(f.similar.every((s) => /payment|billing|paypal|refund|tax|wallet|pay|checkout/i.test(s.summary)), 'similar work is payments work');
  assert.equal(f.risk, 'HIGH');
  assert.ok(f.predictedSlipDays > 5);
  assert.ok(f.lessons.length >= 2, 'fallback lessons from retros');
  assert.ok(f.experts.length >= 2);
  const comments = jira.issues.get(key).fields.comment.comments.map((c) => adfToText(c.body));
  assert.equal(comments.length, 1);
  assert.match(comments[0], /Hindsight pre-mortem: HIGH risk/);
});

test('LLM path: reranks, cites evidence, and invalid keys from the model are dropped', async () => {
  const key = await newEpic('Add Klarna buy-now-pay-later at checkout');
  llmState.reply = (req) => {
    const keys = [...req.messages[1].content.matchAll(/### (PAY-\d+)/g)].map((m) => m[1]);
    return JSON.stringify({
      similar: [{ key: keys[0], why: 'Also a new payment method at checkout.' }, { key: 'FAKE-999', why: 'hallucinated' }],
      headline: `History says multi-currency rounding bit us before (${keys[0]}).`,
      lessons: [{ title: 'Build a currency rounding test matrix before coding', detail: 'Rounding bugs caused the slip.', sourceKey: keys[0] }],
      watchouts: ['Certificate and sandbox differences'],
    });
  };
  const f = await app.getForecastAction({ issueKey: key, refresh: true });
  llmState.reply = null;
  assert.ok(!f.similarPastWork.some((s) => s.key === 'FAKE-999'), 'hallucinated key dropped');
  assert.equal(f.similarPastWork[0].whySimilar, 'Also a new payment method at checkout.');
  assert.match(f.headline, /rounding/);
  assert.equal(f.lessons[0].evidence, f.similarPastWork[0].key);
  const sys = llmState.calls.at(-1).messages[0].content;
  assert.match(sys, /Never invent/);
});

test('LLM that picks an off-domain project and stops at 2 is corrected to 3 same-domain projects', async () => {
  const key = await newEpic('Migrate card payments to Stripe Payment Intents API');
  llmState.reply = (req) => {
    const prompt = req.messages[1].content;
    const keyOf = (re) => prompt.match(new RegExp('### (PAY-\\d+): ' + re))?.[1];
    return JSON.stringify({
      similar: [{ key: keyOf('Migrate subscription billing'), why: 'Stripe' }, { key: keyOf('OAuth2'), why: 'also a migration' }],
      headline: 'x', lessons: [{ title: 'Add idempotency keys', detail: 'd', sourceKey: keyOf('Migrate subscription billing') }],
    });
  };
  const f = await app.getForecastAction({ issueKey: key, refresh: true });
  llmState.reply = null;
  const names = f.similarPastWork.map((s) => s.summary);
  console.log('picked:', names);
  assert.equal(names.length, 3);
  assert.ok(!names.some((n) => /OAuth2/.test(n)), 'OAuth2 never reaches the LLM for payments work');
  assert.match(names[0], /Stripe Billing/);
});

test('lessons become Jira tasks under the epic, exactly once', async () => {
  const key = await newEpic('Migrate invoice payments to Stripe');
  await app.getForecastAction({ issueKey: key, refresh: true });
  const r1 = await app.addLessonsAction({ issueKey: key });
  assert.ok(r1.created.length >= 2);
  for (const c of r1.created) assert.equal(jira.issues.get(c.key).fields.parent.key, key);
  const r2 = await app.addLessonsAction({ issueKey: key });
  assert.match(r2.message, /already added/);
});

test('Rovo/MCP actions work from free text, and experts include Teamwork Graph teams when configured', async () => {
  const sim = await app.findSimilarWorkAction({ description: 'Upgrade our Postgres database to version 17' });
  assert.match(sim.similarPastWork[0].summary, /Postgres/);
  process.env.HINDSIGHT_TWG_TEAMS_QUERY = 'test-query-key';
  // give one expert a real account id so the TWG lookup runs
  const ex = await app.getExpertsAction({ topic: 'payment webhooks Stripe billing' });
  delete process.env.HINDSIGHT_TWG_TEAMS_QUERY;
  assert.ok(ex.experts.length > 0);
  assert.ok(ex.experts.some((e) => /Priya|Sofia/.test(e.name)));
  const bad = await app.findSimilarWorkAction({});
  assert.ok(bad.error);
});

test('forecasts are published to the Teamwork Graph once a connection exists', async () => {
  await app.onConnectionChange({ action: 'CREATED', connectionId: 'conn-1' });
  const key = await newEpic('Stripe Connect payouts for marketplace sellers');
  await app.onIssueCreated({ issue: { key } });
  const obj = twgState.objects.find((o) => o.id === `hindsight-forecast-${key}`);
  assert.ok(obj, 'object written to graph');
  assert.ok(obj.associations.set[0].values.includes(key));
  assert.equal(obj['atlassian:document'].content.mimeType, 'text/plain');
});

test('sample epics and non-epics do not trigger pre-mortems', async () => {
  const before = store.size;
  const sampleKey = [...jira.issues.values()].find((i) => i.fields.labels.includes('hindsight-sample') && i.fields.issuetype.hierarchyLevel === 1).key;
  await app.onIssueCreated({ issue: { key: sampleKey } });
  const { createIssue } = await import('../src/lib/jira.js');
  const t = await createIssue({ project: { key: P }, issuetype: { id: '10001' }, summary: 'A task about Stripe' });
  await app.onIssueCreated({ issue: { key: t.key } });
  assert.equal(store.size, before);
});

test('learning loop scores the forecast when the epic is done', async () => {
  const key = await newEpic('Migrate card refunds to Stripe');
  await app.onIssueCreated({ issue: { key } });
  const issue = jira.issues.get(key);
  issue.fields.duedate = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
  issue.fields.status = { name: 'Done', statusCategory: { key: 'done' } };
  issue.fields.resolutiondate = new Date().toISOString();
  await app.onIssueUpdated({ issue: { key, fields: { status: { statusCategory: { key: 'done' } } } }, changelog: { items: [{ field: 'status' }] } });
  const f = store.get(`forecast:${key}`);
  assert.ok(f.outcome);
  assert.ok(f.outcome.slipDays >= 19);
  assert.equal(f.outcome.actualRisk, 'HIGH');
});

test('cold start: empty site gives an honest answer, not an error', async () => {
  resetJira();
  const r = await app.findSimilarWorkAction({ description: 'Anything' });
  assert.equal(r.risk, 'UNKNOWN');
  assert.match(r.note, /sample history/);
});

test('remove sample data deletes what was created', async () => {
  resetJira();
  store.clear();
  await seedStep(P, 0);
  await seedStep(P, 1);
  const n = jira.issues.size;
  const r = await clearSample(P);
  assert.equal(r.deleted, n);
  assert.equal(jira.issues.size, 0);
});
