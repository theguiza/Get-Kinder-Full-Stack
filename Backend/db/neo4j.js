import 'dotenv/config';               // <-- ensures .env is loaded no matter who imports us
import neo4j from 'neo4j-driver';

const {
  NEO4J_URI,
  NEO4J_USERNAME,
  NEO4J_PASSWORD,
  NEO4J_DATABASE = 'neo4j',
} = process.env;

if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
  throw new Error('Missing Neo4j env vars (NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD).');
}

export const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
);

export async function run(query, params = {}) {
  const session = driver.session({ database: NEO4J_DATABASE });
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
}

export async function verify() {
  // Throws if URI/creds/TLS are wrong
  await driver.verifyConnectivity();
  return true;
}

export async function close() {
  try { await driver.close(); } catch {}
}
