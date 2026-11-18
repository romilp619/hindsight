import ResolverModule from '@forge/resolver';
import { getAppContext } from '@forge/api';
import { getForecast, analyze, listForecasts, loadHistory } from './lib/forecast.js';
import { addLessonsAsTasks } from './lib/lessons.js';
import { seedStep, seedStatus, clearSample } from './lib/seed.js';
import { recordOutcome, accuracy } from './lib/learn.js';
import { publishForecastToGraph, getGraphStatus, onConnectionChange as twgConnectionChange } from './lib/graph.js';
import { getIssue, addComment, normaliseIssue } from './lib/jira.js';
import { SAMPLE_LABEL } from './lib/sample-data.js';

// ---------------------------------------------------------------------------
// UI resolvers (issue panel + project page)
// ---------------------------------------------------------------------------
// CJS/ESM interop: works both in the Forge bundler and under plain Node (tests).
const Resolver = ResolverModule.default || ResolverModule;
const resolver = new Resolver();

const issueKeyOf = (req) => req.payload?.issueKey || req.context?.extension?.issue?.key;
const projectKeyOf = (req) => req.payload?.projectKey || req.context?.extension?.project?.key;
const siteOf = (req) => req.context?.siteUrl || null;

resolver.define('getForecast', async (req) => {
  const issueKey = issueKeyOf(req);
  const forecast = await getForecast(issueKey, { siteUrl: siteOf(req), refresh: Boolean(req.payload?.refresh) });
  if (req.payload?.refresh) await publishForecastToGraph(forecast, siteOf(req));
  return forecast;
});

resolver.define('addLessons', async (req) => {
  const { created, forecast } = await addLessonsAsTasks(issueKeyOf(req), req.payload?.lessonIds, { siteUrl: siteOf(req) });
  return { created, forecast };
});

resolver.define('getDashboard', async (req) => {
  const projectKey = projectKeyOf(req);
  const [history, forecasts, acc, seed, graph] = await Promise.all([
    loadHistory().catch(() => []),
    listForecasts(25),
    accuracy(),
    projectKey ? seedStatus(projectKey) : null,
    getGraphStatus(),
  ]);
  let mcpUrl = null;
  try {
    mcpUrl = `https://mcp.atlassian.com/forge/${String(getAppContext().appAri).split('/').pop()}`;
  } catch {
    /* not available outside Forge runtime */
  }
  return {
    projectKey,
    mcpUrl,
    indexed: history.length,
    sampleIndexed: history.filter((h) => h.history?.imported).length,
    forecasts: forecasts.map((f) => ({
      issueKey: f.issueKey,
      issueSummary: f.issueSummary,
      risk: f.risk,
      predictedSlipDays: f.predictedSlipDays,
      generatedAt: f.generatedAt,
      outcome: f.outcome,
    })),
    accuracy: acc,
    seed,
    graph,
  };
});

resolver.define('seedStep', async (req) => seedStep(projectKeyOf(req), Number(req.payload.index)));
resolver.define('clearSample', async (req) => clearSample(projectKeyOf(req)));

resolver.define('tryIdea', async (req) => {
  // "What would history say about…?" without creating an issue.
  const { title, description } = req.payload || {};
  return analyze({ title, description }, { siteUrl: siteOf(req) });
});

export const handler = resolver.getDefinitions();

// ---------------------------------------------------------------------------
// Rovo actions — also exposed as MCP tools via the rovo:mcp module
// ---------------------------------------------------------------------------
const brief = (r) => ({
  risk: r.risk,
  predictedSlipDays: r.predictedSlipDays,
  confidence: r.confidence,
  basedOnPastProjects: r.basedOn,
  headline: r.headline,
  similarPastWork: r.similar.map((s) => ({
    key: s.key,
    summary: s.summary,
    whySimilar: s.why,
    outcome: {
      verdict: s.outcome.verdict,
      slipDays: s.outcome.slipDays,
      bugs: s.outcome.bugCount,
      incidents: s.outcome.incidents.map((i) => `${i.key} ${i.severity || ''} ${i.summary}`.trim()),
      retro: s.outcome.retro?.slice(0, 600),
    },
  })),
  lessons: r.lessons.map((l) => ({ id: l.id, title: l.title, detail: l.detail, evidence: l.sourceKey })),
  watchouts: r.watchouts,
  peopleWhoHaveDoneThisBefore: r.experts.map((e) => ({ name: e.displayName, accountId: e.accountId, why: e.reason, teams: e.teams })),
  note: r.coldStart ? 'No finished epics found on this site yet. Load sample history from the Hindsight project page.' : undefined,
});

const contextIssueKey = (payload) =>
  payload?.issueKey || payload?.context?.jira?.issueKey || payload?.context?.issueKey;

export async function findSimilarWorkAction(payload) {
  if (!payload?.description) return { error: 'Provide a short description of the planned work.' };
  const r = await analyze({ title: payload.description, description: payload.details || '' });
  return brief(r);
}

export async function getForecastAction(payload) {
  const key = contextIssueKey(payload);
  if (!key) return { error: 'Which work item? Provide an issue key such as PAY-123.' };
  const f = await getForecast(key, { refresh: payload?.refresh === true });
  return { issueKey: key, issueSummary: f.issueSummary, ...brief(f), alreadyAddedAsTasks: f.addedLessons };
}

export async function addLessonsAction(payload) {
  const key = contextIssueKey(payload);
  if (!key) return { error: 'Which work item? Provide an issue key such as PAY-123.' };
  const ids = payload?.lessonIds ? String(payload.lessonIds).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const { created } = await addLessonsAsTasks(key, ids);
  return created.length
    ? { message: `Created ${created.length} task(s) from past lessons.`, created }
    : { message: 'All lessons for this work item were already added as tasks.' };
}

export async function getExpertsAction(payload) {
  if (!payload?.topic) return { error: 'Provide the topic or planned work.' };
  const r = await analyze({ title: payload.topic }, { useLlm: false });
  return {
    topic: payload.topic,
    experts: r.experts.map((e) => ({ name: e.displayName, accountId: e.accountId, why: e.reason, teams: e.teams })),
    basedOn: r.similar.map((s) => `${s.key} ${s.summary}`),
  };
}

// ---------------------------------------------------------------------------
// Product event triggers
// ---------------------------------------------------------------------------
const RISK_EMOJI = { HIGH: '🔴', MEDIUM: '🟠', LOW: '🟢' };

/** New epic created → run the pre-mortem automatically and leave a short note. */
export async function onIssueCreated(event) {
  const key = event?.issue?.key;
  if (!key) return;
  const issue = normaliseIssue(await getIssue(key, { asApp: true }));
  if (!issue.isEpic || issue.labels.includes(SAMPLE_LABEL) || issue.history?.imported) return;

  const f = await getForecast(key, { asApp: true, refresh: true });
  await publishForecastToGraph(f);
  if (f.coldStart || !f.similar.length) return;

  const late = f.similar.filter((s) => (s.outcome.slipDays ?? 0) > 3).length;
  const incidents = f.similar.reduce((a, s) => a + s.outcome.incidents.length, 0);
  const lines = [
    `${RISK_EMOJI[f.risk] || '🔮'} Hindsight pre-mortem: ${f.risk} risk${f.predictedSlipDays ? ` (history suggests ~${f.predictedSlipDays} days of slip)` : ''}.`,
    `${late} of ${f.similar.length} similar past projects shipped late and they caused ${incidents} incident(s): ${f.similar.map((s) => s.key).join(', ')}.`,
    f.lessons[0] ? `Top lesson: ${f.lessons[0].title}` : '',
    'Open the Hindsight panel on this epic to see the evidence and add the lessons as tasks in one click.',
  ].filter(Boolean);
  await addComment(key, lines.join('\n'), { asApp: true });
}

/** Epic finished → score the forecast against what really happened. */
export async function onIssueUpdated(event) {
  const key = event?.issue?.key;
  const changedStatus = (event?.changelog?.items || []).some((i) => i.field === 'status' || i.fieldId === 'status');
  if (!key || !changedStatus) return;
  const cat = event?.issue?.fields?.status?.statusCategory?.key;
  if (cat && cat !== 'done') return;
  await recordOutcome(key, { asApp: true });
}

// ---------------------------------------------------------------------------
// Teamwork Graph connector lifecycle
// ---------------------------------------------------------------------------
export async function onConnectionChange(event) {
  await twgConnectionChange(event);
}
