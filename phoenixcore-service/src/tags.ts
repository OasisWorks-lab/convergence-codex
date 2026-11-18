import type { Query } from './db.ts';

export async function currentTag(q: Query, characterId: string): Promise<string> {
  const [row] = await q('SELECT tag FROM pc_post_tags WHERE character_id=$1', [characterId]);
  return row?.tag ?? '';
}

// The caller rolls back its transaction or savepoint if the tag is already taken.
export async function assignTag(q: Query, owner: string, characterId: string, tag: string): Promise<boolean> {
  await q('DELETE FROM pc_post_tags WHERE owner_id=$1 AND character_id=$2', [owner, characterId]);
  if (!tag) return true;
  const rows = await q('INSERT INTO pc_post_tags(owner_id,tag,character_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING tag', [owner, tag, characterId]);
  return rows.length > 0;
}
