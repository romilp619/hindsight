import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Stack,
  Inline,
  Heading,
  Text,
  Strong,
  Lozenge,
  Button,
  LoadingButton,
  Checkbox,
  SectionMessage,
  Link,
  User,
  Spinner,
  Tag,
  TagGroup,
  Tooltip,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const RISK_APPEARANCE = { HIGH: 'removed', MEDIUM: 'moved', LOW: 'success', UNKNOWN: 'default' };
const VERDICT = {
  late: { text: 'Shipped late', appearance: 'moved' },
  'on-time': { text: 'On time', appearance: 'success' },
  incident: { text: 'Caused incident', appearance: 'removed' },
  'late+incident': { text: 'Late + incident', appearance: 'removed' },
  unknown: { text: 'Outcome unknown', appearance: 'default' },
};

const card = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  padding: 'space.150',
});
const hero = xcss({
  backgroundColor: 'color.background.neutral.subtle.hovered',
  borderRadius: 'border.radius.200',
  padding: 'space.200',
});

function slipText(d) {
  if (d === null || d === undefined) return 'no due date';
  if (d > 0) return `+${d} days late`;
  if (d < 0) return `${-d} days early`;
  return 'on the day';
}

function SimilarCard({ s }) {
  const o = s.outcome;
  const v = VERDICT[o.verdict] || VERDICT.unknown;
  return (
    <Box xcss={card}>
      <Stack space="space.075">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Link href={s.url} openNewTab>{s.key}</Link>
          <Text weight="medium">{s.summary}</Text>
        </Inline>
        <Inline space="space.075" shouldWrap>
          <Lozenge appearance={v.appearance}>{v.text}</Lozenge>
          <Lozenge>{slipText(o.slipDays)}</Lozenge>
          {o.bugCount > 0 && <Lozenge appearance="moved">{o.bugCount} {o.bugCount === 1 ? 'bug' : 'bugs'}</Lozenge>}
          {o.incidents.length > 0 && (
            <Lozenge appearance="removed">
              {o.incidents.length} {o.incidents.length === 1 ? 'incident' : 'incidents'}
            </Lozenge>
          )}
        </Inline>
        <Text size="small" color="color.text.subtle">Why it's comparable: {s.why}</Text>
        {o.incidents.map((i) => (
          <Text key={i.key} size="small">
            ⚠️ <Link href={s.url.replace(s.key, i.key)} openNewTab>{i.key}</Link> {i.summary}
          </Text>
        ))}
      </Stack>
    </Box>
  );
}

function App() {
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState({});
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState([]);

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const f = await invoke('getForecast', { refresh });
      setForecast(f);
      const sel = {};
      (f.lessons || []).forEach((l) => (sel[l.id] = !f.addedLessons?.[l.id]));
      setSelected(sel);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(false);
  }, []);

  const addLessons = async () => {
    setAdding(true);
    try {
      const ids = Object.keys(selected).filter((k) => selected[k]);
      const res = await invoke('addLessons', { lessonIds: ids });
      setCreated(res.created);
      setForecast(res.forecast);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text>Reading your organisation's history…</Text>
      </Inline>
    );
  }

  if (error) {
    return (
      <SectionMessage appearance="error" title="Hindsight couldn't build a forecast">
        <Text>{error}</Text>
        <Button onClick={() => load(true)}>Try again</Button>
      </SectionMessage>
    );
  }

  const f = forecast;
  if (f.coldStart) {
    return (
      <SectionMessage appearance="discovery" title="Hindsight needs some history">
        <Text>
          No finished epics are visible on this site yet, so there is nothing to learn from. Open the Hindsight page in
          the project sidebar to load sample history, or come back once your first epics are done.
        </Text>
      </SectionMessage>
    );
  }

  const pending = (f.lessons || []).filter((l) => !f.addedLessons?.[l.id]);
  const nSelected = pending.filter((l) => selected[l.id]).length;

  return (
    <Stack space="space.200">
      <Box xcss={hero}>
        <Stack space="space.100">
          <Inline space="space.100" alignBlock="center" spread="space-between">
            <Inline space="space.100" alignBlock="center">
              <Lozenge appearance={RISK_APPEARANCE[f.risk]} isBold>{f.risk} RISK</Lozenge>
              {f.predictedSlipDays !== null && f.predictedSlipDays > 0 && (
                <Text weight="bold">~{f.predictedSlipDays} days of slip predicted</Text>
              )}
            </Inline>
            <Tooltip content="Re-run the pre-mortem against the latest history">
              <LoadingButton appearance="subtle" spacing="compact" isLoading={refreshing} onClick={() => load(true)}>
                Refresh
              </LoadingButton>
            </Tooltip>
          </Inline>
          <Text>{f.headline}</Text>
          <Text size="small" color="color.text.subtlest">
            Based on {f.basedOn} comparable project(s) out of {f.indexed} finished epics · confidence {f.confidence}
            {f.aiUsed ? '' : ' · AI summary unavailable, showing data-only forecast'}
          </Text>
        </Stack>
      </Box>

      {f.outcome && (
        <SectionMessage appearance={f.outcome.hit ? 'success' : 'warning'} title="How did the forecast do?">
          <Text>
            Predicted {f.risk} risk; actual outcome {f.outcome.actualRisk} ({slipText(f.outcome.slipDays)}, {f.outcome.incidents} incident(s)).
            {f.outcome.hit ? ' Hindsight called it.' : ' Hindsight missed this one and will weigh it next time.'}
          </Text>
        </SectionMessage>
      )}

      {f.watchouts?.length > 0 && (
        <SectionMessage appearance="warning" title="Watch out for">
          <Stack space="space.050">
            {f.watchouts.map((w, i) => (
              <Text key={i}>• {w}</Text>
            ))}
          </Stack>
        </SectionMessage>
      )}

      <Stack space="space.100">
        <Heading size="xsmall">What happened last time</Heading>
        {f.similar.map((s) => (
          <SimilarCard key={s.key} s={s} />
        ))}
      </Stack>

      <Stack space="space.100">
        <Heading size="xsmall">Lessons → tasks</Heading>
        {f.lessons.map((l) => {
          const addedKey = f.addedLessons?.[l.id];
          return (
            <Box key={l.id} xcss={card}>
              <Stack space="space.050">
                {addedKey ? (
                  <Inline space="space.100" alignBlock="center">
                    <Lozenge appearance="success">Added</Lozenge>
                    <Link href={`/browse/${addedKey}`} openNewTab>{addedKey}</Link>
                    <Text>{l.title}</Text>
                  </Inline>
                ) : (
                  <Checkbox
                    label={l.title}
                    isChecked={Boolean(selected[l.id])}
                    onChange={() => setSelected({ ...selected, [l.id]: !selected[l.id] })}
                  />
                )}
                <Text size="small" color="color.text.subtle">
                  {l.detail}
                  {l.sourceKey ? ` (evidence: ${l.sourceKey})` : ''}
                </Text>
              </Stack>
            </Box>
          );
        })}
        {pending.length > 0 && (
          <Inline>
            <LoadingButton appearance="primary" isLoading={adding} isDisabled={!nSelected} onClick={addLessons}>
              Add {nSelected} lesson{nSelected === 1 ? '' : 's'} as tasks
            </LoadingButton>
          </Inline>
        )}
        {created.length > 0 && (
          <SectionMessage appearance="success" title={`Created ${created.length} task(s)`}>
            <Text>{created.map((c) => c.key).join(', ')}: lessons from the past are now part of the plan.</Text>
          </SectionMessage>
        )}
      </Stack>

      {f.experts?.length > 0 && (
        <Stack space="space.100">
          <Heading size="xsmall">People who've done this before</Heading>
          {f.experts.map((e) => (
            <Box key={e.accountId || e.displayName} xcss={card}>
              <Stack space="space.050">
                {e.accountId ? <User accountId={e.accountId} /> : <Text weight="bold">{e.displayName}</Text>}
                <Text size="small" color="color.text.subtle">{e.reason}</Text>
                {e.teams?.length > 0 && (
                  <TagGroup>
                    {e.teams.map((t) => (
                      <Tag key={t} text={t} />
                    ))}
                  </TagGroup>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
      <Text size="small" color="color.text.subtlest">
        Generated {new Date(f.generatedAt).toLocaleString()} · Ask the <Strong>Hindsight</Strong> agent in Rovo for more.
      </Text>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
