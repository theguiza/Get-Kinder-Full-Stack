// Backend/db/pg.js (ESM)
import { Pool } from "pg";
import "dotenv/config";

const mask = (value = "", { keepStart = 4, keepEnd = 2 } = {}) => {
  if (!value) return "";
  const str = String(value);
  if (str.length <= keepStart + keepEnd) return "*".repeat(Math.max(3, str.length));
  return `${str.slice(0, keepStart)}…${str.slice(-keepEnd)}`;
};

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
    console.log("[pg] Using remote connection string", {
      source: connectionSource,
      connection: mask(connectionString),
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
  console.log("[pg] Using local connection", {
    ...localConfig,
    password: localConfig.password ? mask(localConfig.password) : null,
  });
}

export default pool;
