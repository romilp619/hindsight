export const store = new Map();
export const WhereConditions = { beginsWith: (v) => ({ beginsWith: v }) };
export const kvs = {
  async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
  async set(k, v) { store.set(k, structuredClone(v)); },
  async delete(k) { store.delete(k); },
  query() {
    let prefix = '', lim = 20;
    const q = {
      where(_p, c) { prefix = c.beginsWith; return q; },
      limit(n) { lim = n; return q; },
      async getMany() {
        return { results: [...store.entries()].filter(([k]) => k.startsWith(prefix)).slice(0, lim).map(([key, value]) => ({ key, value: structuredClone(value) })) };
      },
    };
    return q;
  },
};
export default kvs;
