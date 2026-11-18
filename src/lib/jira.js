import api, { route } from '@forge/api';
import { adfToText, textToAdf } from './core.js';

export const HISTORY_PROP = 'hindsight-history';

/** asUser when a user is present (UI, Rovo, MCP), asApp for triggers. */
export function client(asApp = false) {
  return asApp ? api.asApp() : api.asUser();
}

async function json(res, what) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${what} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Enhanced JQL search (POST /rest/api/3/search/jql) with pagination. */
export async function searchIssues(jql, { fields = [], properties = [], max = 100, asApp = false } = {}) {
  const issues = [];
  let nextPageToken;
  do {
    const res = await client(asApp).requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, properties, maxResults: Math.min(100, max - issues.length), nextPageToken }),
    });
    const data = await json(res, 'JQL search');
    issues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken && issues.length < max);
  return issues;
}

export async function getIssue(key, { asApp = false } = {}) {
  const res = await client(asApp).requestJira(
    route`/rest/api/3/issue/${key}?fields=summary,description,issuetype,project,status,labels,parent,duedate,created,resolutiondate,assignee&properties=${HISTORY_PROP}`,
    { headers: { Accept: 'application/json' } },
  );
  return json(res, `Get issue ${key}`);
}

/** Normalised shape used across the app. */
export function normaliseIssue(raw) {
  const f = raw.fields || {};
  return {
    id: raw.id,
    key: raw.key,
    summary: f.summary || '',
    description: adfToText(f.description).trim(),
    issuetype: f.issuetype?.name || '',
    isEpic: f.issuetype?.hierarchyLevel === 1 || /epic/i.test(f.issuetype?.name || ''),
    projectKey: f.project?.key,
    labels: f.labels || [],
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.key,
    created: f.created,
    duedate: f.duedate,
    resolutiondate: f.resolutiondate,
    assignee: f.assignee ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName } : null,
    parentKey: f.parent?.key,
    comments: (f.comment?.comments || []).map((c) => adfToText(c.body)),
    history: raw.properties?.[HISTORY_PROP] || null,
  };
}

export async function createIssue(fields, { asApp = false, properties } = {}) {
  const res = await client(asApp).requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, ...(properties ? { properties } : {}) }),
  });
  return json(res, 'Create issue');
}

export async function addComment(key, text, { asApp = false } = {}) {
  const res = await client(asApp).requestJira(route`/rest/api/3/issue/${key}/comment`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: textToAdf(text) }),
  });
  return json(res, `Comment on ${key}`);
}

export async function setIssueProperty(key, propKey, value, { asApp = false } = {}) {
  const res = await client(asApp).requestJira(route`/rest/api/3/issue/${key}/properties/${propKey}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Set property on ${key} failed: ${res.status}`);
}

/** Move an issue to the first transition whose target is in the "done" status category. */
export async function transitionToDone(key, { asApp = false } = {}) {
  const res = await client(asApp).requestJira(route`/rest/api/3/issue/${key}/transitions`, {
    headers: { Accept: 'application/json' },
  });
  const data = await json(res, `Transitions for ${key}`);
  const t = (data.transitions || []).find((x) => x.to?.statusCategory?.key === 'done');
  if (!t) return false;
  const r2 = await client(asApp).requestJira(route`/rest/api/3/issue/${key}/transitions`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: t.id } }),
  });
  return r2.ok;
}

/** Issue types available for creation in a project, keyed by role. */
export async function getProjectIssueTypes(projectKey, { asApp = false } = {}) {
  const res = await client(asApp).requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=50`, {
    headers: { Accept: 'application/json' },
  });
  const data = await json(res, `Issue types for ${projectKey}`);
  const types = data.issueTypes || data.values || [];
  const find = (re) => types.find((t) => !t.subtask && re.test(t.name));
  const epic = types.find((t) => t.hierarchyLevel === 1) || find(/epic/i);
  const task = find(/^task$/i) || find(/story/i) || types.find((t) => !t.subtask && t.hierarchyLevel === 0);
  const bug = find(/^bug$/i) || task;
  return { epic, task, bug, all: types };
}

export function issueUrl(siteUrl, key) {
  return siteUrl ? `${siteUrl.replace(/\/$/, '')}/browse/${key}` : `/browse/${key}`;
}
