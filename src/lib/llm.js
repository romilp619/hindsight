import { chat, list } from '@forge/llm';
import { kvs } from '@forge/kvs';
import { parseJsonReply } from './core.js';

// Preference order. We resolve against the live model list so the app keeps
// working as Atlassian rotates model versions.
const PREFERRED = [/sonnet/i, /haiku/i, /opus/i, /claude/i];
const MODEL_CACHE_KEY = 'llm:model';

async function pickModel() {
  if (process.env.HINDSIGHT_MODEL) return process.env.HINDSIGHT_MODEL;
  const cached = await kvs.get(MODEL_CACHE_KEY).catch(() => null);
  if (cached && Date.now() - cached.at < 6 * 3600 * 1000) return cached.model;
  const { models = [] } = await list();
  const active = models.filter((m) => m.status === 'active').map((m) => m.model);
  for (const re of PREFERRED) {
    const hit = active.find((m) => re.test(m));
    if (hit) {
      await kvs.set(MODEL_CACHE_KEY, { model: hit, at: Date.now() }).catch(() => {});
      return hit;
    }
  }
  throw new Error('No active Forge LLM model available');
}

/** Ask the model for JSON. Returns parsed object or null (callers must have a fallback). */
export async function askJson(system, user, { maxTokens = 1800 } = {}) {
  try {
    const model = await pickModel();
    const res = await chat({
      model,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const content = res?.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((p) => p.text || '').join('') : content;
    return parseJsonReply(text);
  } catch (e) {
    console.error('Hindsight LLM call failed, using deterministic fallback:', e?.message || e);
    return null;
  }
}
