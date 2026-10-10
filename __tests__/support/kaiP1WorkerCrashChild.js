// Child process for the P1 worker crash proofs in
// kai-sprint2-p1-worker-file-processing.integration.spec.js. It runs the real
// file-scoped P1 operation against the runner-owned database through its own
// pool, then dies with SIGKILL at the requested point, so its connections and
// in-memory state are lost exactly as in a process crash. Synthetic data only.
import pg from "pg";
import { processKaiP1IntakeFile } from "../../Backend/kai/parsing/p1WorkerRuntime.js";
import { withTransaction } from "../../Backend/kai/db/kaiDb.js";
import { getScopedIntakeFileParserProfileEligibilityFacts } from "../../Backend/kai/db/kaiIntakeQueries.js";
import { createDraftDataDictionary } from "../../Backend/kai/services/kaiDataDictionaryService.js";

const args = JSON.parse(process.argv[2]);
const pool = new pg.Pool({ connectionString: args.databaseUrl, ssl: false, max: 2 });
const bytes = Buffer.from(args.bytesBase64, "base64");

function die() {
  process.kill(process.pid, "SIGKILL");
  return new Promise(() => {});
}

await processKaiP1IntakeFile(
  { organizationId: args.organizationId, intakeFileId: args.intakeFileId },
  {
    env: { KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "true" },
    now: () => args.now,
    runInTransaction: (callback) => withTransaction(callback, pool),
    getScopedIntakeFileParserProfileEligibilityFacts: (identity) => getScopedIntakeFileParserProfileEligibilityFacts(identity, pool),
    objectVersionByteSource: {
      async readObjectVersion() {
        if (args.mode === "kill_during_parse") return die();
        return { ok: true, data: { bytes: new Uint8Array(bytes) }, error: null };
      },
    },
    async createDraftDataDictionary(input, dependencies) {
      if (args.mode === "kill_after_downstream_reservation") return die();
      const result = await createDraftDataDictionary(input, dependencies);
      if (args.mode === "kill_after_downstream_commit") return die();
      return result;
    },
  },
);
// Reaching here means the requested crash point was never hit.
process.exit(3);
