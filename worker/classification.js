import { normalizeRules } from "../shared/classification.js";
const ready = new WeakMap();
export async function ensureClassificationSchema(env) {
  if (!ready.has(env.DB))
    ready.set(
      env.DB,
      (async () => {
        const { results } = await env.DB.prepare("PRAGMA table_info(transactions)").all();
        for (const [name, definition] of [
          ["tags_json", "TEXT NOT NULL DEFAULT '[]'"],
          ["category_source", "TEXT NOT NULL DEFAULT 'manual'"],
          // 나중에 정산받을 지출 표시(묶음 정산 대상 목록에 사용)
          ["settlement_expected", "INTEGER NOT NULL DEFAULT 0"]
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
export async function getClassificationSettings(env, householdId) {
  const row = await env.DB.prepare(
    "SELECT preference_json,version FROM user_preferences WHERE household_id=? AND preference_key='classification_rules'"
  )
    .bind(householdId)
    .first();
  return {
    rules: row ? normalizeRules(JSON.parse(row.preference_json)) : [],
    version: row?.version || 0
  };
}
export function classificationSettingsStatement(env, householdId, rules, actorTime) {
  return env.DB.prepare(
    `INSERT INTO user_preferences(preference_id,household_id,preference_key,preference_json,version,created_at,updated_at)
    VALUES(?,?,'classification_rules',?,1,?,?) ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=user_preferences.version+1,updated_at=excluded.updated_at`
  ).bind(
    `PREF_CLASSIFICATION_${householdId}`,
    householdId,
    JSON.stringify(rules),
    actorTime,
    actorTime
  );
}
