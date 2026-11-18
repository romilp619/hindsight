const MAP = {
  '@forge/api': 'forge-api.mjs',
  '@forge/kvs': 'forge-kvs.mjs',
  '@forge/llm': 'forge-llm.mjs',
  '@forge/teamwork-graph': 'forge-twg.mjs',
};
export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: new URL(MAP[specifier], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
