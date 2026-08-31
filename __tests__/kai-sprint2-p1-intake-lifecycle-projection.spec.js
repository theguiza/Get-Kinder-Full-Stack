import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getScopedIntakeFileP1Lifecycle } from "../Backend/kai/db/kaiReadModels.js";
import { __testables } from "../Backend/kai/services/kaiIntakeService.js";

const {
  p1LifecycleProjection,
} = __testables;

test("P1 lifecycle read is tenant/file scoped and bound to the current verified checksum", async () => {
  const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
  const intakeFileId = "de9f18ea-8169-4f4b-b079-f813bda52947";

  let queryText = null;
  let queryParams = null;

  const row = {
    organization_id: organizationId,
    intake_file_id: intakeFileId,
    parser_status: "completed",
    file_profile_complete: true,
    data_dictionary_complete: true,
    sensitivity_profile_complete: true,
  };

  const result = await getScopedIntakeFileP1Lifecycle(
    organizationId,
    intakeFileId,
    {
      async query(text, params) {
        queryText = text;
        queryParams = params;
        return { rows: [row] };
      },
    },
  );

  assert.equal(result, row);
  assert.deepEqual(queryParams, [organizationId, intakeFileId]);

  assert.match(queryText, /FROM kai\.intake_files f/);
  assert.match(queryText, /FROM kai\.intake_parser_runs pr/);
  assert.match(queryText, /pr\.organization_id = f\.organization_id/);
  assert.match(queryText, /pr\.intake_file_id = f\.intake_file_id/);
  assert.match(queryText, /pr\.checksum = f\.verified_checksum/);
  assert.match(queryText, /kai\.intake_file_profiles/);
  assert.match(queryText, /kai\.data_dictionaries/);
  assert.match(queryText, /kai\.intake_sensitivity_profiles/);
  assert.match(queryText, /intake_sensitivity_profile_id/);
  assert.match(queryText, /f\.organization_id = \$1/);
  assert.match(queryText, /f\.intake_file_id = \$2/);

  assert.doesNotMatch(
    queryText,
    /\b(?:profile|raw_bytes|raw_text|storage_object_key|storage_bucket)\s+AS\s+/i,
  );
});

test("P1 lifecycle projection reports the completed automatic P1 chain", () => {
  const intakeSensitivityProfileId = "3c9a6f0e-2f0e-4a2a-9a9e-1a2b3c4d5e6f";
  assert.deepEqual(
    p1LifecycleProjection({
      parser_status: "completed",
      file_profile_complete: true,
      data_dictionary_complete: true,
      sensitivity_profile_complete: true,
      intake_sensitivity_profile_id: intakeSensitivityProfileId,
    }),
    {
      parser_status: "completed",
      file_profile_complete: true,
      data_dictionary_complete: true,
      sensitivity_profile_complete: true,
      automatic_stage: "complete",
      intake_sensitivity_profile_id: intakeSensitivityProfileId,
    },
  );
});

test("P1 lifecycle projection does not claim downstream completion from incomplete lineage", () => {
  assert.deepEqual(
    p1LifecycleProjection({
      parser_status: "completed",
      file_profile_complete: true,
      data_dictionary_complete: false,
      sensitivity_profile_complete: true,
      intake_sensitivity_profile_id: "3c9a6f0e-2f0e-4a2a-9a9e-1a2b3c4d5e6f",
    }),
    {
      parser_status: "completed",
      file_profile_complete: true,
      data_dictionary_complete: false,
      sensitivity_profile_complete: false,
      automatic_stage: "dictionary",
      intake_sensitivity_profile_id: null,
    },
  );

  assert.equal(
    p1LifecycleProjection({ parser_status: "failed" }).automatic_stage,
    "failed",
  );

  assert.equal(
    p1LifecycleProjection(null).automatic_stage,
    "not_started",
  );
});

// KAI B1A-3B-R2: server-grounded P1-05 profile-id projection.
test("P1 lifecycle projection exposes intake_sensitivity_profile_id only when the profile is actually complete and a valid uuid", () => {
  assert.equal(
    p1LifecycleProjection({
      parser_status: "completed",
      file_profile_complete: true,
      data_dictionary_complete: true,
      sensitivity_profile_complete: false,
      intake_sensitivity_profile_id: "3c9a6f0e-2f0e-4a2a-9a9e-1a2b3c4d5e6f",
    }).intake_sensitivity_profile_id,
    null,
  );

  assert.equal(
    p1LifecycleProjection({
      parser_status: "completed",
      file_profile_complete: true,
      data_dictionary_complete: true,
      sensitivity_profile_complete: true,
      intake_sensitivity_profile_id: "not-a-uuid",
    }).intake_sensitivity_profile_id,
    null,
  );

  assert.equal(
    p1LifecycleProjection(null).intake_sensitivity_profile_id,
    null,
  );
});

test("file-detail service adds P1 lifecycle through a read model and contains no P1 SQL", () => {
  const source = readFileSync(
    "Backend/kai/services/kaiIntakeService.js",
    "utf8",
  );

  assert.match(
    source,
    /getScopedIntakeFileP1Lifecycle as readIntakeFileP1Lifecycle/,
  );
  assert.match(
    source,
    /dependencies\.getScopedIntakeFileP1Lifecycle/,
  );
  assert.match(
    source,
    /p1_lifecycle:\s*p1LifecycleProjection\(p1LifecycleRow\)/,
  );

  const start = source.indexOf("export async function getIntakeFileDetail");
  const end = source.indexOf(
    "export async function markIntakeFilePolicyBlocked",
    start,
  );
  const region = source.slice(start, end);

  assert.doesNotMatch(
    region,
    /\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\s+kai\./i,
  );
});

test("Web Intake displays authoritative P1 lifecycle instead of legacy quarantine fields", () => {
  const source = readFileSync("frontend/KaiWebIntake.jsx", "utf8");

  const statusStart = source.indexOf(">File status<");
  const batchStart = source.indexOf(">Batch files<", statusStart);
  assert.ok(statusStart >= 0 && batchStart > statusStart);

  const statusRegion = source.slice(statusStart, batchStart);

  assert.match(statusRegion, /label="P1 processing"/);
  assert.match(statusRegion, /p1_lifecycle\?\.automatic_stage/);
  assert.match(statusRegion, /label="Parser\/profile"/);
  assert.match(statusRegion, /label="Data dictionary"/);
  assert.match(statusRegion, /label="Sensitivity profile"/);

  assert.doesNotMatch(statusRegion, /fileStatus\.processing_status/);
  assert.doesNotMatch(statusRegion, /fileStatus\.parse_status/);

  assert.doesNotMatch(source, /item\.processing_status/);
  assert.match(source, /P1: \{item\.p1_lifecycle\?\.automatic_stage/);
});
