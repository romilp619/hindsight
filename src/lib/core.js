// Pure, dependency-free logic for Hindsight. Everything here is unit tested
// (see test/core.test.js) and has no Forge imports, so it runs anywhere.

const DAY = 24 * 60 * 60 * 1000;

const STOPWORDS = new Set(
  `a an the and or but if then else of to in on for with by from at as is are was were be been being this that these those it its
  we our you your they their i me my he she his her them us will would should could can may might must do does did done
  into over under about after before during than so such not no yes via per also just only new old all any each more most
  epic story task issue project team work make add update use using support improve phase v1 v2 v3`
    .split(/\s+/)
    .filter(Boolean),
);

// Light domain concepts so "Stripe" work can match "PayPal" or "billing" work even with no shared words.
const CONCEPTS = {
  'concept:payments': ['payment', 'pay', 'stripe', 'paypal', 'billing', 'checkout', 'refund', 'invoice', 'charge', 'card', 'wallet', 'subscription', 'currency', 'tax', 'vat', 'ledger', 'fraud'],
  'concept:identity': ['auth', 'oauth', 'oauth2', 'sso', 'saml', 'login', 'token', 'okta', 'identity', 'password', 'mfa', 'permission'],
  'concept:data': ['postgres', 'postgresql', 'mysql', 'database', 'db', 'schema', 'replication', 'upgrade', 'index', 'backfill'],
  'concept:events': ['kafka', 'event', 'queue', 'stream', 'consumer', 'webhook', 'pubsub', 'outbox'],
  'concept:mobile': ['mobile', 'ios', 'android', 'app', 'offline', 'push'],
  'concept:integration': ['integration', 'partner', 'api', 'sdk', 'migration', 'migrate'],
};
const CONCEPT_OF = new Map();
for (const [c, words] of Object.entries(CONCEPTS)) for (const w of words) CONCEPT_OF.set(w, c);

// Concepts that describe a *kind of change* rather than a business domain; they never define "same domain".
const GENERIC_CONCEPTS = new Set(['concept:integration']);

/** Business-domain concepts mentioned in a text (e.g. payments, identity). */
export function domainsOf(text) {
  return new Set(tokenize(text).filter((t) => t.startsWith('concept:') && !GENERIC_CONCEPTS.has(t)));
}

/**
 * Keep only candidates from the same business domain as the query, when the query has one.
 * Falls back to the unfiltered list if fewer than `min` candidates survive.
 */
export function sameDomain(queryText, candidates, textOf, min = 2) {
  const q = domainsOf(queryText);
  if (!q.size) return candidates;
  const kept = candidates.filter((c) => [...domainsOf(textOf(c))].some((d) => q.has(d)));
  return kept.length >= min ? kept : candidates;
}

/** Lowercase word tokens with light stemming plus domain concept tags; keeps tech tokens like "v3", "oauth2". */
export function tokenize(text) {
  if (!text) return [];
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
  const concepts = words.map((w) => CONCEPT_OF.get(w)).filter(Boolean);
  return [...words, ...concepts];
}

function stem(t) {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('es') && !t.endsWith('ses')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  if (t.length > 5 && t.endsWith('ed')) return t.slice(0, -2);
  return t;
}

/**
 * TF-IDF cosine similarity between a query document and a corpus.
 * docs: [{ id, text }] -> [{ id, score }] sorted desc, score in [0,1].
 */
export function rankBySimilarity(queryText, docs) {
  const docTokens = docs.map((d) => tokenize(d.text));
  const qTokens = tokenize(queryText);
  const N = docs.length + 1;
  const df = new Map();
  for (const toks of [...docTokens, qTokens]) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const vec = (toks) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * idf(t);
      v.set(t, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) || 1 };
  };
  const q = vec(qTokens);
  return docs
    .map((d, i) => {
      const dv = vec(docTokens[i]);
      let dot = 0;
      for (const [t, w] of q.v) if (dv.v.has(t)) dot += w * dv.v.get(t);
      return { id: d.id, score: dot / (q.norm * dv.norm) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Flatten Atlassian Document Format (or plain string) into text. */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('');
  let out = '';
  if (node.type === 'text') out += node.text || '';
  if (node.type === 'hardBreak') out += '\n';
  if (node.content) out += node.content.map(adfToText).join('');
  if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(node.type)) out += '\n';
  return out;
}

/** Minimal ADF document from plain text (paragraph per line). */
export function textToAdf(text) {
  const lines = String(text || '').split('\n');
  return {
    type: 'doc',
    version: 1,
    content: lines.map((l) =>
      l.trim() ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph', content: [] },
    ),
  };
}

const toTime = (d) => (d ? new Date(d).getTime() : NaN);
const days = (ms) => Math.round(ms / DAY);

const RETRO_RE = /\b(retro|retrospective|lesson|lessons learned|post-?mortem|what went wrong|next time)\b/i;
const INCIDENT_LABEL_RE = /^(incident|sev[-_ ]?[0-9]|outage|p[0-1])$/i;

/**
 * Turn a raw past epic (+ its children) into an outcome record.
 * epic: { key, summary, description, created, resolutiondate, duedate, assignee, comments: [text], history }
 *   history (optional, from the `hindsight-history` issue property) can override dates for imported history:
 *   { startedAt, dueAt, resolvedAt, owner }
 * children: [{ key, summary, issuetype, labels, assignee, history: { kind, severity, fixer } }]
 */
export function computeOutcome(epic, children = []) {
  const h = epic.history || {};
  const start = toTime(h.startedAt || epic.created);
  const due = toTime(h.dueAt || epic.duedate);
  const resolved = toTime(h.resolvedAt || epic.resolutiondate);

  const durationDays = Number.isFinite(start) && Number.isFinite(resolved) ? days(resolved - start) : null;
  const plannedDays = Number.isFinite(start) && Number.isFinite(due) ? days(due - start) : null;
  const slipDays = Number.isFinite(due) && Number.isFinite(resolved) ? days(resolved - due) : null;

  const isIncident = (c) =>
    c.history?.kind === 'incident' ||
    /incident/i.test(c.issuetype || '') ||
    (c.labels || []).some((l) => INCIDENT_LABEL_RE.test(l));
  const isBug = (c) => !isIncident(c) && (c.history?.kind === 'bug' || /bug|defect/i.test(c.issuetype || ''));

  const incidents = children.filter(isIncident).map((c) => ({
    key: c.key,
    summary: c.summary,
    severity: c.history?.severity || (c.labels || []).find((l) => /^sev/i.test(l)) || null,
    fixer: c.history?.fixer || c.assignee?.displayName || null,
    fixerAccountId: c.history?.fixer ? null : c.assignee?.accountId || null,
  }));
  const bugs = children.filter(isBug);

  const retro = (epic.comments || [])
    .filter((t) => RETRO_RE.test(t))
    .map((t) => t.trim())
    .join('\n\n')
    .slice(0, 2500);

  let verdict = 'unknown';
  if (slipDays !== null) verdict = slipDays > 3 ? 'late' : 'on-time';
  if (incidents.length) verdict = verdict === 'late' ? 'late+incident' : 'incident';

  return {
    key: epic.key,
    summary: epic.summary,
    owner: h.owner || epic.assignee?.displayName || null,
    ownerAccountId: h.owner ? null : epic.assignee?.accountId || null,
    durationDays,
    plannedDays,
    slipDays,
    childCount: children.length,
    bugCount: bugs.length,
    incidents,
    retro,
    verdict,
  };
}

/**
 * Deterministic risk model. Numbers come from data, never from the LLM.
 * similar: [{ similarity (0..1), outcome }]
 */
export function scoreRisk(similar) {
  const usable = similar.filter((s) => s.outcome);
  if (!usable.length) {
    return { risk: 'UNKNOWN', predictedSlipDays: null, incidentRate: null, confidence: 'none', basedOn: 0 };
  }
  const wsum = usable.reduce((a, s) => a + Math.max(s.similarity, 0.05), 0);
  const w = (s) => Math.max(s.similarity, 0.05) / wsum;

  const withSlip = usable.filter((s) => s.outcome.slipDays !== null);
  const slipW = withSlip.reduce((a, s) => a + Math.max(s.similarity, 0.05), 0) || 1;
  const predictedSlipDays = withSlip.length
    ? Math.round(withSlip.reduce((a, s) => a + Math.max(0, s.outcome.slipDays) * Math.max(s.similarity, 0.05), 0) / slipW)
    : null;
  const incidentRate = usable.reduce((a, s) => a + (s.outcome.incidents.length > 0 ? 1 : 0) * w(s), 0);
  const lateRate = withSlip.length
    ? withSlip.reduce((a, s) => a + (s.outcome.slipDays > 3 ? 1 : 0) * Math.max(s.similarity, 0.05), 0) / slipW
    : 0;

  let points = 0;
  if (predictedSlipDays !== null) points += predictedSlipDays >= 14 ? 2 : predictedSlipDays >= 5 ? 1 : 0;
  points += incidentRate >= 0.5 ? 2 : incidentRate > 0 ? 1 : 0;
  points += lateRate >= 0.66 ? 1 : 0;
  const risk = points >= 3 ? 'HIGH' : points >= 1 ? 'MEDIUM' : 'LOW';

  const avgSim = usable.reduce((a, s) => a + s.similarity, 0) / usable.length;
  const confidence = usable.length >= 3 && avgSim >= 0.25 ? 'high' : usable.length >= 2 && avgSim >= 0.12 ? 'medium' : 'low';

  return {
    risk,
    predictedSlipDays,
    incidentRate: Math.round(incidentRate * 100) / 100,
    lateRate: Math.round(lateRate * 100) / 100,
    confidence,
    basedOn: usable.length,
  };
}

/** People who have done this before: owners of similar work and people who fixed its incidents. */
export function findExperts(similar) {
  const map = new Map();
  const add = (name, accountId, reason) => {
    if (!name && !accountId) return;
    const id = accountId || `name:${name}`;
    const cur = map.get(id) || { accountId: accountId || null, displayName: name, reasons: [], weight: 0 };
    cur.reasons.push(reason);
    cur.weight += 1;
    map.set(id, cur);
  };
  for (const s of similar) {
    const o = s.outcome;
    if (!o) continue;
    add(o.owner, o.ownerAccountId, `led ${o.key} (${o.summary})`);
    for (const inc of o.incidents) add(inc.fixer, inc.fixerAccountId, `fixed ${inc.key}: ${inc.summary}`);
  }
  return [...map.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map(({ weight, ...p }) => ({ ...p, reason: p.reasons.slice(0, 2).join('; ') }));
}

/**
 * Fallback lessons when the LLM is unavailable: pull sentences from retros.
 */
export function extractLessons(similar, max = 4) {
  const lessons = [];
  for (const s of similar) {
    const text = s.outcome?.retro || '';
    const sentences = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((x) => x.replace(/^(retro(spective)?|lessons?( learned)?|post-?mortem)\s*[:\-–]\s*/i, '').trim())
      .filter((x) => x.length > 20 && /\b(should|must|next time|need|always|never|before|earlier|test|involve)\b/i.test(x));
    for (const sentence of sentences) {
      lessons.push({ title: sentence.length > 90 ? sentence.slice(0, 87) + '…' : sentence, detail: sentence, sourceKey: s.outcome.key });
      if (lessons.length >= max) return lessons;
    }
  }
  return lessons;
}

/** Robustly pull the first JSON object out of an LLM reply. */
export function parseJsonReply(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
