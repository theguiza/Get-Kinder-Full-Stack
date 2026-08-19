// scripts/kai-sprint2-legacy-cutover-synthetic-reprocessor.js
//
// Bounded remediation executor for the KAI legacy-generation cutover.
//
// This script does NOT parse raw files, does NOT compute a hash, and does NOT
// duplicate any SQL or business logic. It composes the existing, already-
// accepted P1 producer services, in their required order, for exactly one
// already-confirmed intake file identity supplied by the operator:
//
//   activateParserProfileWorkForIntakeFile  (P1-03: parser run + file profile;
//                                             profile_canonical_sha256 is
//                                             computed by PostgreSQL itself via
//                                             encode(digest(profile::text,'sha256'),'hex')
//                                             inside postgresParserRunRepository.js -
//                                             never by this script)
//   -> createDraftDataDictionary            (P1-04)
//   -> persistIntakeSensitivityProfile       (P1-05)
//   -> createSensitivityReviewQueueItem      (P1-06)
//   -> createSourceCandidateStub             (P1-07)
//
// The resulting canonical intake_source_candidate_id is a NEW, freshly
// generated identity (gen_random_uuid() default) - it is never the same
// identity as any preserved legacy candidate row, and this script never reads,
// references, or reuses a legacy candidate identity.
//
// This is a production execution ARTIFACT. It is not invoked by this task and
// must not be run against any production database without separate,
// explicit operator authorization, after the cutover migration and its
// post-migration verifier have both already passed.
//
// Usage:
//   node scripts/kai-sprint2-legacy-cutover-synthetic-reprocessor.js \
//     --organization-id=<uuid> --intake-file-id=<uuid> --actor-user-id=<uuid>
//
// Requires the same DATABASE_URL/DATABASE_URL_LOCAL selection already used by
// Backend/db/pg.js, and KAI_SPRINT2_ENABLED=true (this script stops before P1-08
// and never invokes the source-promotion decision path).

import { activateParserProfileWorkForIntakeFile } from "../Backend/kai/parsing/parserProfileActivation.js";
import { createDraftDataDictionary } from "../Backend/kai/services/kaiDataDictionaryService.js";
import { persistIntakeSensitivityProfile } from "../Backend/kai/services/kaiIntakeSensitivityProfileService.js";
import { createSensitivityReviewQueueItem } from "../Backend/kai/services/kaiReviewQueueService.js";
import { createSourceCandidateStub } from "../Backend/kai/services/kaiSourceCandidateService.js";
import { createProductionMetadataOnlyAudit } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

export async function runSyntheticReprocessing({ organizationId, intakeFileId, actorUserId }, dependencies = {}) {
  const nowFn = dependencies.now || (() => new Date().toISOString());
  const actorContext = { actorType: "human", actorUserId };
  const steps = { organizationId, intakeFileId };

  const activation = await (dependencies.activateParserProfileWorkForIntakeFile || activateParserProfileWorkForIntakeFile)(
    { organizationId, intakeFileId, actorContext, retry: false },
    dependencies,
  );
  steps.activation = activation;
  const outputProfileId = activation?.ok === true ? activation?.data?.run?.run?.output_profile_id : undefined;
  const parserStatus = activation?.ok === true ? activation?.data?.run?.run?.parser_status : undefined;
  if (parserStatus !== "completed" || typeof outputProfileId !== "string" || outputProfileId.length === 0) {
    steps.stoppedAt = "parser_profile_activation";
    return steps;
  }

  const metadataOnlyAudit = dependencies.metadataOnlyAudit || createProductionMetadataOnlyAudit({
    organizationId,
    intakeFileId,
    actorContext,
    now: nowFn(),
  });

  const dictionaryResult = await (dependencies.createDraftDataDictionary || createDraftDataDictionary)(
    { organizationId, fileProfileId: outputProfileId, now: nowFn() },
    { ...dependencies, metadataOnlyAudit },
  );
  steps.dataDictionary = dictionaryResult;
  const dataDictionaryId = dictionaryResult?.ok === true ? dictionaryResult?.data?.dictionary?.data_dictionary_id : undefined;
  if (typeof dataDictionaryId !== "string" || dataDictionaryId.length === 0) {
    steps.stoppedAt = "draft_data_dictionary";
    return steps;
  }

  const sensitivityResult = await (dependencies.persistIntakeSensitivityProfile || persistIntakeSensitivityProfile)(
    { organizationId, fileProfileId: outputProfileId, dataDictionaryId, now: nowFn() },
    { ...dependencies, metadataOnlyAudit },
  );
  steps.sensitivityProfile = sensitivityResult;
  const intakeSensitivityProfileId = sensitivityResult?.ok === true
    ? sensitivityResult?.data?.sensitivityProfile?.intake_sensitivity_profile_id
    : undefined;
  if (typeof intakeSensitivityProfileId !== "string" || intakeSensitivityProfileId.length === 0) {
    steps.stoppedAt = "persist_intake_sensitivity_profile";
    return steps;
  }

  const queueResult = await (dependencies.createSensitivityReviewQueueItem || createSensitivityReviewQueueItem)(
    { organizationId, intakeSensitivityProfileId, actorContext, now: nowFn() },
    { ...dependencies, metadataOnlyAudit },
  );
  steps.sensitivityReviewQueueItem = queueResult;
  if (queueResult?.ok !== true) {
    steps.stoppedAt = "create_sensitivity_review_queue_item";
    return steps;
  }

  const candidateResult = await (dependencies.createSourceCandidateStub || createSourceCandidateStub)(
    { organizationId, intakeSensitivityProfileId, actorContext, now: nowFn() },
    { ...dependencies, metadataOnlyAudit },
  );
  steps.sourceCandidate = candidateResult;
  steps.stoppedAt = candidateResult?.ok === true ? null : "create_source_candidate_stub";
  return steps;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args["organization-id"] || !args["intake-file-id"] || !args["actor-user-id"]) {
    console.error("Usage: node kai-sprint2-legacy-cutover-synthetic-reprocessor.js --organization-id=<uuid> --intake-file-id=<uuid> --actor-user-id=<uuid>");
    process.exit(1);
  }
  const result = await runSyntheticReprocessing({
    organizationId: args["organization-id"],
    intakeFileId: args["intake-file-id"],
    actorUserId: args["actor-user-id"],
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.stoppedAt ? 1 : 0);
}
