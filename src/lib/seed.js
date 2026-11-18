import { kvs } from '@forge/kvs';
import api, { route } from '@forge/api';
import { SAMPLE_EPICS, SAMPLE_LABEL, sampleHistory } from './sample-data.js';
import { createIssue, addComment, transitionToDone, getProjectIssueTypes, HISTORY_PROP } from './jira.js';
import { textToAdf } from './core.js';

const seedKey = (projectKey) => `seed:${projectKey}`;

export async function seedStatus(projectKey) {
  const s = (await kvs.get(seedKey(projectKey))) || { done: [], keys: [] };
  return { total: SAMPLE_EPICS.length, completed: s.done.length, keys: s.keys };
}

async function createWithFallback(fields, properties) {
  try {
    return await createIssue(fields, { properties });
  } catch (e) {
    // Some team-managed projects don't have labels on the create screen.
    if (fields.labels && /labels/i.test(e.message)) {
      const { labels, ...rest } = fields;
      return createIssue(rest, { properties });
    }
    throw e;
  }
}

/** Create one sample epic (with children, retro, Done status). Called repeatedly from the UI. */
export async function seedStep(projectKey, index) {
  const state = (await kvs.get(seedKey(projectKey))) || { done: [], keys: [] };
  if (state.done.includes(index)) return seedStatus(projectKey);
  const e = SAMPLE_EPICS[index];
  if (!e) throw new Error(`No sample epic #${index}`);

  const types = await getProjectIssueTypes(projectKey);
  if (!types.epic) throw new Error(`Project ${projectKey} has no Epic issue type. Use a Jira software project.`);
  const history = sampleHistory(e);

  const epic = await createWithFallback(
    {
      project: { key: projectKey },
      issuetype: { id: types.epic.id },
      summary: e.summary,
      description: textToAdf(`${e.description}\n\n(Sample history imported by Hindsight — fictional company "Northwind Pay". Owner: ${e.owner}.)`),
      labels: [SAMPLE_LABEL],
    },
    [{ key: HISTORY_PROP, value: history }],
  );
  const created = [epic.key];

  for (const c of e.children) {
    const type = c.kind === 'task' ? types.task : types.bug;
    const labels = [SAMPLE_LABEL, ...(c.kind === 'incident' ? ['incident', c.severity.toLowerCase().replace(/\s/g, '')] : [])];
    const child = await createWithFallback(
      {
        project: { key: projectKey },
        issuetype: { id: type.id },
        parent: { key: epic.key },
        summary: c.kind === 'incident' ? `[${c.severity}] ${c.summary}` : c.summary,
        labels,
      },
      [{ key: HISTORY_PROP, value: { imported: true, kind: c.kind, severity: c.severity || null, fixer: c.fixer || null } }],
    );
    created.push(child.key);
  }

  await addComment(epic.key, e.retro);
  await Promise.all(created.map((k) => transitionToDone(k).catch(() => false)));

  state.done.push(index);
  state.keys.push(...created);
  await kvs.set(seedKey(projectKey), state);
  return seedStatus(projectKey);
}

/** Remove everything the sample loader created in this project. */
export async function clearSample(projectKey) {
  const state = (await kvs.get(seedKey(projectKey))) || { keys: [] };
  const failed = [];
  for (const key of [...state.keys].reverse()) {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?deleteSubtasks=true`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) failed.push(key);
  }
  await kvs.delete(seedKey(projectKey));
  return { deleted: state.keys.length - failed.length, failed };
}
