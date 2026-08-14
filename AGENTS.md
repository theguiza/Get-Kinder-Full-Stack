# KAI Sprint 2 P0 repository execution

These instructions apply to the entire repository.

- Treat `KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.6.md` as the single living repository ExecPlan for KAI Sprint 2 P0.
- Inspect the relevant implementation, tests, scripts, and documentation before every change.
- Follow the accepted package order and keep every change inside the approved P0 boundary.
- Update the living ExecPlan evidence and status once, at the end of each coherent package.
- Before the first Node or npm command in every execution session, set `DATABASE_URL` to a non-listening loopback sentinel unless an explicit database target has been separately authorized. Keep the sentinel set for every later Node or npm command in that session.
- At each package boundary, run the package-focused tests and required broader suites, run `git diff --check`, inspect the complete diff, and create coherent local commits.
- Continue through the approved package order without selecting a new product task, except that execution must stop at the first-write milestone checkpoint after P0-01.
- Stop for any blocker, dependency decision, or gate defined by the living ExecPlan.
- Do not fetch, push, deploy, access or mutate databases or cloud services, inspect credentials or secrets, change feature flags, tenants, or production configuration, use real client data, perform destructive actions, or update `00_KAI_CURRENT_STATE.md` without separate explicit authorization.
- Gates A through D and P0-06B remain unauthorized.
