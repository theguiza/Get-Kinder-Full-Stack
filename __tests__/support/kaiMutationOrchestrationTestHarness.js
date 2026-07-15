import { withTransaction } from "../../Backend/kai/db/kaiDb.js";
import {
  BEST_EFFORT_METRIC_METADATA_ALLOWLIST,
  REQUIRED_AUDIT_METADATA_ALLOWLIST,
  RequiredAuditPersistenceError,
  orchestrateMutationWithRequiredAudit,
} from "../../Backend/kai/internal/kaiMutationOrchestration.js";

export {
  BEST_EFFORT_METRIC_METADATA_ALLOWLIST,
  REQUIRED_AUDIT_METADATA_ALLOWLIST,
  RequiredAuditPersistenceError,
};

export function createTransactionHarness() {
  const events = [];
  const transactionContext = {
    async query(command) {
      events.push(command);
      return { rows: [] };
    },
    release() {
      events.push("RELEASE");
    },
  };
  const transactionProvider = {
    async connect() {
      events.push("CONNECT");
      return transactionContext;
    },
  };

  return { events, transactionContext, transactionProvider };
}

export function withTestTransaction(callback, harness) {
  return withTransaction(callback, harness.transactionProvider);
}

export function runMutationOrchestrationForTest(input, dependencies, harness) {
  return orchestrateMutationWithRequiredAudit(
    input,
    dependencies,
    (callback) => withTestTransaction(callback, harness),
  );
}
