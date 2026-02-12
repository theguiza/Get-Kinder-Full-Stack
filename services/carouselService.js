import pool from "../Backend/db/pg.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function fetchCarouselItems({ city, limit } = {}) {
  const clampedLimit = clampLimit(limit);
  const cityFilter = sanitizeString(city);

  const values = [clampedLimit];
  let cityClause = "";
  if (cityFilter) {
    values.push(cityFilter);
    cityClause = "AND city = $2";
  }

  const { rows } = await pool.query(
    `
      SELECT id, seed_key, type, caption, title, media_url, link_url, author_name, city, crew_label, priority, status, created_at, updated_at
        FROM carousel_items
       WHERE status = 'active'
       ${cityClause}
       ORDER BY priority DESC, created_at DESC
       LIMIT $1
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    caption: row.caption,
    title: row.title,
    media_url: row.media_url,
    link_url: row.link_url,
    author_name: row.author_name,
    city: row.city,
    crew_label: row.crew_label,
    priority: row.priority,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}
