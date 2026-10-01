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

export async function updateRecipient(db: D1Database, row: RecipientRow): Promise<void> {
  await db
    .prepare(
      `UPDATE recipients SET label=?, channel_type=?, config_json=?, on_prompt=?, on_final=?,
        prompt_content=?, reminder_content=?, final_content=? WHERE id=?`,
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
    )
    .run();
}

export async function deleteRecipient(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM recipients WHERE id = ?").bind(id).run();
}
