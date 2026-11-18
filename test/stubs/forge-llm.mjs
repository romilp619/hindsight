export const llmState = { reply: null, calls: [] };
export async function list() { return { models: [{ model: 'claude-haiku-test', status: 'active' }, { model: 'claude-sonnet-test', status: 'active' }] }; }
export async function chat(req) {
  llmState.calls.push(req);
  if (llmState.reply instanceof Error) throw llmState.reply;
  const text = typeof llmState.reply === 'function' ? llmState.reply(req) : llmState.reply;
  if (text === null) throw new Error('LLM disabled in test');
  return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] };
}
export async function stream() { throw new Error('not stubbed'); }
