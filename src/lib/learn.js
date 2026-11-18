// The learning loop: when forecasted work finishes, compare prediction vs reality.
import { kvs } from '@forge/kvs';
import { forecastKey, listForecasts } from './forecast.js';
import { searchIssues, normaliseIssue, getIssue, HISTORY_PROP } from './jira.js';
import { computeOutcome } from './core.js';

export async function recordOutcome(issueKey, { asApp = true } = {}) {
  const forecast = await kvs.get(forecastKey(issueKey));
  if (!forecast || forecast.outcome) return null;
  const raw = await getIssue(issueKey, { asApp });
  const epic = normaliseIssue({
    ...raw,
    fields: { ...raw.fields, resolutiondate: raw.fields.resolutiondate || new Date().toISOString() },
  });
  const children = (await searchIssues(`parent = ${issueKey}`, {
    fields: ['summary', 'issuetype', 'labels', 'assignee', 'parent'],
    properties: [HISTORY_PROP],
    max: 200,
    asApp,
  })).map(normaliseIssue);
  const o = computeOutcome(epic, children);

  const actualRisk = (o.slipDays ?? 0) >= 14 || o.incidents.length ? 'HIGH' : (o.slipDays ?? 0) > 3 ? 'MEDIUM' : 'LOW';
  forecast.outcome = {
    recordedAt: new Date().toISOString(),
    slipDays: o.slipDays,
    incidents: o.incidents.length,
    actualRisk,
    // A forecast "hit" if it called the risk level, or was within one level and the slip estimate within a week.
    hit:
      actualRisk === forecast.risk ||
      (forecast.predictedSlipDays !== null && o.slipDays !== null && Math.abs(forecast.predictedSlipDays - o.slipDays) <= 7),
  };
  await kvs.set(forecastKey(issueKey), forecast);
  return forecast.outcome;
}

export async function accuracy() {
  const all = await listForecasts(100);
  const scored = all.filter((f) => f.outcome);
  return {
    forecasts: all.length,
    scored: scored.length,
    hits: scored.filter((f) => f.outcome.hit).length,
    rate: scored.length ? Math.round((100 * scored.filter((f) => f.outcome.hit).length) / scored.length) : null,
  };
}
