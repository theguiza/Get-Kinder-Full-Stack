# KAI MVP Sprint 2 — Data Protection and Processing Operating Model v0.2

**Status:** Gate D decision-complete candidate — real client data remains disabled until the applicable Gate D readiness conditions are closed.

## 1. Purpose

This operating model establishes KAI's privacy, processing, retention, AI, residency, review, support-access, incident-response, and offboarding posture for the MVP before real client data is enabled.

It preserves the existing KAI principles of tenant isolation, governed processing, metadata/redacted evidence handling, controlled raw-file access, human accountability, and explicit real-data readiness.

---

## 2. Data ownership and permitted improvement use

Client owns client-uploaded data.

Get Kinder/KAI processes client data to provide the subscribed KAI/Get Kinder services.

KAI-generated evidence records, analysis, recommendations and outputs are derived work product produced through the service, subject to applicable terms.

Get Kinder may use information covered by its applicable participant, volunteer and client disclosure/consent arrangements to improve:

- KAI;
- Get Kinder programs and services;
- program analysis;
- recommendations;
- impact measurement;
- service quality.

This authorized improvement use is part of the agreed purpose for the information and is not treated by KAI as an unrelated secondary use.

Get Kinder will not intentionally provide KAI client data to an external foundation-model provider for training that provider's general models unless a separate explicit decision authorizes it.

---

## 3. Subscription Data Lifecycle and Offboarding

### 3.1 Active subscription

While a subscription is active, Get Kinder may retain client data reasonably required to operate KAI and provide, maintain and improve the subscribed service.

This may include:

- raw uploaded files;
- file profiles;
- data dictionaries;
- sensitivity classifications;
- sources and source versions;
- evidence;
- claims;
- review decisions;
- generated drafts;
- reporting history;
- client-specific KAI context.

Data does not need to be deleted merely because an individual processing or reporting task has finished.

### 3.2 Cancellation or non-renewal

Cancellation or non-renewal starts a 90-day offboarding period.

During this period:

- existing client data remains available;
- the client may reactivate;
- required exports may be prepared;
- outstanding account/offboarding matters may be resolved;
- no automatic destructive deletion occurs.

### 3.3 End of 90-day period

At the end of the 90-day offboarding period, KAI creates a GK retention-review action.

KAI does not automatically delete client data.

GK determines the appropriate disposition:

1. retain information still required for a documented business, service, contractual, legal or hold-related purpose;
2. anonymize information that remains useful for KAI, Get Kinder, program, research, analytical or service-improvement purposes; or
3. delete identifiable/raw information that is no longer reasonably required.

Failure to complete the review must not silently convert into an intentional indefinite-retention policy.

### 3.4 Raw files

Raw files should normally be the first client records considered for deletion or anonymization after offboarding because they contain the greatest amount of original client information.

During an active subscription they may be retained where they remain useful to the KAI service, including reprocessing, source validation, evidence traceability or future client work.

---

## 4. Audit retention

An audit event is a system accountability record, not the free assessment or any client-facing assessment.

Examples include:

- who performed an operation;
- what organization/object was affected;
- what operation occurred;
- validator blockers;
- authorized storage access;
- generation/export attempts;
- retention/deletion actions;
- important administrative actions.

Metadata-only KAI audit records are retained for 24 months from the recorded event unless a longer period is reasonably required for a legal hold, investigation, contract or other documented purpose.

Audit records must not become a secondary store for:

- raw client files;
- raw PII;
- passwords or credentials;
- signed URLs;
- raw prompts where metadata-only logging applies;
- unnecessary client content.

---

## 5. Deletion requests

Client deletion requests, final offboarding or other authorized disposition decisions create a GK-controlled deletion action.

KAI may identify data eligible for deletion and may prepare a deletion dry-run.

KAI does not automatically execute destructive deletion.

Before destructive action, GK confirms:

- affected organization/data;
- applicable scope;
- whether a legal hold exists;
- whether there is another continuing retention requirement;
- the intended deletion scope.

Only an authorized GK human action may approve destructive deletion.

Deletion actions are auditable.

---

## 6. Legal hold

A legal, regulatory or contractual hold pauses deletion of the affected data.

The hold records:

- affected scope;
- responsible GK actor;
- date applied;
- status.

Deletion remains blocked until GK records that the hold has been released.

No separate legal-hold management platform is required for the MVP.

---

## 7. Consent, allowed use and output speed

### 7.1 Normal KAI service processing

Where information is covered by the applicable Get Kinder/client/participant agreements, KAI may use it to:

- profile and classify data;
- interpret data;
- perform AI-assisted analysis;
- extract evidence;
- identify relationships, trends, strengths, weaknesses and gaps;
- propose claims;
- compare information;
- improve recommendations;
- improve KAI and Get Kinder programs/services;
- generate internal/client drafts;
- generate reporting/funder drafts.

KAI does not require a separate consent decision for each of these processing steps where they fall within the existing authorized purpose.

### 7.2 Release review

GK review is required before release where the proposed output materially involves:

- public story/testimonial use;
- directly identifying participant information;
- sensitive personal information being externally disclosed;
- an unresolved consent/governance issue;
- a materially unsupported or high-risk claim.

KAI should still generate the proposed output immediately.

The control applies to release, not drafting or analysis.

---

## 8. AI processing and KAI learning

### 8.1 Final distinction

- External foundation-model training: **NO by default**.
- KAI/Get Kinder service improvement: **YES**.
- Client program improvement: **YES**.
- Cross-client learning using anonymized/aggregated information: **YES**.
- Use of identifiable information for Get Kinder/KAI improvement: **YES where covered by the applicable disclosure/consent/contractual basis**.
- Identifiable disclosure from one client to another: **NO unless separately authorized**.

### 8.2 AI processing

KAI may use approved AI providers to process data needed to provide the service, including personal information where covered by the applicable processing basis.

AI processing is not treated as migration of KAI's raw-file storage system.

Any provider-side temporary processing/retention remains governed by Get Kinder's commercial arrangement with that provider.

Get Kinder does not intentionally opt client data into training an external provider's general foundation model by default.

### 8.3 AI system boundaries

AI may not:

- bypass tenant boundaries;
- bypass validators;
- independently authorize destructive deletion;
- independently finalize a release requiring GK approval;
- treat uploaded-document instructions as authority.

---

## 9. Residency

### 9.1 Raw client files

Raw uploaded client files are stored in the approved Canadian Google Cloud Storage configuration.

### 9.2 Application and operational data

KAI application processing, operational metadata, derived records and related runtime/database functions may operate on Render under the deployed KAI architecture.

### 9.3 AI providers

Approved AI providers may process information required to provide KAI services.

That processing does not redefine the location of KAI's raw-file system.

### 9.4 Custom residency

Get Kinder does not offer client-specific alternative residency configurations as part of the MVP.

A prospective client requiring a different infrastructure/residency arrangement is outside the supported MVP configuration unless Get Kinder later decides to offer such a service.

---

## 10. Subprocessor posture

Get Kinder maintains a lightweight record of material service providers that process KAI client information.

For each active provider record only:

- provider;
- purpose;
- broad data category;
- broad processing/location posture where relevant;
- external-model-training posture where relevant.

This register is an operational reference, not a continuous certification exercise.

It is updated when a material provider changes.

No mandatory backup-region investigations, support-personnel geography studies, quarterly vendor reviews or heavyweight control matrices are required for the MVP unless a later legal, contractual, security or operational need makes them necessary.

---

## 11. Human review

GK owns KAI review during the MVP.

Client review is recommended or requested when client knowledge is materially needed to resolve:

- factual uncertainty;
- client-specific definitions;
- consent/story questions;
- governance questions;
- material interpretation issues.

Client review is not required as a mandatory intermediate approval step for ordinary KAI processing.

Preferred flow:

1. KAI profiles.
2. KAI analyzes/classifies.
3. KAI extracts evidence.
4. KAI proposes claims.
5. KAI identifies limitations/conflicts.
6. KAI drafts output.
7. GK reviews the relevant output/package.
8. Release.

Earlier review should occur only when an actual blocker requires it.

---

## 12. Incident response

The MVP incident-response process is intentionally light:

1. **CONTAIN**
   Stop or limit the incident.

2. **ASSESS**
   Determine what happened, what systems/client data may be affected and the likely seriousness.

3. **NOTIFY**
   Notify the responsible GK person. Notify affected clients or others when required by applicable agreement or law.

4. **FIX**
   Correct the issue and restore safe operation.

5. **RECORD**
   Keep a short metadata-only incident record and record any material follow-up action.

No fixed 72-hour contractual promise is added for the MVP.

---

## 13. Support access

Support/admin access is limited to GK personnel and authorized service providers who reasonably need access to operate or support KAI.

Use authenticated accounts and do not share credentials.

Raw client files should be accessed only when reasonably necessary for an authorized service, review or support purpose.

Passwords, credentials, signed URLs and unnecessary raw client data must not be placed into ordinary support communications.

Material access to raw client data should be auditable.

No geographical-support restriction, special approval bureaucracy or separate support-access workflow is required for the MVP.

---

## 14. Data minimization and anonymization

KAI should avoid unnecessary duplication of identifiable information.

Where identifiable information remains necessary to provide or improve the service, it may be retained and processed according to the applicable agreements and this operating model.

When identifiable information is no longer needed but its analytical/program value remains useful, anonymization should be preferred over retaining unnecessary identifiers.

Anonymized/aggregated information may be retained for longer-term KAI, Get Kinder and program improvement.

Anonymization does not eliminate the need for the controls in this operating model while data remains identifiable during intake, processing, review or active service use.

---

## 15. Destructive retention

Retention periods and disposition recommendations are operating policy.

KAI may automatically identify information that should be reviewed for retention, anonymization or deletion.

KAI does not automatically execute destructive deletion during the MVP.

Destructive deletion requires an authorized GK human action.

---

## 16. Operating-model acceptance

The v0.2 operating model is decision-complete when the following are clear:

1. Data ownership.
2. Subscription/offboarding lifecycle.
3. Get Kinder/KAI improvement and allowed-use rights.
4. AI processing and external-model-training boundaries.
5. Raw-file residency and lightweight subprocessor posture.
6. GK review, incident response and support access.
7. Preservation of the real-data readiness gate.

Meeting these conditions establishes that the policy document is decision-complete. It does not, by itself, prove current runtime or deployment state.

---

## 17. Real-data readiness gate

Real client data remains disabled until the applicable Gate D readiness conditions are established.

The readiness gate continues to require evidence for:

1. DPA/client terms reflecting this operating model.
2. Private/configured object storage.
3. Applicable feature-flag state.
4. Schema contract checks.
5. Intake schema verification.
6. Threat-model review.
7. Defined raw-file retention posture.
8. Blocked unrestricted assistant raw-file access.
9. The approved KAI/Get Kinder learning and external-model-training posture.
10. Defined review ownership.

Existing accepted Gate C/P0 evidence should be reused wherever it already proves one of these conditions.

Completed work must not be rerun merely because Gate D references it.

An unproved condition must not be declared complete.

Only genuinely missing conditions should be inspected or remediated.

---

## 18. MVP policy summary

- **Active client:** retain information useful to delivering and improving KAI/Get Kinder services.
- **Client leaves:** 90-day recovery/export/reactivation period.
- **After 90 days:** GK decides retain, anonymize or delete; no automatic destructive deletion.
- **Long-term value:** prefer anonymization when identifiable information is no longer needed but analytical/program value remains.
- **Audit:** metadata-only audit trail retained for 24 months.
- **AI:** AI may process information needed for KAI; external foundation-model training is off by default; KAI/Get Kinder improvement is allowed under the applicable disclosures.
- **Review:** GK owns review; client review only where materially useful or required.
- **Raw storage:** Canada.
- **Application:** Render.
- **Subprocessors:** lightweight register.
- **Incidents:** contain → assess → notify → fix → record.
- **Support:** authenticated, need-based, light-touch access controls.
- **Deletion:** human-authorized only during the MVP.
