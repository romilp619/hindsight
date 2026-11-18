import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Stack,
  Inline,
  Heading,
  Text,
  Lozenge,
  Button,
  LoadingButton,
  SectionMessage,
  ProgressBar,
  DynamicTable,
  Link,
  Textfield,
  Spinner,
  Code,
  Em,
  Strong,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const RISK_APPEARANCE = { HIGH: 'removed', MEDIUM: 'moved', LOW: 'success', UNKNOWN: 'default' };
const tile = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  padding: 'space.200',
  minWidth: '160px',
});

function Stat({ label, value, hint }) {
  return (
    <Box xcss={tile}>
      <Stack space="space.050">
        <Text size="small" color="color.text.subtle">{label}</Text>
        <Heading size="large">{value}</Heading>
        {hint && <Text size="small" color="color.text.subtlest">{hint}</Text>}
      </Stack>
    </Box>
  );
}

function TryIdea() {
  const [idea, setIdea] = useState('Migrate card payments to the Stripe Payment Intents API');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await invoke('tryIdea', { title: idea }));
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack space="space.100">
      <Heading size="small">What would history say about…</Heading>
      <Inline space="space.100" alignBlock="center">
        <Box xcss={xcss({ flexGrow: 1 })}>
          <Textfield value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Describe planned work" />
        </Box>
        <LoadingButton appearance="primary" isLoading={busy} onClick={run} isDisabled={!idea.trim()}>
          Run pre-mortem
        </LoadingButton>
      </Inline>
      {err && <SectionMessage appearance="error"><Text>{err}</Text></SectionMessage>}
      {res && !res.coldStart && (
        <Box xcss={tile}>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center">
              <Lozenge appearance={RISK_APPEARANCE[res.risk]} isBold>{res.risk} RISK</Lozenge>
              {res.predictedSlipDays > 0 && <Text weight="bold">~{res.predictedSlipDays} days of slip predicted</Text>}
            </Inline>
            <Text>{res.headline}</Text>
            {res.similar.map((s) => (
              <Text key={s.key} size="small">
                <Link href={s.url} openNewTab>{s.key}</Link> {s.summary}: {s.outcome.verdict}
                {s.outcome.slipDays ? ` (${s.outcome.slipDays > 0 ? '+' : ''}${s.outcome.slipDays}d)` : ''}
              </Text>
            ))}
            {res.lessons.slice(0, 3).map((l) => (
              <Text key={l.id} size="small">→ {l.title}</Text>
            ))}
          </Stack>
        </Box>
      )}
      {res?.coldStart && (
        <SectionMessage appearance="discovery"><Text>No finished epics yet. Load the sample history below first.</Text></SectionMessage>
      )}
    </Stack>
  );
}

function SampleLoader({ seed, onDone }) {
  const [progress, setProgress] = useState(seed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      let s = progress;
      for (let i = 0; i < s.total; i++) {
        s = await invoke('seedStep', { index: i });
        setProgress(s);
      }
      onDone();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await invoke('clearSample');
      setProgress({ ...progress, completed: 0, keys: [] });
      onDone();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const complete = progress.completed >= progress.total;
  return (
    <Stack space="space.100">
      <Heading size="small">Sample history</Heading>
      <Text>
        New site? Load two years of delivery history from <Em>Northwind Pay</Em>, a fictional fintech: {progress.total} finished
        epics with real child issues, bugs, incidents and retro notes, created in this project. Then create a new Epic such as
        "Migrate card payments to Stripe Payment Intents" and watch Hindsight respond.
      </Text>
      {(busy || (progress.completed > 0 && !complete)) && <ProgressBar value={progress.completed / progress.total} />}
      <Inline space="space.100">
        {!complete && (
          <LoadingButton appearance="primary" isLoading={busy} onClick={load}>
            {progress.completed ? `Resume (${progress.completed}/${progress.total})` : 'Load sample history'}
          </LoadingButton>
        )}
        {progress.completed > 0 && (
          <Button appearance="subtle" onClick={clear} isDisabled={busy}>Remove sample data</Button>
        )}
        {complete && <Lozenge appearance="success">Sample history loaded</Lozenge>}
      </Inline>
      {err && <SectionMessage appearance="error"><Text>{err}</Text></SectionMessage>}
    </Stack>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const refresh = async () => {
    try {
      setData(await invoke('getDashboard'));
    } catch (e) {
      setErr(e?.message || String(e));
    }
  };
  useEffect(() => {
    refresh();
  }, []);

  if (err) return <SectionMessage appearance="error" title="Couldn't load Hindsight"><Text>{err}</Text></SectionMessage>;
  if (!data) return <Spinner />;

  const acc = data.accuracy;
  const rows = data.forecasts.map((f) => ({
    key: f.issueKey,
    cells: [
      { key: 'k', content: <Link href={`/browse/${f.issueKey}`} openNewTab>{f.issueKey}</Link> },
      { key: 's', content: f.issueSummary },
      { key: 'r', content: <Lozenge appearance={RISK_APPEARANCE[f.risk]}>{f.risk}</Lozenge> },
      { key: 'p', content: f.predictedSlipDays ? `+${f.predictedSlipDays}d` : '–' },
      {
        key: 'o',
        content: f.outcome ? (
          <Lozenge appearance={f.outcome.hit ? 'success' : 'moved'}>{f.outcome.hit ? 'Called it' : 'Missed'}</Lozenge>
        ) : (
          <Text color="color.text.subtlest">in flight</Text>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Text>
          Every company repeats its mistakes because nobody remembers them. Hindsight reads how your past work actually went
          (slips, incidents, retros) and runs an evidence-based pre-mortem the moment new work starts.
        </Text>
      </Stack>

      <Inline space="space.200" shouldWrap>
        <Stat label="Finished epics in memory" value={data.indexed} hint={data.sampleIndexed ? `${data.sampleIndexed} from sample data` : 'from this site'} />
        <Stat label="Pre-mortems run" value={acc.forecasts} />
        <Stat label="Forecast accuracy" value={acc.rate === null ? '–' : `${acc.rate}%`} hint={`${acc.scored} finished epic(s) scored`} />
      </Inline>

      <TryIdea />

      <Stack space="space.100">
        <Heading size="small">Recent pre-mortems</Heading>
        {rows.length ? (
          <DynamicTable
            head={{ cells: [{ key: 'k', content: 'Work item' }, { key: 's', content: 'Summary' }, { key: 'r', content: 'Risk' }, { key: 'p', content: 'Predicted slip' }, { key: 'o', content: 'Result' }] }}
            rows={rows}
          />
        ) : (
          <Text color="color.text.subtle">None yet. Create an Epic and Hindsight runs automatically.</Text>
        )}
      </Stack>

      {data.seed && <SampleLoader seed={data.seed} onDone={refresh} />}

      <Stack space="space.100">
        <Heading size="small">Where else Hindsight works</Heading>
        <Text>• <Strong>Rovo:</Strong> chat with the Hindsight agent ("What went wrong last time we touched payments?"). Its skills and actions can be reused by any agent.</Text>
        <Text>• <Strong>MCP:</Strong> an admin enables external access under Atlassian Administration → Connected apps → Hindsight. Then add <Code>{data.mcpUrl || 'https://mcp.atlassian.com/forge/<app-id>'}</Code> to Claude, Cursor or Codex.</Text>
        <Inline space="space.100" alignBlock="center">
          <Text>• <Strong>Teamwork Graph:</Strong></Text>
          <Lozenge appearance={data.graph.writeConnected ? 'success' : 'default'}>{data.graph.writeConnected ? 'publishing forecasts' : 'connector not set up'}</Lozenge>
          <Lozenge appearance={data.graph.readConfigured ? (data.graph.lastReadOk === false ? 'moved' : 'success') : 'default'}>
            {data.graph.readConfigured ? (data.graph.lastReadOk === false ? 'team lookup error' : 'team lookup on') : 'team lookup off'}
          </Lozenge>
        </Inline>
      </Stack>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
