import type { ChannelType } from "./channels";

export type RecipientRow = {
  id: number;
  label: string;
  channel_type: ChannelType;
  config_json: string;
  on_prompt: number;
  on_final: number;
  prompt_content: string;
  reminder_content: string;
  final_content: string;
  created_at: number;
};

export function configOf(row: Pick<RecipientRow, "config_json">): Record<string, string> {
  try {
    const parsed = JSON.parse(row.config_json) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
  } catch {
    return {};
  }
}

export async function listRecipients(db: D1Database): Promise<RecipientRow[]> {
  const res = await db.prepare("SELECT * FROM recipients ORDER BY id").all<RecipientRow>();
  return res.results;
}

export async function getRecipient(db: D1Database, id: number): Promise<RecipientRow | null> {
  return db.prepare("SELECT * FROM recipients WHERE id = ?").bind(id).first<RecipientRow>();
}

export async function countFinal(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM recipients WHERE on_final = 1").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function promptRecipients(db: D1Database): Promise<RecipientRow[]> {
  const res = await db.prepare("SELECT * FROM recipients WHERE on_prompt = 1 ORDER BY id").all<RecipientRow>();
  return res.results;
}

export async function finalRecipients(db: D1Database): Promise<RecipientRow[]> {
  const res = await db.prepare("SELECT * FROM recipients WHERE on_final = 1 ORDER BY id").all<RecipientRow>();
  return res.results;
}

export async function insertRecipient(
  db: D1Database,
  row: Omit<RecipientRow, "id">,
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO recipients
        (label, channel_type, config_json, on_prompt, on_final, prompt_content, reminder_content, final_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.label,
      row.channel_type,
      row.config_json,
      row.on_prompt,
      row.on_final,
      row.prompt_content,
      row.reminder_content,
      row.final_content,
      row.created_at,
    )
    .run();
  return (res.meta?.last_insert_rowid as number) ?? 0;
}

/**
 * 更新。「至少保留一位紧急联系人」折进同一条语句的 WHERE，返回 false 表示条件不满足
 * （并发里另一个请求已经把最后一位退掉了）。调用方据此回 400，不能只靠事前的 countFinal 预检查。
 */
export async function updateRecipient(db: D1Database, row: RecipientRow): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE recipients SET label=?, channel_type=?, config_json=?, on_prompt=?, on_final=?,
        prompt_content=?, reminder_content=?, final_content=?
       WHERE id=? AND (? = 1 OR on_final = 0 OR (SELECT COUNT(*) FROM recipients WHERE on_final = 1) > 1)`,
    )
    .bind(
      row.label,
      row.channel_type,
      row.config_json,
      row.on_prompt,
      row.on_final,
      row.prompt_content,
      row.reminder_content,
      row.final_content,
      row.id,
      row.on_final,
    )
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** 删除，同 `updateRecipient` 用单条条件语句守住不变量；返回 false = 这是最后一位紧急联系人。 */
export async function deleteRecipient(db: D1Database, id: number): Promise<boolean> {
  const res = await db
    .prepare(
      `DELETE FROM recipients
       WHERE id=? AND (on_final = 0 OR (SELECT COUNT(*) FROM recipients WHERE on_final = 1) > 1)`,
    )
    .bind(id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
