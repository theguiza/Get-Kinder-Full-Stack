import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Package 2: source-contract tests proving the Impact Evidence Library page
 * wires organization + engagement into the governed Impact Library KAI
 * widget, and that the widget never sends/stores a conversationId and
 * resets its displayed state when organization/engagement change.
 */

test("ImpactEvidenceLibrary.jsx lifts engagement selection to page state and passes it to ImpactLibraryKai", () => {
  const source = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  assert.match(source, /import ImpactLibraryKai from "\.\/ImpactLibraryKai\.jsx";/);
  assert.match(source, /const \[engagementId, setEngagementId\] = useState\(""\);/);
  assert.match(source, /<ImpactLibraryKai organizationId={organizationId} engagementId={engagementId} \/>/);
});

test("ImpactLibraryKai.jsx posts to the governed impact-library route with organization/engagement and no client-supplied identity fields", () => {
  const source = readFileSync("frontend/ImpactLibraryKai.jsx", "utf8");
  assert.match(source, /\/api\/kai\/impact-library\/message/);
  const postCallIndex = source.indexOf("postJson(IMPACT_LIBRARY_KAI_PATH");
  assert.ok(postCallIndex > -1);
  const postCallSlice = source.slice(postCallIndex, postCallIndex + 200);
  assert.match(postCallSlice, /organizationId,\s*\n\s*engagementId,/);
  assert.doesNotMatch(postCallSlice, /conversationId/, "Mode B client must never send/store a conversationId");
  assert.doesNotMatch(postCallSlice, /actorContext|role|membership/i);
});

test("ImpactLibraryKai.jsx resets displayed interaction state when organization or engagement changes", () => {
  const source = readFileSync("frontend/ImpactLibraryKai.jsx", "utf8");
  assert.match(source, /useEffect\(\(\) => \{\s*setTurns\(\[\]\);/);
  assert.match(source, /\}, \[organizationId, engagementId\]\);/);
});
