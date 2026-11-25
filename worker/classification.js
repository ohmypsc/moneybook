// 거래 태그 칸(tags_json, category_source)이 없던 기존 DB에 한 번만 추가합니다.
const ready = new WeakMap();
export async function ensureClassificationSchema(env) {
  if (!ready.has(env.DB))
    ready.set(
      env.DB,
      (async () => {
        const { results } = await env.DB.prepare("PRAGMA table_info(transactions)").all();
        for (const [name, definition] of [
          ["tags_json", "TEXT NOT NULL DEFAULT '[]'"],
          ["category_source", "TEXT NOT NULL DEFAULT 'manual'"]
        ]) {
          if (results.some(c => c.name === name)) continue;
          try {
            await env.DB.prepare(`ALTER TABLE transactions ADD COLUMN ${name} ${definition}`).run();
          } catch (error) {
            if (!/duplicate column/i.test(String(error.message))) throw error;
          }
        }
      })().catch(error => {
        ready.delete(env.DB);
        throw error;
      })
    );
  return ready.get(env.DB);
}
