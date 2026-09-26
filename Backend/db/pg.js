// Backend/db/pg.js (ESM)
import { Pool } from "pg";
import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

const isLikelyInternalHost = (hostname = "") => {
  const host = String(hostname).toLowerCase();
  if (!host) return false;
  return host.endsWith(".internal") || host.includes(".internal.") || host.includes("-internal");
};

const pickConnectionString = () => {
  if (!isProduction) {
    if (process.env.DATABASE_URL_LOCAL) {
      return { value: process.env.DATABASE_URL_LOCAL, source: "DATABASE_URL_LOCAL" };
    }
    if (process.env.PGURL_LOCAL) {
      return { value: process.env.PGURL_LOCAL, source: "PGURL_LOCAL" };
    }
  }

  const candidates = isProduction
    ? [
        ["RENDER_DATABASE_URL", process.env.RENDER_DATABASE_URL],
        ["DATABASE_URL", process.env.DATABASE_URL],
        ["PROD_DATABASE_URL", process.env.PROD_DATABASE_URL],
      ]
    : [
        ["DATABASE_URL", process.env.DATABASE_URL],
        ["RENDER_DATABASE_URL", process.env.RENDER_DATABASE_URL],
        ["PROD_DATABASE_URL", process.env.PROD_DATABASE_URL],
      ];

  for (const [source, value] of candidates) {
    if (value) return { value, source };
  }
  return { value: null, source: null };
};

const { value: connectionString, source: connectionSource } = pickConnectionString();

let pool;
if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const url = new URL(connectionString);
    console.log("[pg] Using remote connection", {
      source: connectionSource,
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname?.replace(/^\//, "") || null,
      user: url.username || null,
    });
    if (!isProduction && isLikelyInternalHost(url.hostname)) {
      console.warn(
        "[pg] Non-production connection appears internal. Set DATABASE_URL_LOCAL to an external/local DB URL for local UI QA."
      );
    }
  } catch (err) {
    // The raw connection string can embed credentials, so only its source is logged.
    console.log("[pg] Using remote connection string", {
      source: connectionSource,
    });
  }
} else {
  const localConfig = {
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "postgres",
    database: process.env.DB_NAME || "my_local_db",
    password: process.env.DB_PASSWORD || "postgres",
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  };
  pool = new Pool(localConfig);
  // Credential material is never logged, not even masked.
  console.log("[pg] Using local connection", {
    user: localConfig.user,
    host: localConfig.host,
    database: localConfig.database,
    port: localConfig.port,
  });
}

export default pool;
