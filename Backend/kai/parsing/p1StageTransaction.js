import { withTransaction } from "../db/kaiDb.js";
import { lockKaiP1EligibleIntakeFileForShare } from "../db/kaiIntakeQueries.js";

/**
 * Raised inside a P1 stage transaction when the file is no longer a
 * confirmed, passed upload for the bound verified checksum. The enclosing
 * repository rolls the whole stage transaction back.
 */
export class KaiP1EligibilityRevokedError extends Error {
  constructor() {
    super("P1 intake-file eligibility was revoked before the stage committed");
    this.name = "KaiP1EligibilityRevokedError";
  }
}

/**
 * A `runInTransaction` for the existing P1-03/P1-04/P1-05 PostgreSQL
 * repositories that first re-asserts the file's eligibility under a share
 * lock held until the stage's own transaction commits. The repositories and
 * their idempotency/audit logic are unchanged; only their transaction
 * boundary gains this guard. It wraps the callback-only `runInTransaction`
 * form (the repository default, `withTransaction`).
 */
export function createKaiP1StageTransaction({ organizationId, intakeFileId, verifiedChecksum, runInTransaction = withTransaction }) {
  return (callback) => runInTransaction(async (transactionContext) => {
    const eligible = await lockKaiP1EligibleIntakeFileForShare(
      { organizationId, intakeFileId, verifiedChecksum },
      transactionContext,
    );
    if (!eligible) throw new KaiP1EligibilityRevokedError();
    return callback(transactionContext);
  });
}
