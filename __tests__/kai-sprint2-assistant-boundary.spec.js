import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assistant_claim_creation_blocked,
  assistant_evidence_creation_blocked,
  assistant_human_review_bypass_blocked,
  assistant_raw_file_access_blocked,
  assistant_report_export_generation_blocked,
  assistant_review_approval_blocked,
  assistant_signed_url_access_blocked,
  assistant_source_promotion_blocked,
  validateAssistantBoundary,
} from "../Backend/kai/validators/assistantBoundaryValidators.js";

const assistantBoundarySource = readFileSync("Backend/kai/validators/assistantBoundaryValidators.js", "utf8");

test("assistant boundary blocks restricted system/assistant operations", () => {
  const result = validateAssistantBoundary({
    actorContext: { actorType: "system" },
    operation: "issue_signed_read_url",
  });

  assert.equal(result.severity, "blocker");
  assert.equal(result.blocking_reason, "assistant_boundary");
});

test("assistant boundary permits non-restricted metadata operation", () => {
  const result = validateAssistantBoundary({
    actorContext: { actorType: "assistant" },
    operation: "read_intake",
  });

  assert.equal(result.severity, "pass");
});

test("assistant, AI, and generic system identities cannot mutate P0 intake metadata", () => {
  for (const actorType of ["assistant", "ai", "system", "internal_service"]) {
    for (const operation of ["create_intake_batch", "create_intake_file", "create_review_queue_item"]) {
      const result = validateAssistantBoundary({ actorContext: { actorType }, operation });
      assert.equal(result.severity, "blocker", `${actorType}:${operation}`);
      assert.equal(result.blocking_reason, "assistant_boundary", `${actorType}:${operation}`);
    }
  }
});

test("assistant boundary blocks raw file, signed URL, approval, promotion, claim, evidence, report, and review bypass operations", () => {
  const actorContext = { actorType: "assistant" };
  const blocked = [
    assistant_raw_file_access_blocked({ actorContext }),
    assistant_signed_url_access_blocked({ actorContext }),
    assistant_review_approval_blocked({ actorContext }),
    assistant_source_promotion_blocked({ actorContext }),
    assistant_claim_creation_blocked({ actorContext }),
    assistant_evidence_creation_blocked({ actorContext }),
    assistant_report_export_generation_blocked({ actorContext }),
    assistant_human_review_bypass_blocked({ actorContext }),
  ];

  for (const result of blocked) {
    assert.equal(result.severity, "blocker");
    assert.equal(result.blocking_reason, "assistant_boundary");
  }
});

test("assistant boundary validator has no assistant, OpenAI, Neo4j, DB, or external API imports", () => {
  assert.doesNotMatch(assistantBoundarySource, /from\s+["'][^"']*(?:openai|assistant|neo4j|db\/pg|kaiDb)[^"']*["']/i);
  assert.doesNotMatch(assistantBoundarySource, /\bfetch\s*\(|\baxios\b|\bOpenAI\b|\bneo4j\b|\bnew\s+Pool\b|\bpool\.query\b/i);
});
