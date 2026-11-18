// Teamwork Graph integration.
//  READ : who the experts are and which teams they sit in (persisted Cypher query via requestTeamworkGraph)
//  WRITE: every forecast is published into the graph as a document associated with the epic,
//         so Rovo Search / other agents can find "what history predicted" for that work item.
// Both paths are best-effort: Hindsight works without them and the UI shows whether they are live.
import api from '@forge/api';
import { graph } from '@forge/teamwork-graph';
import { kvs } from '@forge/kvs';

export const CONNECTION_KEY = 'twg:connectionId';
const STATUS_KEY = 'twg:status';

// Registered in the TWG Query Builder (https://teamwork-graph.atlassian.com/query-builder) — see README.
// Cypher:
//   MATCH (user:AtlassianUser {ari: $id})-[:atlassian_user_is_in_atlassian_team]->(team:AtlassianTeam)
//   RETURN collect(distinct team) as teams
const TEAMS_QUERY = `query hindsight_userTeams($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges { node { columns { key value {
      __typename
      ... on CypherQueryResultListNode { nodes { id data { __typename ... on AtlassianTeam { id displayName } } } }
    } } } }
  }
}`;

async function recordStatus(patch) {
  const cur = (await kvs.get(STATUS_KEY).catch(() => null)) || {};
  await kvs.set(STATUS_KEY, { ...cur, ...patch, at: new Date().toISOString() }).catch(() => {});
}

export async function getGraphStatus() {
  const [status, connectionId] = await Promise.all([kvs.get(STATUS_KEY).catch(() => null), kvs.get(CONNECTION_KEY).catch(() => null)]);
  return {
    readConfigured: Boolean(process.env.HINDSIGHT_TWG_TEAMS_QUERY),
    writeConnected: Boolean(connectionId),
    ...(status || {}),
  };
}

async function teamsForUser(accountId, asApp) {
  const queryKey = process.env.HINDSIGHT_TWG_TEAMS_QUERY;
  if (!queryKey || !accountId) return [];
  const requester = asApp ? api.asApp() : api.asUser();
  const res = await requester.requestTeamworkGraph(TEAMS_QUERY, {
    queryKey,
    queryParams: { id: `ari:cloud:identity::user/${accountId}` },
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  const teams = [];
  for (const edge of body?.data?.customQuery?.edges || []) {
    for (const col of edge.node?.columns || []) {
      for (const n of col.value?.nodes || []) if (n.data?.displayName) teams.push(n.data.displayName);
    }
  }
  return [...new Set(teams)];
}

/** Adds `teams` to each expert using the Teamwork Graph. Never throws. */
export async function enrichExpertsWithTeams(experts, { asApp = false } = {}) {
  if (!process.env.HINDSIGHT_TWG_TEAMS_QUERY) return experts;
  try {
    const out = await Promise.all(experts.map(async (e) => ({ ...e, teams: e.accountId ? await teamsForUser(e.accountId, asApp) : [] })));
    await recordStatus({ lastReadOk: true, lastReadError: null });
    return out;
  } catch (err) {
    console.warn('TWG read failed:', err?.message);
    await recordStatus({ lastReadOk: false, lastReadError: String(err?.message || err).slice(0, 200) });
    return experts;
  }
}

/** Publish a forecast into the Teamwork Graph, linked to its work item. Never throws. */
export async function publishForecastToGraph(forecast, siteUrl) {
  const connectionId = await kvs.get(CONNECTION_KEY).catch(() => null);
  if (!connectionId) return { published: false, reason: 'No Teamwork Graph connection configured' };
  const now = new Date().toISOString();
  const text = [
    `Hindsight forecast for ${forecast.issueKey}: ${forecast.issueSummary}`,
    `Risk: ${forecast.risk}. Predicted slip: ${forecast.predictedSlipDays ?? 'n/a'} days. Confidence: ${forecast.confidence}.`,
    forecast.headline,
    'Similar past work: ' + forecast.similar.map((s) => `${s.key} (${s.outcome.verdict})`).join(', '),
    'Lessons: ' + forecast.lessons.map((l) => l.title).join(' | '),
  ].join('\n');
  try {
    const res = await graph.setObjects({
      connectionId,
      objects: [
        {
          schemaVersion: '1.0',
          id: `hindsight-forecast-${forecast.issueKey}`,
          updateSequenceNumber: Date.now(),
          displayName: `Hindsight forecast: ${forecast.issueKey} ${forecast.issueSummary}`.slice(0, 250),
          description: forecast.headline?.slice(0, 1000),
          url: siteUrl ? `${siteUrl.replace(/\/$/, '')}/browse/${forecast.issueKey}` : `https://atlassian.net/browse/${forecast.issueKey}`,
          createdAt: forecast.generatedAt || now,
          lastUpdatedAt: now,
          permissions: { accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }] },
          associations: { lastUpdatedAt: now, set: [{ associationType: 'issueIdOrKeys', values: [forecast.issueKey, ...forecast.similar.map((s) => s.key)] }] },
          'atlassian:document': {
            type: { category: 'DOCUMENT', mimeType: 'text/plain' },
            content: { mimeType: 'text/plain', text },
            labels: ['hindsight', `risk-${String(forecast.risk).toLowerCase()}`],
          },
        },
      ],
    });
    const ok = res?.success !== false;
    await recordStatus({ lastWriteOk: ok, lastWriteError: ok ? null : JSON.stringify(res).slice(0, 200) });
    return { published: ok };
  } catch (err) {
    console.warn('TWG write failed:', err?.message);
    await recordStatus({ lastWriteOk: false, lastWriteError: String(err?.message || err).slice(0, 200) });
    return { published: false, reason: err?.message };
  }
}

/** graph:connector lifecycle: remember the connection an admin created. */
export async function onConnectionChange(event) {
  const { action, connectionId } = event || {};
  if (action === 'DELETED') await kvs.delete(CONNECTION_KEY);
  else if (connectionId) await kvs.set(CONNECTION_KEY, connectionId);
  await recordStatus({ connectionAction: action });
}
