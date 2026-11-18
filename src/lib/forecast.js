import { kvs, WhereConditions } from '@forge/kvs';
import {
  rankBySimilarity,
  sameDomain,
  computeOutcome,
  scoreRisk,
  findExperts,
  extractLessons,
  slug,
} from './core.js';
import { searchIssues, normaliseIssue, getIssue, HISTORY_PROP, issueUrl } from './jira.js';
import { askJson } from './llm.js';
import { enrichExpertsWithTeams } from './graph.js';

const EPIC_FIELDS = ['summary', 'description', 'labels', 'duedate', 'created', 'resolutiondate', 'assignee', 'comment', 'status', 'issuetype', 'project'];
const CHILD_FIELDS = ['summary', 'issuetype', 'labels', 'assignee', 'parent', 'status'];
const CANDIDATES = 8;
const SHOWN = 3;

// The sample loader appends a provenance note; it must not influence matching.
const cleanDescription = (d = '') => d.replace(/\(Sample history imported by Hindsight[^)]*\)/g, '');

export const forecastKey = (issueKey) => `forecast:${issueKey}`;

/** All finished epics on the site the caller can see: the organisation's memory. */
export async function loadHistory({ asApp = false, excludeKey } = {}) {
  const jql = `issuetype = Epic AND statusCategory = Done${excludeKey ? ` AND key != ${excludeKey}` : ''} ORDER BY resolutiondate DESC`;
  const raw = await searchIssues(jql, { fields: EPIC_FIELDS, properties: [HISTORY_PROP], max: 200, asApp });
  return raw.map(normaliseIssue);
}

async function loadChildren(epicKeys, { asApp }) {
  if (!epicKeys.length) return new Map();
  const raw = await searchIssues(`parent in (${epicKeys.join(',')})`, {
    fields: CHILD_FIELDS,
    properties: [HISTORY_PROP],
    max: 400,
    asApp,
  });
  const byParent = new Map();
  for (const r of raw.map(normaliseIssue)) {
    if (!byParent.has(r.parentKey)) byParent.set(r.parentKey, []);
    byParent.get(r.parentKey).push(r);
  }
  return byParent;
}

const SYSTEM = `You are Hindsight, an assistant that runs evidence-based pre-mortems for software teams.
You receive a NEW piece of work and a list of PAST projects from the same organisation with their measured outcomes
(schedule slip, incidents, bugs) and retrospective notes.
Rules:
- Use ONLY the evidence provided. Never invent projects, numbers, people or incidents.
- Only quote numbers that appear verbatim in the evidence (e.g. "28 days late"). Do not compute percentages, averages or ranges.
- Similarity means the same business domain and kind of change (e.g. payments work for payments work).
  Prefer a same-domain project over one that merely shares a generic word such as "migration" or "upgrade".
- Cite past work by its issue key (e.g. PAY-12) whenever you make a claim.
- Lessons must be concrete, actionable tasks a team could add to their backlog today.
Reply with a single JSON object and nothing else.`;

function buildPrompt(target, candidates) {
  const past = candidates
    .map(({ outcome: o, lexical }) => {
      const slip = o.slipDays === null ? 'unknown' : o.slipDays > 0 ? `${o.slipDays} days late` : `${-o.slipDays} days early/on time`;
      const inc = o.incidents.length ? o.incidents.map((i) => `${i.key} ${i.severity || ''} "${i.summary}" (fixed by ${i.fixer || 'unknown'})`).join('; ') : 'none';
      return `### ${o.key}: ${o.summary}
text-match score: ${lexical.toFixed(2)}
planned: ${o.plannedDays ?? '?'} days, actual: ${o.durationDays ?? '?'} days, schedule: ${slip}
bugs: ${o.bugCount}, incidents: ${inc}
owner: ${o.owner || 'unknown'}
retro notes: ${o.retro || '(none recorded)'}`;
    })
    .join('\n\n');

  return `NEW WORK
Title: ${target.title}
Description: ${(target.description || '(none)').slice(0, 2000)}

PAST PROJECTS (candidates, pre-ranked by text similarity)
${past}

Return JSON:
{
  "similar": [{"key": "<past key>", "why": "<one sentence: why it is genuinely comparable>"}],   // exactly ${SHOWN} when ${SHOWN} or more candidates are comparable, most relevant first
  "headline": "<one or two sentences: what history predicts for the new work, citing keys>",
  "lessons": [{"title": "<imperative backlog task, max 80 chars>", "detail": "<why, citing the evidence>", "sourceKey": "<past key>"}],  // 3 to 5
  "watchouts": ["<short risk to monitor, citing keys>"]  // 0 to 3
}`;
}

/**
 * Core analysis used by the panel, Rovo actions and MCP tools.
 * target: { title, description, excludeKey }
 */
export async function analyze(target, { asApp = false, siteUrl, useLlm = true } = {}) {
  const history = await loadHistory({ asApp, excludeKey: target.excludeKey });
  if (!history.length) {
    return { coldStart: true, indexed: 0, similar: [], lessons: [], experts: [], watchouts: [], ...scoreRisk([]) };
  }

  const ranked = rankBySimilarity(
    `${target.title} ${target.title} ${target.description || ''}`,
    history.map((h) => ({ id: h.key, text: `${h.summary} ${h.summary} ${h.labels.join(' ')} ${cleanDescription(h.description).slice(0, 1500)}` })),
  ).filter((r) => r.score > 0.03);

  const byKey = new Map(history.map((h) => [h.key, h]));
  const epicText = (h) => `${h.summary} ${h.labels.join(' ')} ${cleanDescription(h.description).slice(0, 1500)}`;
  // Same business domain first (payments work is compared with payments work), then text similarity.
  const top = sameDomain(`${target.title} ${target.description || ''}`, ranked, (r) => epicText(byKey.get(r.id))).slice(0, CANDIDATES);
  const children = await loadChildren(top.map((t) => t.id), { asApp });
  const candidates = top.map((t) => ({
    lexical: t.score,
    outcome: computeOutcome(byKey.get(t.id), children.get(t.id) || []),
  }));

  let ai = null;
  if (useLlm && candidates.length) ai = await askJson(SYSTEM, buildPrompt(target, candidates));

  const candByKey = new Map(candidates.map((c) => [c.outcome.key, c]));
  let picked;
  if (ai?.similar?.length) {
    picked = ai.similar
      .filter((s) => candByKey.has(s.key))
      .slice(0, SHOWN)
      .map((s) => ({ ...candByKey.get(s.key), why: s.why }));
    // Top up with the strongest remaining same-domain candidates so the forecast rests on enough evidence.
    for (const c of candidates) {
      if (picked.length >= SHOWN) break;
      if (!picked.some((p) => p.outcome.key === c.outcome.key) && c.lexical >= 0.1) {
        picked.push({ ...c, why: 'Same business domain and similar scope.' });
      }
    }
  }
  if (!picked?.length) {
    picked = candidates.slice(0, SHOWN).map((c) => ({ ...c, why: 'Similar scope and wording to the new work.' }));
  }

  const similar = picked.map((c) => ({
    key: c.outcome.key,
    summary: c.outcome.summary,
    url: issueUrl(siteUrl, c.outcome.key),
    similarity: Math.round(c.lexical * 100) / 100,
    why: c.why,
    outcome: c.outcome,
  }));

  const risk = scoreRisk(similar);
  const validKeys = new Set(similar.map((s) => s.key));
  let lessons = (ai?.lessons || [])
    .filter((l) => l?.title)
    .map((l) => ({ title: String(l.title).slice(0, 120), detail: String(l.detail || ''), sourceKey: validKeys.has(l.sourceKey) ? l.sourceKey : null }));
  if (!lessons.length) lessons = extractLessons(similar);
  lessons = lessons.slice(0, 5).map((l, i) => ({ ...l, id: `${i}-${slug(l.title).slice(0, 30)}` }));

  const experts = await enrichExpertsWithTeams(findExperts(similar), { asApp });

  return {
    coldStart: false,
    indexed: history.length,
    headline: ai?.headline || defaultHeadline(risk, similar),
    watchouts: Array.isArray(ai?.watchouts) ? ai.watchouts.slice(0, 3) : [],
    aiUsed: Boolean(ai),
    similar,
    lessons,
    experts,
    ...risk,
  };
}

function defaultHeadline(risk, similar) {
  if (!similar.length) return 'No comparable past work found yet.';
  const late = similar.filter((s) => (s.outcome.slipDays ?? 0) > 3).length;
  const inc = similar.reduce((a, s) => a + s.outcome.incidents.length, 0);
  return `${late} of ${similar.length} similar past projects shipped late and they produced ${inc} incident(s). Risk looks ${risk.risk.toLowerCase()}.`;
}

/** Forecast for an existing Jira work item, cached in Forge storage. */
export async function getForecast(issueKey, { asApp = false, siteUrl, refresh = false } = {}) {
  if (!refresh) {
    const cached = await kvs.get(forecastKey(issueKey));
    if (cached) return cached;
  }
  const issue = normaliseIssue(await getIssue(issueKey, { asApp }));
  const result = await analyze({ title: issue.summary, description: issue.description, excludeKey: issueKey }, { asApp, siteUrl });
  const prev = await kvs.get(forecastKey(issueKey));
  const forecast = {
    ...result,
    issueKey,
    issueSummary: issue.summary,
    projectKey: issue.projectKey,
    generatedAt: new Date().toISOString(),
    addedLessons: prev?.addedLessons || {},
    outcome: prev?.outcome || null,
  };
  await kvs.set(forecastKey(issueKey), forecast);
  return forecast;
}

export async function saveForecast(forecast) {
  await kvs.set(forecastKey(forecast.issueKey), forecast);
}

/** Recent forecasts for the dashboard. */
export async function listForecasts(limit = 20) {
  const res = await kvs.query().where('key', WhereConditions.beginsWith('forecast:')).limit(limit).getMany();
  return (res.results || []).map((r) => r.value).sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
}
