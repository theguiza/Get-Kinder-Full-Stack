// Backend/db/pg.js (ESM)
import { Pool } from "pg";
import "dotenv/config";

const mask = (value = "", { keepStart = 4, keepEnd = 2 } = {}) => {
  if (!value) return "";
  const str = String(value);
  if (str.length <= keepStart + keepEnd) return "*".repeat(Math.max(3, str.length));
  return `${str.slice(0, keepStart)}…${str.slice(-keepEnd)}`;
};

const pickConnectionString = () => {
  const candidates = [
    process.env.RENDER_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.PROD_DATABASE_URL,
  ].filter(Boolean);
  return candidates.length ? candidates[0] : null;
};

const connectionString = pickConnectionString();

let pool;
if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const url = new URL(connectionString);
    console.log("[pg] Using remote connection", {
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname?.replace(/^\//, "") || null,
      user: url.username || null,
    });
  } catch (err) {
    console.log("[pg] Using remote connection string", mask(connectionString));
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
