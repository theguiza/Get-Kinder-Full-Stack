// Backend/db/pg.js (ESM)
import { Pool } from "pg";
import 'dotenv/config';

let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  pool = new Pool({
    user:     process.env.DB_USER     || "postgres",
    host:     process.env.DB_HOST     || "postgres",
    database: process.env.DB_NAME     || "my_local_db",
    password: process.env.DB_PASSWORD || "postgres",
    port:     process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  });
}

export default pool;
