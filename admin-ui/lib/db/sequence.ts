import type { PoolClient } from 'pg';

/**
 * Allocate next iDempiere table ID from AD_Sequence (same pattern as PWA API helpers).
 */
export async function nextSequenceId(
  client: PoolClient,
  sequenceName: string,
  tableName?: string,
  idColumn?: string,
): Promise<number> {
  if (tableName && idColumn) {
    await client.query(
      `UPDATE adempiere.ad_sequence s
       SET currentnext = GREATEST(
         s.currentnext,
         COALESCE((SELECT MAX(${idColumn}) + s.incrementno FROM ${tableName}), s.currentnext)
       )
       WHERE s.name = $1`,
      [sequenceName],
    );
  }

  const result = await client.query<{ next_id: string }>(
    `UPDATE adempiere.ad_sequence
     SET currentnext = currentnext + incrementno
     WHERE name = $1
     RETURNING (currentnext - incrementno) AS next_id`,
    [sequenceName],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Sequence not found: ${sequenceName}`);
  }
  return Number(row.next_id);
}
