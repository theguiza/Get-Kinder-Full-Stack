import pool from "../../db/pg.js";

export function getPool() {
  return pool;
}

export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run repository work in one callback-scoped transaction.
 *
 * The callback receives exactly one opaque transaction context. Future mutation
 * persistence and required-audit repositories may receive that same context.
 * Best-effort metrics are not part of this interface and must run only after a
 * successful callback has committed. This repository-level orchestration does
 * not confirm PostgreSQL atomicity or deployed-schema compatibility.
 *
 * Runtime callers use the callback-only form. `transactionProvider` is an
 * adapter-injection seam for deterministic contract tests.
 *
 * @template Result
 * @param {(transactionContext: object) => Result | Promise<Result>} callback
 * @param {{ connect: () => Promise<object> }} [transactionProvider=pool]
 * @returns {Promise<Result>}
 */
export async function withTransaction(callback, transactionProvider = pool) {
  const transactionContext = await transactionProvider.connect();
  try {
    await transactionContext.query("BEGIN");
    const result = await callback(transactionContext);
    await transactionContext.query("COMMIT");
    return result;
  } catch (error) {
    await transactionContext.query("ROLLBACK");
    throw error;
  } finally {
    transactionContext.release();
  }
}

export default pool;
