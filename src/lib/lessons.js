import { createIssue, getProjectIssueTypes, getIssue } from './jira.js';
import { getForecast, saveForecast } from './forecast.js';
import { textToAdf } from './core.js';

/** Turn forecast lessons into real Jira tasks under the epic. */
export async function addLessonsAsTasks(issueKey, lessonIds, { siteUrl } = {}) {
  const forecast = await getForecast(issueKey, { siteUrl });
  const issue = await getIssue(issueKey);
  const projectKey = issue.fields.project.key;
  const types = await getProjectIssueTypes(projectKey);
  const isEpic = issue.fields.issuetype?.hierarchyLevel === 1;

  const wanted = forecast.lessons.filter(
    (l) => (!lessonIds?.length || lessonIds.includes(l.id)) && !forecast.addedLessons?.[l.id],
  );
  const created = [];
  for (const l of wanted) {
    const evidence = l.sourceKey ? `Evidence: ${l.sourceKey}` : '';
    const res = await createIssue({
      project: { key: projectKey },
      issuetype: { id: types.task.id },
      summary: l.title.slice(0, 250),
      description: textToAdf(`${l.detail}\n\n${evidence}\nAdded by Hindsight from the pre-mortem for ${issueKey}.`),
      ...(isEpic ? { parent: { key: issueKey } } : {}),
    });
    forecast.addedLessons = { ...(forecast.addedLessons || {}), [l.id]: res.key };
    created.push({ lesson: l.title, key: res.key });
  }
  await saveForecast(forecast);
  return { created, forecast };
}
