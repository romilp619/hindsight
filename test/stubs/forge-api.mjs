// A small in-memory Jira Cloud that understands the REST calls Hindsight makes.
export const jira = { issues: new Map(), seq: 1, calls: [] };

export function resetJira() {
  jira.issues.clear();
  jira.seq = 1;
  jira.calls.length = 0;
}

const TYPES = [
  { id: '10000', name: 'Epic', hierarchyLevel: 1, subtask: false },
  { id: '10001', name: 'Task', hierarchyLevel: 0, subtask: false },
  { id: '10002', name: 'Bug', hierarchyLevel: 0, subtask: false },
  { id: '10003', name: 'Subtask', hierarchyLevel: -1, subtask: true },
];

export function route(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(values[i]) : ''), '');
}

const resp = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body ?? ''),
});

function matchJql(jql) {
  const all = [...jira.issues.values()];
  let m;
  if ((m = jql.match(/^parent in \(([^)]*)\)/i))) {
    const keys = new Set(m[1].split(',').map((s) => s.trim()));
    return all.filter((i) => keys.has(i.fields.parent?.key));
  }
  if ((m = jql.match(/^parent = (\S+)/i))) return all.filter((i) => i.fields.parent?.key === m[1]);
  if (/^issuetype = Epic AND statusCategory = Done/i.test(jql)) {
    const ex = jql.match(/key != (\S+)/i)?.[1];
    return all
      .filter((i) => i.fields.issuetype.hierarchyLevel === 1 && i.fields.status.statusCategory.key === 'done' && i.key !== ex)
      .sort((a, b) => (b.fields.resolutiondate || '').localeCompare(a.fields.resolutiondate || ''));
  }
  throw new Error(`Fake Jira cannot parse JQL: ${jql}`);
}

function view(issue, properties = []) {
  const props = {};
  for (const p of properties) if (issue.properties[p] !== undefined) props[p] = issue.properties[p];
  return { id: issue.id, key: issue.key, fields: structuredClone(issue.fields), properties: props };
}

export function createFakeIssue({ project = 'PAY', type = 'Task', summary, description, parent, labels = [], properties = {}, assignee = null, duedate = null }) {
  const id = String(10000 + jira.seq);
  const key = `${project}-${jira.seq++}`;
  const t = TYPES.find((x) => x.name === type || x.id === type);
  const issue = {
    id,
    key,
    fields: {
      summary,
      description,
      issuetype: t,
      project: { key: project },
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      labels,
      parent: parent ? { key: parent } : undefined,
      created: new Date().toISOString(),
      resolutiondate: null,
      duedate,
      assignee,
      comment: { comments: [] },
    },
    properties: { ...properties },
  };
  jira.issues.set(key, issue);
  return issue;
}

async function requestJira(path, opts = {}) {
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  jira.calls.push({ method, path });
  const [p, qs] = path.split('?');
  const query = new URLSearchParams(qs || '');
  let m;

  if (p === '/rest/api/3/search/jql' && method === 'POST') {
    const hits = matchJql(body.jql).slice(0, body.maxResults || 50);
    return resp(200, { issues: hits.map((i) => view(i, body.properties)) });
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/createmeta\/([^/]+)\/issuetypes$/))) return resp(200, { issueTypes: TYPES });
  if (p === '/rest/api/3/issue' && method === 'POST') {
    const f = body.fields;
    if (f.parent && !jira.issues.has(f.parent.key)) return resp(400, { errors: { parent: 'not found' } });
    const props = Object.fromEntries((body.properties || []).map((x) => [x.key, x.value]));
    const issue = createFakeIssue({
      project: f.project.key,
      type: f.issuetype.id || f.issuetype.name,
      summary: f.summary,
      description: f.description,
      parent: f.parent?.key,
      labels: f.labels,
      properties: props,
    });
    return resp(201, { id: issue.id, key: issue.key });
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/)) && method === 'POST') {
    const issue = jira.issues.get(decodeURIComponent(m[1]));
    issue.fields.comment.comments.push({ body: body.body });
    return resp(201, { id: String(issue.fields.comment.comments.length) });
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/))) {
    const issue = jira.issues.get(decodeURIComponent(m[1]));
    if (method === 'GET') return resp(200, { transitions: [{ id: '21', to: { statusCategory: { key: 'indeterminate' } } }, { id: '31', to: { statusCategory: { key: 'done' } } }] });
    if (body.transition.id === '31') {
      issue.fields.status = { name: 'Done', statusCategory: { key: 'done' } };
      issue.fields.resolutiondate = new Date().toISOString();
    }
    return resp(204, null);
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)\/properties\/([^/]+)$/)) && method === 'PUT') {
    jira.issues.get(decodeURIComponent(m[1])).properties[decodeURIComponent(m[2])] = body;
    return resp(200, {});
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)$/))) {
    const key = decodeURIComponent(m[1]);
    const issue = jira.issues.get(key);
    if (!issue) return resp(404, { errorMessages: ['Issue does not exist'] });
    if (method === 'DELETE') {
      jira.issues.delete(key);
      return resp(204, null);
    }
    return resp(200, view(issue, (query.get('properties') || '').split(',').filter(Boolean)));
  }
  return resp(404, { error: `Fake Jira: unhandled ${method} ${path}` });
}

export const twgQueries = [];
async function requestTeamworkGraph(query, variables) {
  twgQueries.push({ query, variables });
  const teams = { 'acc-priya': ['Payments Platform'], 'acc-sofia': ['Billing'] };
  const id = variables.queryParams.id.split('/').pop();
  return resp(200, {
    data: { customQuery: { edges: [{ node: { columns: [{ key: 'teams', value: { nodes: (teams[id] || []).map((t) => ({ id: t, data: { displayName: t } })) } }] } }] } },
  });
}

export const getAppContext = () => ({ appAri: { toString: () => 'ari:cloud:ecosystem::app/test-app-id' } });
const client = { requestJira, requestTeamworkGraph };
const api = { asUser: () => client, asApp: () => client };
export default api;
