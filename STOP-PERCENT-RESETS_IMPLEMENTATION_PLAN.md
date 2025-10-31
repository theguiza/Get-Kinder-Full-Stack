## Root Cause (Proven from Code)
- **Helpers are correct:** `threshold <= 0` ⇒ return `0`; else `round(points/threshold*100)` clamped 0..100.
- **100 fallback** is introduced **only** by the API state builder (e.g., `buildStateFromRow` / `finalizeState` in `arcsApi.js`) and is **not** consistently persisted.
- **Award flows** (e.g., `pointsRepo.js`) compute `percent` from the **DB row’s** `next_threshold` (no 100 fallback), so `0` ⇒ `0%`.
- **SSR** (`dashboardController.js`) renders arcs **without computing `percent`**, so first paint uses raw DB, which can differ from API responses.
- **Net effect:** Different denominators (0 vs 100) used in different paths → perceived “percent resets” after reload.

## Change Policy
1. Coalesce `next_threshold` to **100** anywhere we compute or persist progress.  
2. Compute `percent` **canonically** for every API response and for SSR pre-render.  
3. (Optional) Add a DB default/backfill to eliminate zero/NULL thresholds at the source.

> **Do NOT change** the helper contracts. Keep: “`threshold <= 0 ⇒ 0`”. Apply fallback before calling helpers.

## Patches (Unified Diffs — apply in a separate PR, not in this task)
> File paths may vary; adjust imports accordingly. Logic must match.

### 1) `pointsRepo.js` — coalesce threshold before computing percent
```diff
--- a/pointsRepo.js
+++ b/pointsRepo.js
@@
-  const percent = clampPercent(progressPercent(updated.arc_points, updated.next_threshold));
+  const rawT = updated.next_threshold;
+  const t = (Number.isFinite(rawT) && rawT > 0) ? rawT : 100; // align with arcsApi fallback
+  const percent = clampPercent(progressPercent(updated.arc_points, t));
   return { row: updated, percent };
 ```
_Apply the same change in **both** award routines (e.g., `awardAndMarkStepDone`, `awardChallengeAndClear`)._

### 2) `arcsApi.js` — persist fallback & always recompute canonical percent
```diff
--- a/arcsApi.js
+++ b/arcsApi.js
@@
-  const currentRow = arcRowResult.rows[0];
+  const currentRow = arcRowResult.rows[0];
+  // Ensure DB has a non-zero denominator so SSR & future API responses align
+  if (!(Number.isFinite(currentRow.next_threshold) && currentRow.next_threshold > 0)) {
+    await client.query(
+      'UPDATE friend_arcs SET next_threshold = 100, updated_at = NOW() WHERE id = $1 AND user_id = $2',
+      [arcId, userId]
+    );
+    currentRow.next_threshold = 100;
+  }
   const state = buildStateFromRow(currentRow);
@@
-  if (responseArc?.percent == null) {
-    responseArc.percent = progressPercent(
-      toNumber(responseArc?.arcPoints, 0),
-      toNumber(responseArc?.nextThreshold, responseArc?.next_threshold ?? 0)
-    );
-  }
+  // Always compute canonical percent with the same fallback rule
+  {
+    const pts = toNumber(responseArc?.arcPoints, 0);
+    const rawT = toNumber(responseArc?.nextThreshold, responseArc?.next_threshold ?? 0);
+    const t = rawT > 0 ? rawT : 100;
+    responseArc.percent = progressPercent(pts, t);
+  }
 ```

### 3) `dashboardController.js` — compute SSR percent with same rule
```diff
--- a/dashboardController.js
+++ b/dashboardController.js
@@
+ import { progressPercent } from "../shared/metrics.js"; // adjust path as needed
@@
-  // Ensure each arc has a top-level challenge object before rendering.
+  // Ensure each arc has a top-level challenge object before rendering and normalize percent.
   for (const row of hydratedArcs) {
     await ensureTopLevelChallenge(row);
+    const points = Number(row.arc_points ?? row.arcPoints) || 0;
+    const rawT   = Number(row.next_threshold ?? row.nextThreshold) || 0;
+    const t      = rawT > 0 ? rawT : 100;
+    row.percent  = progressPercent(points, t);
   }
 ```

### 4) (Optional) SQL Backfill / Invariant
```sql
-- Backfill to stabilize existing rows immediately
UPDATE friend_arcs
SET next_threshold = 100
WHERE next_threshold IS NULL OR next_threshold <= 0;

-- Hardening (opt-in)
-- ALTER TABLE friend_arcs ALTER COLUMN next_threshold SET DEFAULT 100;
-- ALTER TABLE friend_arcs ALTER COLUMN next_threshold SET NOT NULL;
```

## Acceptance Criteria (Black-Box)
1. **New arc with unset threshold**
   - First paint on `/dashboard`: percent reflects `round(points/100*100)` (clamped 0–100); never 0% merely due to missing threshold.
   - Reload: percent identical (SSR == API).
2. **Complete a step (only)**
   - API response `percent` updates using the same denominator rule (100 if unset).
   - Reload: percent unchanged.
3. **Complete a challenge**
   - API returns canonical `percent`; reload stable.
4. **Existing arc with valid threshold (e.g., 80)**
   - SSR and API both compute `round(points/80*100)` clamped 0–100.
5. **Security unchanged**
   - CSRF + Idempotency-Key behavior unchanged; no new endpoints introduced.
6. **No regressions**
   - Morning Prompt and other unrelated features remain unaffected by these changes.

## Manual QA Script
- Create a new user → add friend → generate a new arc (with missing/zero threshold).
- Observe percent on first paint; complete a step; verify API response percent; reload; verify identical values.
- Update an arc to `next_threshold=80`; repeat to confirm non-100 denominators work identically.
- Inspect Network tab for consistent `percent`; check logs for errors.

## Rollback Plan
- Revert the three files to the prior commit.
- If the SQL backfill was applied, keeping `next_threshold=100` is safe; restore from backup only if necessary.

## References
- MDN: `<script type="application/json">` for SSR→CSR hydration.  
- OWASP CSRF: synchronizer token with custom header for AJAX.  
- MDN `fetch`: `credentials: "include"` for cookie-authenticated requests.  
- Stripe-style Idempotency Keys pattern (for POST safety).
