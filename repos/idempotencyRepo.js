/**
 * Idempotency helpers backed by the arc_mutations table.
 */
export async function getCached(client, arcId, key) {
  if (!client || arcId == null || !key) return null;

  const { rows } = await client.query(
    `SELECT response_json
       FROM arc_mutations
      WHERE arc_id = $1
        AND idempotency_key = $2
      LIMIT 1`,
    [arcId, key]
  );

  if (!rows.length) return null;

  const payload = rows[0].response_json;
  if (!payload || typeof payload !== "string") {
    return payload ?? null;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export async function putCached(client, arcId, key, responseJson) {
  if (!client || arcId == null || !key || responseJson === undefined) return;

  await client.query(
    `INSERT INTO arc_mutations (arc_id, idempotency_key, response_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (arc_id, idempotency_key)
     DO UPDATE SET response_json = EXCLUDED.response_json`,
    [arcId, key, responseJson]
  );
}

